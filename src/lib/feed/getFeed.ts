import type { SupabaseClient } from '@supabase/supabase-js'
import type { WidgetItem } from '../ranking/score'
import { resolveInterest, type ScheduleTask } from '../embeddings/interests'
import { contextLabel, itemHref, statusLabel, typeLabel } from './display'
import { impressionRows, insertImpressions, type ImpressionLog } from './impressions'
import type { FeedContext, FeedItem, FeedResponse, FeedWidget, WidgetKind } from './types'

// getFeed (recommendations-planv1.2.md §7.1): the user's widgets in layout order
// (§7.2), read from the shared widget_cache, plus the per-user Tracked and Friend
// activity lists. Section titles are names only (onboarding spec v1.2 §6.1).
// Pass the service client: Friend activity reads other users' stances.

const LEVEL_ORDER = ['federal', 'state', 'city'] as const
const LEVEL_TITLES: Record<string, string> = { federal: 'Federal', state: 'New York State', city: 'New York City' }
const NEARBY_MIN = 3 // spec §7.1: a thin neighborhood is topped up from a neighbor
const MAX_INTEREST_RESOLVES = 3 // uncached typed interests ranked per request

export interface GetFeedOptions {
  size: number // 3 in the onboarding preview, 5 on the home page
  previous?: { widgets: string[]; pairs: string[] } // what the preview showed last ("widgetKey|itemId")
  lists?: boolean // Tracked, Trending and Friend activity (home page)
  now?: Date
  schedule?: ScheduleTask // runs a pending Haiku place parse (and the impression insert) after the response
  log?: ImpressionLog // record what was shown in feed_impressions (§3.5)
}

interface Planned {
  key: string
  kind: WidgetKind
  title: string
  comingSoon: { place: string } | null
  nta?: string // neighborhood widgets: for the Nearby top-up
}

interface ListItemRow {
  id: string
  title: string
  item_type: string
  stage: string | null
  url: string
  legislation_id: string | null
  next_event_at: string | null
  last_activity_at: string
}

type RawItem = {
  id: string
  title: string
  itemType: string
  stage: string | null
  url: string
  legislationId: string | null
  nextEventAt: string | null
  label?: string | null
  personal?: boolean
  score?: number // shared widgets only; Tracked and Friend activity aren't scored
  signals?: WidgetItem['signals']
}

const LIST_COLUMNS = 'id, title, item_type, stage, url, legislation_id, next_event_at, last_activity_at'

const fromListRow = (r: ListItemRow): RawItem => ({
  id: r.id,
  title: r.title,
  itemType: r.item_type,
  stage: r.stage,
  url: r.url,
  legislationId: r.legislation_id,
  nextEventAt: r.next_event_at,
})

const fromWidgetItem = (i: WidgetItem): RawItem => ({
  id: i.id,
  title: i.title,
  itemType: i.itemType,
  stage: i.stage,
  url: i.url,
  legislationId: i.legislationId,
  nextEventAt: i.nextEventAt,
  score: i.score,
  signals: i.signals,
})

export function isPopular(ctx: FeedContext): boolean {
  return !ctx.jurisdictions.length && !ctx.topics.length && !ctx.legislatorIds.length
}

async function planWidgets(service: SupabaseClient, ctx: FeedContext): Promise<Planned[]> {
  const ntaCodes = ctx.jurisdictions.filter((j) => j.type === 'neighborhood').map((j) => j.id)
  const topicIds = ctx.topics.flatMap((t) => (t.kind === 'topic' ? [t.id] : []))
  const phrases = ctx.topics.flatMap((t) => (t.kind === 'interest' ? [t.phrase] : []))

  const [ntaRes, topicRes, phraseRes, legRes] = await Promise.all([
    ntaCodes.length
      ? service.from('places').select('place_id, name').eq('place_type', 'neighborhood').in('place_id', ntaCodes)
      : Promise.resolve({ data: [] as { place_id: string; name: string }[] }),
    topicIds.length
      ? service.from('topics').select('id, slug, name').in('id', topicIds)
      : Promise.resolve({ data: [] as { id: string; slug: string; name: string }[] }),
    phrases.length
      ? service.from('interest_phrases').select('normalized_phrase, topic_text, place_type, place_id').in('normalized_phrase', phrases)
      : Promise.resolve({ data: [] as { normalized_phrase: string; topic_text: string | null; place_type: string | null; place_id: string | null }[] }),
    ctx.legislatorIds.length
      ? service.from('legislators').select('id, full_name, title').in('id', ctx.legislatorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; title: string | null }[] }),
  ])

  const ntaNames = new Map((ntaRes.data ?? []).map((r) => [r.place_id, r.name]))
  const topics = new Map((topicRes.data ?? []).map((r) => [r.id, r]))
  const parses = new Map((phraseRes.data ?? []).map((r) => [r.normalized_phrase, r]))
  const legislators = new Map((legRes.data ?? []).map((r) => [r.id, r]))

  // Place names (and coverage) for typed interests that name a place
  const placeKeys = [...parses.values()].filter((p) => p.place_type && p.place_id)
  const placeInfo = new Map<string, { name: string; covered: boolean }>()
  if (placeKeys.length) {
    const { data } = await service
      .from('places')
      .select('place_type, place_id, name, covered')
      .in('place_id', placeKeys.map((p) => p.place_id!))
    for (const p of data ?? []) placeInfo.set(`${p.place_type}:${p.place_id}`, { name: p.name, covered: p.covered })
  }

  const planned: Planned[] = []
  const has = (type: string) => ctx.jurisdictions.some((j) => j.type === type)
  for (const level of LEVEL_ORDER) {
    if (has(level)) planned.push({ key: `jurisdiction:${level}`, kind: 'jurisdiction', title: LEVEL_TITLES[level], comingSoon: null })
  }
  for (const nta of ntaCodes) {
    const name = ntaNames.get(nta)
    if (name) planned.push({ key: `place:neighborhood:${nta}`, kind: 'neighborhood', title: name, comingSoon: null, nta })
  }
  for (const t of ctx.topics) {
    if (t.kind === 'topic') {
      const topic = topics.get(t.id)
      if (topic) planned.push({ key: `topic:${topic.slug}`, kind: 'topic', title: topic.name, comingSoon: null })
      continue
    }
    const parse = parses.get(t.phrase)
    const place = parse?.place_type && parse.place_id ? placeInfo.get(`${parse.place_type}:${parse.place_id}`) : undefined
    planned.push({
      key: `interest:${t.phrase}`,
      kind: 'topic',
      title: place && parse?.topic_text ? `${parse.topic_text} · ${place.name}` : t.display,
      comingSoon: place && !place.covered ? { place: place.name } : null,
    })
  }
  for (const id of ctx.legislatorIds) {
    const l = legislators.get(id)
    if (l) planned.push({ key: `politician:${id}`, kind: 'politician', title: `${l.full_name} · ${l.title ?? 'Council Member'}`, comingSoon: null })
  }
  return [...new Map(planned.map((p) => [p.key, p])).values()] // a widget appears once
}

async function readCache(service: SupabaseClient, keys: string[]) {
  const cache = new Map<string, { items: WidgetItem[]; configVersion: number | null }>()
  if (!keys.length) return cache
  const { data, error } = await service.from('widget_cache').select('widget_key, items, config_version').in('widget_key', keys)
  if (error) throw new Error(`widget_cache read failed: ${error.message}`)
  for (const r of data ?? []) {
    cache.set(r.widget_key, { items: (r.items as WidgetItem[]) ?? [], configVersion: (r.config_version as number | null) ?? null })
  }
  return cache
}

// Tracked: followed or stanced legislation. Not scored: next event first, then latest activity.
async function trackedItems(service: SupabaseClient, userId: string, limit: number): Promise<{ items: RawItem[]; total: number }> {
  const [follows, stances] = await Promise.all([
    service.from('legislation_follows').select('legislation_id').eq('user_id', userId),
    service.from('user_stances').select('legislation_id').eq('user_id', userId),
  ])
  const ids = [...new Set([...(follows.data ?? []), ...(stances.data ?? [])].map((r) => r.legislation_id as string))]
  if (!ids.length) return { items: [], total: 0 }
  const { data } = await service.from('content_items').select(LIST_COLUMNS).in('legislation_id', ids.slice(0, 500))
  const now = Date.now()
  const rows = ((data ?? []) as ListItemRow[]).sort((a, b) => {
    const ae = a.next_event_at && new Date(a.next_event_at).getTime() >= now ? new Date(a.next_event_at).getTime() : Infinity
    const be = b.next_event_at && new Date(b.next_event_at).getTime() >= now ? new Date(b.next_event_at).getTime() : Infinity
    if (ae !== be) return ae - be
    return b.last_activity_at.localeCompare(a.last_activity_at)
  })
  return { items: rows.slice(0, limit).map(fromListRow), total: rows.length }
}

const STANCE_TEXT: Record<string, string> = {
  support: 'supports this',
  oppose: 'opposes this',
  neutral: 'is neutral on this',
  watching: 'is watching',
}

// Friend activity: what people the user follows did, most recent first. Not scored.
async function friendItems(
  service: SupabaseClient,
  userId: string,
  limit: number
): Promise<{ items: RawItem[]; total: number; followsSomeone: boolean }> {
  const { data: follows } = await service.from('user_follows').select('following_id').eq('follower_id', userId)
  const friendIds = (follows ?? []).map((f) => f.following_id as string)
  if (!friendIds.length) return { items: [], total: 0, followsSomeone: false }

  const [stances, comments, profiles] = await Promise.all([
    service
      .from('user_stances')
      .select('user_id, legislation_id, stance, updated_at')
      .in('user_id', friendIds)
      .order('updated_at', { ascending: false })
      .limit(50),
    service
      .from('comments')
      .select('user_id, legislation_id, created_at')
      .in('user_id', friendIds)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(50),
    service.from('user_profiles').select('id, display_name, username').in('id', friendIds),
  ])
  const names = new Map((profiles.data ?? []).map((p) => [p.id as string, (p.display_name || p.username) as string]))

  // Latest action per bill
  const actions = [
    ...(stances.data ?? []).map((s) => ({ legislationId: s.legislation_id as string, at: s.updated_at as string, text: `${names.get(s.user_id) ?? 'Someone'} ${STANCE_TEXT[s.stance] ?? 'weighed in'}` })),
    ...(comments.data ?? []).map((c) => ({ legislationId: c.legislation_id as string, at: c.created_at as string, text: `${names.get(c.user_id) ?? 'Someone'} commented` })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const latest = new Map<string, string>()
  for (const a of actions) if (!latest.has(a.legislationId)) latest.set(a.legislationId, a.text)
  if (!latest.size) return { items: [], total: 0, followsSomeone: true }

  const { data } = await service.from('content_items').select(LIST_COLUMNS).in('legislation_id', [...latest.keys()])
  const byLegislation = new Map(((data ?? []) as ListItemRow[]).map((r) => [r.legislation_id!, r]))
  const items: RawItem[] = []
  for (const [legislationId, text] of latest) {
    const row = byLegislation.get(legislationId)
    if (row) items.push({ ...fromListRow(row), label: text, personal: true })
  }
  return { items: items.slice(0, limit), total: items.length, followsSomeone: true }
}

export async function getFeed(service: SupabaseClient, ctx: FeedContext, opts: GetFeedOptions): Promise<FeedResponse> {
  const now = opts.now ?? new Date()
  const size = Math.max(1, Math.min(opts.size, 30))
  const popular = isPopular(ctx)

  const planned: Planned[] = popular
    ? [{ key: 'jurisdiction:city', kind: 'jurisdiction', title: LEVEL_TITLES.city, comingSoon: null }]
    : await planWidgets(service, ctx)

  // Neighbors of followed neighborhoods, for the Nearby top-up
  const ntas = planned.flatMap((p) => (p.nta ? [p.nta] : []))
  const adjacency = new Map<string, string[]>()
  if (ntas.length) {
    const { data } = await service.from('neighborhoods').select('nta_code, adjacent_ntas').in('nta_code', ntas)
    for (const r of data ?? []) adjacency.set(r.nta_code, r.adjacent_ntas as string[])
  }
  const neighborKeys = [...new Set([...adjacency.values()].flat())].map((c) => `place:neighborhood:${c}`)

  const cache = await readCache(service, [...planned.map((p) => p.key), ...neighborKeys, 'trending'])

  // Typed interests nobody has ranked recently: rank once now (≤ 1 Voyage call each), then cached
  const missing = planned.filter((p) => p.key.startsWith('interest:') && !cache.has(p.key) && !p.comingSoon)
  for (const p of missing.slice(0, MAX_INTEREST_RESOLVES)) {
    const topic = ctx.topics.find((t) => t.kind === 'interest' && `interest:${t.phrase}` === p.key)
    if (!topic || topic.kind !== 'interest') continue
    try {
      const resolved = await resolveInterest(service, topic.display, { itemCount: 30, schedule: opts.schedule })
      cache.set(p.key, { items: resolved.items, configVersion: resolved.configVersion })
    } catch (err) {
      console.error('getFeed: interest resolve failed:', err instanceof Error ? err.message : err)
    }
  }

  // Names for Nearby labels
  const neighborNames = new Map<string, string>()
  if (neighborKeys.length) {
    const { data } = await service
      .from('places')
      .select('place_id, name')
      .eq('place_type', 'neighborhood')
      .in('place_id', [...new Set([...adjacency.values()].flat())])
    for (const r of data ?? []) neighborNames.set(r.place_id, r.name)
  }

  type Built = Omit<FeedWidget, 'items'> & { raw: RawItem[]; configVersion?: number | null }
  const built: Built[] = planned.map((p) => {
    const items = (cache.get(p.key)?.items ?? []).map(fromWidgetItem)
    let raw = items.slice(0, size)
    let nearby: string | null = null
    if (p.nta && raw.length < Math.min(NEARBY_MIN, size)) {
      for (const code of adjacency.get(p.nta) ?? []) {
        const theirs = (cache.get(`place:neighborhood:${code}`)?.items ?? []).map(fromWidgetItem)
        if (!theirs.length) continue
        const seen = new Set(raw.map((i) => i.id))
        raw = [...raw, ...theirs.filter((i) => !seen.has(i.id))].slice(0, size)
        nearby = `Nearby: ${neighborNames.get(code) ?? code}`
        break
      }
    }
    return {
      key: p.key,
      kind: p.kind,
      title: p.title,
      raw: p.comingSoon ? [] : raw,
      total: p.comingSoon ? 0 : Math.max(items.length, raw.length),
      comingSoon: p.comingSoon,
      nearby,
      configVersion: cache.get(p.key)?.configVersion ?? null,
    }
  })

  // Home page lists: Tracked → Trending → Friend activity (design export S6)
  const trending = (cache.get('trending')?.items ?? []).map(fromWidgetItem)
  const trendingVersion = cache.get('trending')?.configVersion ?? null
  if (popular) {
    if (trending.length) built.push({ key: 'trending', kind: 'trending', title: 'Trending', raw: trending.slice(0, size), total: trending.length, comingSoon: null, nearby: null, configVersion: trendingVersion })
  } else if (opts.lists) {
    const tracked = ctx.userId ? await trackedItems(service, ctx.userId, size) : { items: [], total: 0 }
    const friends = ctx.userId ? await friendItems(service, ctx.userId, size) : { items: [], total: 0, followsSomeone: false }
    built.push({ key: 'tracked', kind: 'tracked', title: 'Tracked', raw: tracked.items, total: tracked.total, comingSoon: null, nearby: null })
    if (trending.length) built.push({ key: 'trending', kind: 'trending', title: 'Trending', raw: trending.slice(0, size), total: trending.length, comingSoon: null, nearby: null, configVersion: trendingVersion })
    built.push({ key: 'friend_activity', kind: 'friends', title: 'Friend activity', raw: friends.items, total: friends.total, comingSoon: null, nearby: null })
  }

  // Item pages live at /legislation/[slug]. Cards use the plain-language headline
  // when there is one ("NYC bans live boiling of lobsters…"), like the design export.
  const legislationIds = [...new Set(built.flatMap((w) => w.raw.flatMap((i) => (i.legislationId ? [i.legislationId] : []))))]
  const legislation = new Map<string, { slug: string; headline: string | null }>()
  if (legislationIds.length) {
    const { data } = await service.from('legislation').select('id, slug, short_summary').in('id', legislationIds)
    for (const r of data ?? []) legislation.set(r.id, { slug: r.slug, headline: r.short_summary?.trim() || null })
  }

  // "New ·" relative to what the preview showed last
  const prevWidgets = new Set(opts.previous?.widgets ?? [])
  const prevPairs = new Set(opts.previous?.pairs ?? [])
  const diff = !!opts.previous
  const added = { titles: [] as string[], items: 0 }
  let newPairs = 0

  const logged: Parameters<typeof impressionRows>[0] = []
  const widgets: FeedWidget[] = built.map(({ raw, configVersion, ...w }) => {
    const sectionIsNew = diff && !prevWidgets.has(w.key)
    if (sectionIsNew) added.titles.push(w.title)
    const items: FeedItem[] = raw.map((i) => {
      const isNew = diff && !prevPairs.has(`${w.key}|${i.id}`)
      if (isNew) {
        newPairs++
        if (sectionIsNew) added.items++
      }
      const leg = i.legislationId ? legislation.get(i.legislationId) : undefined
      return {
        id: i.id,
        typeLabel: typeLabel(i.itemType),
        statusLabel: statusLabel(i.stage, i.itemType),
        title: leg?.headline ?? i.title,
        label: i.label ?? contextLabel(i, now),
        personal: !!i.personal,
        href: itemHref({ legislationSlug: leg?.slug ?? null, url: i.url }),
        isNew,
      }
    })
    logged.push({
      key: w.key,
      configVersion: configVersion ?? null,
      items: raw.map((i, n) => ({ id: i.id, score: i.score ?? 0, signals: i.signals ?? {}, label: items[n].label, isNew: items[n].isNew })),
    })
    return { ...w, items }
  })
  if (!added.titles.length) added.items = newPairs

  if (opts.log) {
    const rows = impressionRows(logged, opts.log, diff)
    if (opts.schedule) opts.schedule(() => insertImpressions(service, rows))
    else await insertImpressions(service, rows)
  }

  const versions = [...cache.values()].map((c) => c.configVersion).filter((v): v is number => v != null)
  return { popular, widgets, added, configVersion: versions.length ? Math.max(...versions) : null }
}

// "See all" for one shared widget: the same section, up to the 30 cached items
export async function getSection(service: SupabaseClient, key: string, now = new Date()): Promise<FeedWidget | null> {
  const ctx: FeedContext = { userId: null, jurisdictions: [], topics: [], legislatorIds: [] }
  const [kind, ...rest] = key.split(':')
  const id = rest.join(':')
  if (kind === 'jurisdiction' && ['federal', 'state', 'city'].includes(id)) ctx.jurisdictions.push({ type: id, id: id === 'city' ? 'nyc' : id })
  else if (kind === 'place' && id.startsWith('neighborhood:')) ctx.jurisdictions.push({ type: 'neighborhood', id: id.slice('neighborhood:'.length) })
  else if (kind === 'politician' && id) ctx.legislatorIds.push(id)
  else if (kind === 'interest' && id) ctx.topics.push({ kind: 'interest', phrase: id, display: id })
  else if (kind === 'topic' && id) {
    const { data } = await service.from('topics').select('id').eq('slug', id).maybeSingle()
    if (!data) return null
    ctx.topics.push({ kind: 'topic', id: data.id })
  } else return null

  const feed = await getFeed(service, ctx, { size: 30, now })
  return feed.widgets.find((w) => w.key === key) ?? null
}
