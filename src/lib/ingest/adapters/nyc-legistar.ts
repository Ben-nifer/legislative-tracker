import type { SupabaseClient } from '@supabase/supabase-js'
import type { ItemType, NormalizedItem, SourceAdapter, Stage } from '../types'

// Reads the legislation rows that src/lib/legistar/sync.ts already writes and
// emits them as content items (recommendations-plan.md §4.2). It never calls
// the Legistar API itself.

const PAGE_SIZE = 200
const LEGISLATURE_SLUG = 'nyc-council'
const COUNCIL_DISTRICTS = 51

export interface LegistarContentRow {
  id: string
  slug: string
  file_number: string
  title: string
  status: string
  type: 'introduction' | 'resolution' | null
  intro_date: string | null
  last_action_date: string | null
  ai_summary: string | null
  official_summary: string | null
  legistar_url: string | null
  sponsorships: {
    is_primary: boolean | null
    legislators: { legistar_id: number | null; district: string | null } | null
  }[]
  committee_id: string | null
  committees: { name: string } | null // attached from committee_id (no FK to embed)
  legislation_topics: { topics: { slug: string } | null }[]
  legislation_history: { action_date: string | null }[] // newest only
  events: { event_date: string | null }[] // upcoming only
}

// NYC Council status → normalized stage (approved mapping, §5.2)
const STAGE_BY_STATUS: Record<string, Stage> = {
  'Introduced': 'introduced',
  'Committee': 'in_committee',
  'Laid Over in Committee': 'in_committee',
  'Deferred': 'in_committee',
  'Reported from Committee': 'passed_committee',
  'Reported from Committee and Introduced': 'passed_committee',
  'General Orders Calendar': 'passed_committee',
  'Coupled on Call-Up Vote': 'passed_committee',
  'Companion Pending Approval by Council': 'passed_committee',
  "Enacted (Mayor's Desk for Signature)": 'passed_chamber',
  'Enacted': 'enacted',
  'Adopted': 'enacted',
  'Local Laws': 'enacted',
  'Vetoed': 'vetoed',
  'Disapproved': 'vetoed',
  'Filed': 'dead',
  'Filed (End of Session)': 'dead',
  'Withdrawn': 'dead',
  'Defeated': 'dead',
  'Received, Ordered, Printed and Filed': 'dead',
}

export function mapStage(status: string, hasUpcomingEvent: boolean): Stage | undefined {
  const stage = STAGE_BY_STATUS[status]
  if (!stage) return undefined
  if (hasUpcomingEvent && (stage === 'introduced' || stage === 'in_committee')) return 'hearing_scheduled'
  return stage
}

// Intros and Resolutions by type; Land Use and Oversight hearings by file number.
// Mayoral communications (M), SLRs and other T-items are skipped. T-items are
// checked first: Legistar files a matter under a temporary T number before it
// gets its Int/Res number, so T-numbered Intros and Resolutions are duplicates.
export function classify(row: Pick<LegistarContentRow, 'type' | 'file_number' | 'title'>): ItemType | null {
  if (/^T\d/.test(row.file_number)) return /^Oversight/i.test(row.title.trim()) ? 'hearing' : null
  if (row.type === 'introduction') return 'bill'
  if (row.type === 'resolution') return 'resolution'
  if (/^LU\s/.test(row.file_number)) return 'project'
  return null
}

const LAND_USE_COMMITTEE = /land use|zoning and franchises|landmarks/i
const POLICY_RESOLUTION = /^Resolution (calling|in support|urging)/i

// The Council's decisions on Land Use applications ("Resolution approving the
// decision of the City Planning Commission…"). Like Land Use items, the listed
// sponsor is the committee chair. Policy resolutions in that committee aren't.
export function isLandUseResolution(row: Pick<LegistarContentRow, 'type' | 'title' | 'committees'>): boolean {
  return row.type === 'resolution' && LAND_USE_COMMITTEE.test(row.committees?.name ?? '') && !POLICY_RESOLUTION.test(row.title.trim())
}

// "(L.U. No. 151)" in a Land Use resolution → "LU 0151-2026", using the resolution's year
export function linkedLandUseFile(row: Pick<LegistarContentRow, 'title' | 'file_number'>): string | null {
  const luNo = row.title.match(/L\.U\. Nos?\.\s*(\d+)/)?.[1]
  const year = row.file_number.match(/-(\d{4})$/)?.[1]
  return luNo && year ? `LU ${luNo.padStart(4, '0')}-${year}` : null
}

// "…Council Districts 14 and 15." / "…Council District 10." → ['14', '15'] / ['10']
export function parseCouncilDistricts(title: string): string[] {
  const districts = new Set<string>()
  for (const match of title.matchAll(/Council Districts?\s+((?:\d+(?:\s*,\s*|\s+and\s+|\s*&\s*)?)+)/gi)) {
    for (const n of match[1].match(/\d+/g) ?? []) {
      const num = Number(n)
      if (num >= 1 && num <= COUNCIL_DISTRICTS) districts.add(String(num))
    }
  }
  return [...districts]
}

function nonEmpty(text: string | null): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}

function latestDate(...dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => !!d)
  return valid.length ? valid.reduce((a, b) => (a > b ? a : b)) : null
}

// landUseTitles: LU file number → title, for placing Land Use resolutions whose
// own title names no district
export function toContentItem(
  row: LegistarContentRow,
  now: Date = new Date(),
  landUseTitles: Map<string, string> = new Map()
): NormalizedItem | null {
  const itemType = classify(row)
  if (!itemType || !row.legistar_url) return null

  const lastActivity = latestDate(row.legislation_history[0]?.action_date, row.last_action_date, row.intro_date)
  if (!lastActivity) return null

  const nextEventAt = row.events
    .map((e) => e.event_date)
    .filter((d): d is string => !!d && new Date(d) > now)
    .sort()[0]

  const stage = mapStage(row.status, !!nextEventAt)
  if (!stage) console.warn(`[nyc-legistar] unmapped status "${row.status}" on ${row.file_number}`)

  const isLandUse = itemType === 'project' || isLandUseResolution(row)
  const primary = row.sponsorships.find((s) => s.is_primary)

  // Land Use items and resolutions live in the neighborhood banners, placed by
  // the districts named in their title (a resolution falls back to its LU
  // item's title). Their listed sponsor is the committee chair, not the local
  // member, so no people are attached.
  let landUseDistricts: string[] = []
  if (isLandUse) {
    landUseDistricts = parseCouncilDistricts(row.title)
    const linked = itemType === 'resolution' && !landUseDistricts.length ? linkedLandUseFile(row) : null
    if (linked) landUseDistricts = parseCouncilDistricts(landUseTitles.get(linked) ?? '')
  }

  const places: NormalizedItem['places'] = isLandUse
    ? landUseDistricts.map((id) => ({ type: 'council_district' as const, id }))
    : [
        { type: 'city' as const, id: 'nyc' },
        ...(primary?.legislators?.district
          ? [{ type: 'council_district' as const, id: primary.legislators.district }]
          : []),
      ]

  const people: NormalizedItem['people'] = isLandUse
    ? []
    : row.sponsorships
        .filter((s) => s.legislators?.legistar_id != null)
        .map((s) => ({
          legislatorExternalId: String(s.legislators!.legistar_id),
          role: s.is_primary ? ('primary_sponsor' as const) : ('sponsor' as const),
        }))

  return {
    externalId: row.file_number,
    itemType,
    title: row.title,
    summary: nonEmpty(row.ai_summary) ?? nonEmpty(row.official_summary),
    url: row.legistar_url,
    jurisdictionLevel: isLandUse ? 'neighborhood' : 'city',
    legislatureSlug: LEGISLATURE_SLUG,
    stage,
    statusRaw: row.status,
    introducedAt: row.intro_date ?? undefined,
    lastActivityAt: lastActivity,
    nextEventAt,
    isDead: stage === 'dead',
    places,
    people,
    topicSlugs: row.legislation_topics.map((t) => t.topics?.slug).filter((s): s is string => !!s),
    metadata: { file_number: row.file_number, slug: row.slug },
    legislationId: row.id,
  }
}

const SELECT = `
  id, slug, file_number, title, status, type, intro_date, last_action_date,
  ai_summary, official_summary, legistar_url,
  sponsorships(is_primary, legislators(legistar_id, district)),
  committee_id,
  legislation_topics(topics(slug)),
  legislation_history(action_date),
  events(event_date)
`

async function loadLandUseTitles(supabase: SupabaseClient): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('legislation')
      .select('file_number, title')
      .like('file_number', 'LU %')
      .order('file_number')
      .range(from, from + 999)
    if (error) throw new Error(`[nyc-legistar] Land Use titles read failed: ${error.message}`)
    for (const r of data ?? []) titles.set(r.file_number, r.title)
    if (!data || data.length < 1000) return titles
  }
}

async function loadCommitteeNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('committees').select('id, name')
  if (error) throw new Error(`[nyc-legistar] committees read failed: ${error.message}`)
  return new Map((data ?? []).map((c) => [c.id as string, c.name as string]))
}

export function createNycLegistarAdapter(supabase: SupabaseClient): SourceAdapter<LegistarContentRow> {
  const now = new Date()
  let landUseTitles = new Map<string, string>()

  return {
    slug: 'nyc-legistar',

    // Full scan every run: legislation.updated_at never changes, and summaries,
    // sponsors and history change without touching it. The runner skips
    // unchanged items by hash, so `since` is ignored here.
    async *fetchChanged() {
      landUseTitles = await loadLandUseTitles(supabase)
      const committeeNames = await loadCommitteeNames(supabase)
      let cursor = '00000000-0000-0000-0000-000000000000'
      for (;;) {
        const { data, error } = await supabase
          .from('legislation')
          .select(SELECT)
          .gt('id', cursor)
          .order('id')
          .order('action_date', { referencedTable: 'legislation_history', ascending: false, nullsFirst: false })
          .limit(1, { referencedTable: 'legislation_history' })
          .gte('events.event_date', now.toISOString())
          .limit(PAGE_SIZE)

        if (error) throw new Error(`[nyc-legistar] legislation read failed: ${error.message}`)
        const rows = (data ?? []) as unknown as LegistarContentRow[]
        for (const r of rows) {
          const name = r.committee_id ? committeeNames.get(r.committee_id) : undefined
          r.committees = name ? { name } : null
        }
        yield* rows
        if (rows.length < PAGE_SIZE) return
        cursor = rows[rows.length - 1].id
      }
    },

    toContentItem: (row) => toContentItem(row, now, landUseTitles),
  }
}
