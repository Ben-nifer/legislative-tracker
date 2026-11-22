// Adapter contract for the content layer (recommendations-plan.md §4.1).
// Everything downstream of adapters only sees content_items.

export type ItemType =
  | 'bill'
  | 'resolution'
  | 'hearing'
  | 'project'
  | 'budget_item'
  | 'announcement'
  | 'news'

export type JurisdictionLevel = 'federal' | 'state' | 'city' | 'neighborhood'

export type Stage =
  | 'introduced'
  | 'in_committee'
  | 'hearing_scheduled'
  | 'passed_committee'
  | 'passed_chamber'
  | 'enacted'
  | 'vetoed'
  | 'dead'

export type PlaceType =
  | 'city'
  | 'council_district'
  | 'neighborhood'
  | 'state_senate'
  | 'assembly'
  | 'congressional'
  | 'state'

export type PersonRole = 'primary_sponsor' | 'sponsor' | 'actor'

export interface NormalizedItem {
  externalId: string
  itemType: ItemType
  title: string
  summary: string | null
  url: string
  jurisdictionLevel: JurisdictionLevel
  legislatureSlug?: string
  stage?: Stage
  statusRaw?: string
  introducedAt?: string
  lastActivityAt: string
  nextEventAt?: string
  isDead: boolean
  places: { type: PlaceType; id: string }[]
  people: { legislatorExternalId: string; role: PersonRole }[]
  topicSlugs?: string[]
  metadata?: Record<string, unknown>
  // Links the item back to `legislation` for bill-specific detail. Only set by
  // adapters that read our own legislation table (NYC Legistar).
  legislationId?: string
}

export interface SourceAdapter<Raw> {
  slug: string // matches sources.slug
  // `since` is the source's last_synced_at watermark (null on first run).
  // Adapters may ignore it and emit everything; the runner skips unchanged items.
  fetchChanged(since: Date | null): AsyncIterable<Raw>
  toContentItem(raw: Raw): NormalizedItem | null // null = skip
}

export interface IngestResult {
  source: string
  seen: number
  skipped: number // toContentItem returned null
  unchanged: number
  written: number
  unresolvedPeople: number
  unresolvedTopics: number
}
