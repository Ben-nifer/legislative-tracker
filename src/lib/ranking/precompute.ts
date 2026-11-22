import type { SupabaseClient } from '@supabase/supabase-js'
import { EMBEDDING_MODEL } from '../embeddings/voyage'
import { type RankingConfig, loadRankingConfig } from './config'
import { type LegislatorItems, type Legislator, rankActivePoliticians } from './politicians'
import {
  type ItemFields,
  type RankInput,
  type WidgetItem,
  WIDGET_CACHE_SIZE,
  applySponsorCap,
  computeImportance,
  itemFields,
  rankJurisdiction,
  rankPolitician,
  rankTopic,
  rankTrending,
} from './score'

// The 15-minute precompute (recommendations-planv1.2.md §6.1): importance for
// every live item, then every shared widget into widget_cache. Shared by
// /api/cron/rank-widgets and scripts/rank-widgets.ts.

const PAGE_SIZE = 1000
const WRITE_BATCH = 500
const WIDGET_WRITE_BATCH = 50
const RPC_CONCURRENCY = 4
// On-demand interest widgets keep refreshing this long after their last request
const INTEREST_KEEP_DAYS = 7

export const ACTIVE_POLITICIANS_KEY = 'politicians:active'

export interface PrecomputeResult {
  configVersion: number
  items: number
  widgets: number
  removed: number
  ms: number
}

interface CachedWidget {
  widget_key: string
  items: unknown[]
  config_version: number
  computed_at: string
  last_requested_at?: string
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i])
      }
    })
  )
  return results
}

export async function loadRankInputs(supabase: SupabaseClient, config: RankingConfig): Promise<RankInput[]> {
  const e = config.params.engagement
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc('ranking_item_inputs', {
        p_engagement_days: e.window_days,
        p_trending_days: config.params.trending.window_days,
        p_new_account_days: e.new_account_days,
        p_new_account_mult: e.new_account_multiplier,
        p_guest_view_mult: e.guest_view_multiplier,
        p_w_stance: e.action_weights.stance,
        p_w_comment: e.action_weights.comment,
        p_w_save: e.action_weights.save,
        p_w_view: e.action_weights.view,
      })
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`ranking_item_inputs failed: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows.map((r) => ({
    id: r.id as string,
    itemType: r.item_type as string,
    title: r.title as string,
    url: r.url as string,
    jurisdictionLevel: r.jurisdiction_level as string,
    legislatureId: (r.legislature_id as string | null) ?? null,
    legislationId: (r.legislation_id as string | null) ?? null,
    stage: (r.stage as string | null) ?? null,
    introducedAt: (r.introduced_at as string | null) ?? null,
    lastActivityAt: r.last_activity_at as string,
    nextEventAt: (r.next_event_at as string | null) ?? null,
    primarySponsorId: (r.primary_sponsor_id as string | null) ?? null,
    cosponsorCount: r.cosponsor_count as number,
    hearingCount: r.hearing_count as number,
    engagementWindow: r.engagement_window as number,
    actionsWindow: r.actions_window as number,
    engagementTrending: r.engagement_trending as number,
    lastEngagementAt: (r.last_engagement_at as string | null) ?? null,
  }))
}

// A typed interest's widget (§6.4 topic formula), filtered to its place.
// `lookup` comes from the precompute's maps; without it (the on-demand path)
// importance and sponsors are read for just these candidates.
export async function rankInterestWidget(
  supabase: SupabaseClient,
  normalizedPhrase: string,
  place: { type: string; id: string } | null,
  config: RankingConfig,
  now: Date,
  lookup?: { importance: (id: string) => number; sponsor: (id: string) => string | null }
): Promise<WidgetItem[]> {
  const { data, error } = await supabase.rpc('match_interest_items', {
    p_phrase: normalizedPhrase,
    p_model: EMBEDDING_MODEL,
    p_count: config.params.topic_candidate_count,
    p_min_similarity: config.params.similarity_floor,
    p_levels: null,
    p_place_type: place?.type ?? null,
    p_place_id: place?.id ?? null,
  })
  if (error) throw new Error(`Interest candidates failed: ${error.message}`)
  const rows = (data ?? []) as Record<string, unknown>[]

  let importance = lookup?.importance
  let sponsor = lookup?.sponsor
  if (!lookup) {
    const ids = rows.map((r) => r.id as string)
    const { data: ctx, error: ctxError } = ids.length
      ? await supabase.rpc('item_rank_context', { p_ids: ids })
      : { data: [], error: null }
    if (ctxError) throw new Error(`item_rank_context failed: ${ctxError.message}`)
    const byId = new Map<string, Record<string, unknown>>((ctx ?? []).map((c: Record<string, unknown>) => [c.id as string, c]))
    importance = (id) => Number(byId.get(id)?.importance ?? 0)
    sponsor = (id) => (byId.get(id)?.primary_sponsor_id as string | null) ?? null
  }

  const candidates = rows.map((r) => ({
    item: {
      id: r.id as string,
      title: r.title as string,
      itemType: r.item_type as string,
      jurisdictionLevel: r.jurisdiction_level as string,
      stage: (r.stage as string | null) ?? null,
      url: r.url as string,
      legislationId: (r.legislation_id as string | null) ?? null,
      lastActivityAt: r.last_activity_at as string,
      nextEventAt: (r.next_event_at as string | null) ?? null,
      primarySponsorId: sponsor!(r.id as string),
    },
    similarity: r.similarity as number,
    tagged: false,
  }))
  const ranked = rankTopic(candidates, { config, now, importance: importance! })
  return applySponsorCap(ranked, config.params.sponsor_cap).slice(0, WIDGET_CACHE_SIZE)
}

async function upsertInBatches(supabase: SupabaseClient, table: string, rows: object[], batch: number, onConflict: string) {
  for (let i = 0; i < rows.length; i += batch) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + batch), { onConflict })
    if (error) throw new Error(`${table} write failed: ${error.message}`)
  }
}

export async function runPrecompute(supabase: SupabaseClient, now = new Date()): Promise<PrecomputeResult> {
  const started = Date.now()
  const computedAt = now.toISOString()
  const config = await loadRankingConfig(supabase)
  const cap = config.params.sponsor_cap

  // 1. Importance (§6.2)
  const inputs = await loadRankInputs(supabase, config)
  const importance = computeImportance(inputs, config)
  await upsertInBatches(
    supabase,
    'item_importance',
    [...importance].map(([id, imp]) => ({
      content_item_id: id,
      score: imp.score,
      components: imp.components,
      computed_at: computedAt,
    })),
    WRITE_BATCH,
    'content_item_id'
  )
  await supabase.from('item_importance').delete().lt('computed_at', computedAt) // items that died

  const byId = new Map(inputs.map((i) => [i.id, i]))
  const fields = new Map<string, ItemFields>(inputs.map((i) => [i.id, itemFields(i)]))
  const ctx = { config, now, importance: (id: string) => importance.get(id)?.score ?? 0 }
  const widgets = new Map<string, WidgetItem[] | unknown[]>()
  const capped = (ranked: WidgetItem[]) => applySponsorCap(ranked, cap).slice(0, WIDGET_CACHE_SIZE)

  // 2a. Jurisdiction widgets: Federal, State, City (only levels with items)
  for (const level of ['federal', 'state', 'city']) {
    const items = inputs.filter((i) => i.jurisdictionLevel === level).map((i) => fields.get(i.id)!)
    if (items.length) widgets.set(`jurisdiction:${level}`, capped(rankJurisdiction(items, ctx)))
  }

  // 2b. Place widgets: every neighborhood (kept only if it has items), plus places anyone follows
  const [{ data: ntas, error: ntaError }, { data: follows }] = await Promise.all([
    supabase.from('places').select('place_id').eq('place_type', 'neighborhood'),
    supabase.from('user_jurisdiction_follows').select('place_type, place_id'),
  ])
  if (ntaError) throw new Error(`places read failed: ${ntaError.message}`)
  const followedPlaces = new Set<string>()
  for (const f of follows ?? []) {
    if (f.place_type === 'federal' || f.place_type === 'state' || f.place_type === 'city') continue // jurisdiction widgets
    followedPlaces.add(`${f.place_type}:${f.place_id}`)
  }
  const placeKeys = new Set<string>([...(ntas ?? []).map((r) => `neighborhood:${r.place_id}`), ...followedPlaces])
  await mapLimit([...placeKeys], RPC_CONCURRENCY, async (key) => {
    const [type, ...rest] = key.split(':')
    const { data, error } = await supabase.rpc('place_item_ids', { p_place_type: type, p_place_id: rest.join(':') })
    if (error) throw new Error(`place_item_ids(${key}) failed: ${error.message}`)
    const items = (data ?? []).map((r: { id: string }) => fields.get(r.id)).filter((i: ItemFields | undefined): i is ItemFields => !!i)
    if (items.length || followedPlaces.has(key)) widgets.set(`place:${key}`, capped(rankJurisdiction(items, ctx)))
  })

  // 2c. Topic widgets (chips): tagged items + nearest neighbors of the topic
  const { data: topics, error: topicsError } = await supabase.from('topics').select('id, slug')
  if (topicsError) throw new Error(`topics read failed: ${topicsError.message}`)
  await mapLimit(topics ?? [], RPC_CONCURRENCY, async (topic) => {
    const { data, error } = await supabase.rpc('topic_candidates', {
      p_topic_id: topic.id,
      p_model: EMBEDDING_MODEL,
      p_count: config.params.topic_candidate_count,
    })
    if (error) throw new Error(`topic_candidates(${topic.slug}) failed: ${error.message}`)
    const candidates = (data ?? [])
      .filter((c: { id: string }) => fields.has(c.id))
      .map((c: { id: string; similarity: number | null; tagged: boolean }) => ({
        item: fields.get(c.id)!,
        similarity: c.similarity,
        tagged: c.tagged,
      }))
    widgets.set(`topic:${topic.slug}`, capped(rankTopic(candidates, ctx)))
  })

  // 2d. Typed interests: phrases anyone follows + ones requested in the last week
  const keepSince = new Date(now.getTime() - INTEREST_KEEP_DAYS * 86_400_000).toISOString()
  const [{ data: followed }, { data: recent }] = await Promise.all([
    supabase.from('user_interests').select('normalized_phrase'),
    supabase.from('widget_cache').select('widget_key').like('widget_key', 'interest:%').gte('last_requested_at', keepSince),
  ])
  const phrases = new Set<string>([
    ...(followed ?? []).map((r) => r.normalized_phrase as string),
    ...(recent ?? []).map((r) => (r.widget_key as string).slice('interest:'.length)),
  ])
  if (phrases.size) {
    const { data: parses } = await supabase
      .from('interest_phrases')
      .select('normalized_phrase, place_type, place_id')
      .in('normalized_phrase', [...phrases])
      .eq('model', EMBEDDING_MODEL)
    const lookup = { importance: ctx.importance, sponsor: (id: string) => byId.get(id)?.primarySponsorId ?? null }
    await mapLimit(parses ?? [], RPC_CONCURRENCY, async (p) => {
      const place = p.place_type ? { type: p.place_type as string, id: p.place_id as string } : null
      widgets.set(`interest:${p.normalized_phrase}`, await rankInterestWidget(supabase, p.normalized_phrase, place, config, now, lookup))
    })
  }

  // 2e. Politician widgets + the S3 activity list (§6.7). Party is never selected.
  const [{ data: legislatorRows, error: legError }, { data: roles, error: rolesError }] = await Promise.all([
    supabase.from('legislators').select('id, legislature_id, full_name, slug, photo_url, district, title').eq('is_active', true),
    supabase.rpc('politician_item_roles'),
  ])
  if (legError) throw new Error(`legislators read failed: ${legError.message}`)
  if (rolesError) throw new Error(`politician_item_roles failed: ${rolesError.message}`)
  const rolesById = new Map<string, { primary_ids: string[]; cosponsor_ids: string[] }>(
    (roles ?? []).map((r: { legislator_id: string; primary_ids: string[]; cosponsor_ids: string[] }) => [r.legislator_id, r])
  )
  const legislators: Legislator[] = (legislatorRows ?? [])
    .filter((l) => l.legislature_id)
    .map((l) => ({
      id: l.id,
      legislatureId: l.legislature_id,
      fullName: l.full_name,
      slug: l.slug,
      photoUrl: l.photo_url,
      title: l.title,
      district: l.district,
    }))
  const itemsByLegislator = new Map<string, LegislatorItems>()
  for (const l of legislators) {
    const r = rolesById.get(l.id) ?? { primary_ids: [], cosponsor_ids: [] }
    const primary = r.primary_ids.map((id) => byId.get(id)).filter((i): i is RankInput => !!i)
    const cosponsored = r.cosponsor_ids.map((id) => byId.get(id)).filter((i): i is RankInput => !!i)
    itemsByLegislator.set(l.id, { primary, cosponsored })
    const ranked = rankPolitician(
      [
        ...primary.map((i) => ({ item: fields.get(i.id)!, primary: true })),
        ...cosponsored.map((i) => ({ item: fields.get(i.id)!, primary: false })),
      ],
      ctx
    )
    widgets.set(`politician:${l.id}`, ranked.slice(0, WIDGET_CACHE_SIZE)) // no sponsor cap (§6.5)
  }
  widgets.set(ACTIVE_POLITICIANS_KEY, rankActivePoliticians(legislators, itemsByLegislator, config, now))

  // 2f. Trending
  widgets.set('trending', capped(rankTrending(inputs, { config, now })))

  // 3. Write, then drop widgets this run didn't produce (dead places, expired interests).
  // On-demand writes made during the run have a later computed_at and survive.
  const rows: CachedWidget[] = [...widgets].map(([key, items]) => ({
    widget_key: key,
    items,
    config_version: config.version,
    computed_at: computedAt,
  }))
  await upsertInBatches(supabase, 'widget_cache', rows, WIDGET_WRITE_BATCH, 'widget_key')
  const { count: removed, error: deleteError } = await supabase
    .from('widget_cache')
    .delete({ count: 'exact' })
    .lt('computed_at', computedAt)
  if (deleteError) throw new Error(`widget_cache cleanup failed: ${deleteError.message}`)

  return {
    configVersion: config.version,
    items: inputs.length,
    widgets: rows.length,
    removed: removed ?? 0,
    ms: Date.now() - started,
  }
}
