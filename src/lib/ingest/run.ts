import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IngestResult, NormalizedItem, SourceAdapter } from './types'

// Shared runner for every source (recommendations-plan.md §4.1).
// Adapters only produce NormalizedItems; this resolves IDs, hashes, and writes.

const BATCH_SIZE = 200
const PAGE_SIZE = 1000

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// Hash of the text that gets embedded. A change triggers re-embedding (Phase 2).
export function contentHash(title: string, summary: string | null): string {
  return sha256(`${title}\n\n${summary ?? ''}`)
}

// JSON with sorted keys, so the same item always hashes the same
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// PostgREST caps responses at 1000 rows, so page through lookup tables
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

interface Lookups {
  legislatureIdBySlug: Map<string, string>
  legislatorIdByExternalId: Map<string, string>
  topicIdByKey: Map<string, string> // `${legislature_id}:${slug}`, plus bare slug as fallback
}

async function loadLookups(supabase: SupabaseClient, sourceId: string): Promise<Lookups> {
  const [legislatures, externalIds, topics] = await Promise.all([
    fetchAll<{ id: string; slug: string }>((from, to) =>
      supabase.from('legislatures').select('id, slug').range(from, to)
    ),
    fetchAll<{ external_id: string; legislator_id: string }>((from, to) =>
      supabase
        .from('legislator_external_ids')
        .select('external_id, legislator_id')
        .eq('source_id', sourceId)
        .range(from, to)
    ),
    fetchAll<{ id: string; slug: string; legislature_id: string | null }>((from, to) =>
      supabase.from('topics').select('id, slug, legislature_id').range(from, to)
    ),
  ])

  const topicIdByKey = new Map<string, string>()
  for (const t of topics) {
    topicIdByKey.set(`${t.legislature_id}:${t.slug}`, t.id)
    if (!topicIdByKey.has(t.slug)) topicIdByKey.set(t.slug, t.id)
  }

  return {
    legislatureIdBySlug: new Map(legislatures.map((l) => [l.slug, l.id])),
    legislatorIdByExternalId: new Map(externalIds.map((e) => [e.external_id, e.legislator_id])),
    topicIdByKey,
  }
}

// The row shape upsert_content_items() expects
interface ResolvedRow {
  external_id: string
  item_type: string
  title: string
  summary: string | null
  url: string
  jurisdiction_level: string
  legislature_id: string | null
  stage: string | null
  status_raw: string | null
  introduced_at: string | null
  last_activity_at: string
  next_event_at: string | null
  is_dead: boolean
  legislation_id: string | null
  metadata: Record<string, unknown>
  places: { type: string; id: string }[]
  people: { legislator_id: string; role: string }[]
  topic_ids: string[]
  content_hash: string
  ingest_hash: string
}

// Land Use applications and neighborhood projects with no activity in the
// last 12 months leave every widget (product decision 2026-11-22). They're
// marked dead rather than deleted, so new activity brings them back on the
// next run. Every adapter here re-emits its whole source each run, so items
// age out without changing.
export const PROJECT_STALE_DAYS = 365

export function isStaleProject(item: Pick<NormalizedItem, 'itemType' | 'lastActivityAt'>, now: Date): boolean {
  return item.itemType === 'project' && now.getTime() - new Date(item.lastActivityAt).getTime() > PROJECT_STALE_DAYS * 86_400_000
}

export function resolveItem(
  item: NormalizedItem,
  lookups: Lookups,
  now: Date = new Date()
): { row: ResolvedRow; unresolvedPeople: number; unresolvedTopics: number } {
  const legislatureId = item.legislatureSlug
    ? (lookups.legislatureIdBySlug.get(item.legislatureSlug) ?? null)
    : null

  let unresolvedPeople = 0
  const people: ResolvedRow['people'] = []
  for (const p of item.people) {
    const legislatorId = lookups.legislatorIdByExternalId.get(p.legislatorExternalId)
    if (legislatorId) people.push({ legislator_id: legislatorId, role: p.role })
    else unresolvedPeople++
  }

  let unresolvedTopics = 0
  const topicIds: string[] = []
  for (const slug of item.topicSlugs ?? []) {
    const id = lookups.topicIdByKey.get(`${legislatureId}:${slug}`) ?? lookups.topicIdByKey.get(slug)
    if (id) topicIds.push(id)
    else unresolvedTopics++
  }

  const base = {
    external_id: item.externalId,
    item_type: item.itemType,
    title: item.title,
    summary: item.summary,
    url: item.url,
    jurisdiction_level: item.jurisdictionLevel,
    legislature_id: legislatureId,
    stage: item.stage ?? null,
    status_raw: item.statusRaw ?? null,
    introduced_at: item.introducedAt ?? null,
    last_activity_at: item.lastActivityAt,
    next_event_at: item.nextEventAt ?? null,
    is_dead: item.isDead || isStaleProject(item, now),
    legislation_id: item.legislationId ?? null,
    metadata: item.metadata ?? {},
    places: item.places,
    people,
    topic_ids: topicIds.sort(),
    content_hash: contentHash(item.title, item.summary),
  }

  return {
    row: { ...base, ingest_hash: sha256(stableStringify(base)) },
    unresolvedPeople,
    unresolvedTopics,
  }
}

// Never prune more than this share of a source in one run; a bigger drop more
// likely means a broken read than a real change, so it's left for a human
const MAX_PRUNE_SHARE = 0.25

async function pruneUnemitted(supabase: SupabaseClient, sourceId: string, emitted: Set<string>): Promise<number> {
  if (emitted.size === 0) return 0
  const existing: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('content_items')
      .select('external_id')
      .eq('source_id', sourceId)
      .order('external_id')
      .range(from, from + 999)
    if (error) throw new Error(`Prune lookup failed: ${error.message}`)
    existing.push(...(data ?? []).map((r) => r.external_id as string))
    if (!data || data.length < 1000) break
  }

  const stale = existing.filter((id) => !emitted.has(id))
  if (stale.length > existing.length * MAX_PRUNE_SHARE) {
    console.warn(`[ingest] not pruning ${stale.length} of ${existing.length} items (over ${MAX_PRUNE_SHARE * 100}%)`)
    return 0
  }
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await supabase
      .from('content_items')
      .delete()
      .eq('source_id', sourceId)
      .in('external_id', stale.slice(i, i + 200))
    if (error) throw new Error(`Prune failed: ${error.message}`)
  }
  return stale.length
}

export async function runIngest<Raw>(
  supabase: SupabaseClient,
  adapter: SourceAdapter<Raw>
): Promise<IngestResult> {
  const result: IngestResult = {
    source: adapter.slug,
    seen: 0,
    skipped: 0,
    unchanged: 0,
    written: 0,
    removed: 0,
    unresolvedPeople: 0,
    unresolvedTopics: 0,
  }

  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .select('id, enabled, last_synced_at')
    .eq('slug', adapter.slug)
    .single()

  if (sourceError || !source) throw new Error(`Source "${adapter.slug}" not found in sources table`)
  if (!source.enabled) return result

  const startedAt = new Date()
  const lookups = await loadLookups(supabase, source.id)

  async function flush(batch: ResolvedRow[]) {
    if (batch.length === 0) return

    // Skip rows whose whole normalized item hasn't changed since the last write
    const { data: existing, error } = await supabase
      .from('content_items')
      .select('external_id, ingest_hash')
      .eq('source_id', source!.id)
      .in('external_id', batch.map((r) => r.external_id))
    if (error) throw new Error(`Ingest hash lookup failed: ${error.message}`)

    const hashByExternalId = new Map((existing ?? []).map((e) => [e.external_id, e.ingest_hash]))
    const changed = batch.filter((r) => hashByExternalId.get(r.external_id) !== r.ingest_hash)
    result.unchanged += batch.length - changed.length
    if (changed.length === 0) return

    const { data: written, error: writeError } = await supabase.rpc('upsert_content_items', {
      p_source_id: source!.id,
      p_items: changed,
    })
    if (writeError) throw new Error(`Content upsert failed: ${writeError.message}`)
    result.written += written ?? changed.length
  }

  let batch: ResolvedRow[] = []
  const seenIds = new Set<string>()
  const since = source.last_synced_at ? new Date(source.last_synced_at) : null

  for await (const raw of adapter.fetchChanged(since)) {
    result.seen++
    const item = adapter.toContentItem(raw)
    if (!item || seenIds.has(item.externalId)) {
      result.skipped++
      continue
    }
    seenIds.add(item.externalId)

    const { row, unresolvedPeople, unresolvedTopics } = resolveItem(item, lookups, startedAt)
    result.unresolvedPeople += unresolvedPeople
    result.unresolvedTopics += unresolvedTopics
    batch.push(row)

    if (batch.length >= BATCH_SIZE) {
      await flush(batch)
      batch = []
    }
  }
  await flush(batch)

  if (adapter.fullScan) result.removed = await pruneUnemitted(supabase, source.id, seenIds)

  await supabase.from('sources').update({ last_synced_at: startedAt.toISOString() }).eq('id', source.id)

  return result
}
