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
  created_at: string | null // when our sync first saw the matter
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

// The Council's decision on a Land Use application, folded into the LU item
export interface LandUseDecision {
  fileNumber: string // the resolution, e.g. "Res 0712-2026"
  outcome: 'approved' | 'approved_with_modifications' | 'disapproved' | 'affirmed' | 'other'
  status: string
  date: string | null
  url: string | null
}

// One oversight hearing held jointly by several committees, each filing its own T-item
export interface JointHearing {
  canonical: string // the lowest file number, the one emitted
  fileNumbers: string[]
  committees: string[]
}

// Lookups the adapter preloads once per run
export interface AdapterContext {
  landUseTitles: Map<string, string> // LU file number → title
  landUseDecisions: Map<string, LandUseDecision> // LU file number → its Council decision
  jointHearings: Map<string, JointHearing> // any member's file number → its group
  mayoralActors: Map<string, string[]> // legislation ID → external IDs of mayors who acted on it
  landUseLocations: Map<string, { ntaCodes: string[]; zapProjectId: string | null }> // LU file number → land_use_locations
}

export const emptyContext = (): AdapterContext => ({
  landUseTitles: new Map(),
  landUseDecisions: new Map(),
  jointHearings: new Map(),
  mayoralActors: new Map(),
  landUseLocations: new Map(),
})

// Manual officials (build plan B10) are attached by "manual:<slug>" IDs
export interface MayorTerm {
  externalId: string
  termStart: string // YYYY-MM-DD
}

// History actions the Mayor takes ("Signed Into Law by Mayor", "Vetoed by Mayor",
// "Hearing Held by Mayor"…). "Sent to Mayor by Council" and "… by Mayor
// Cancelled" don't end this way. "Returned Unsigned by Mayor" (law without a
// signature) is excluded: the Mayor didn't act on the bill (product decision).
export const isMayoralAction = (actionText: string) => {
  const text = actionText.trim()
  return /\bby Mayor$/i.test(text) && !/^Returned Unsigned/i.test(text)
}

// Credits each mayoral action to the mayor in office on that date, so a
// predecessor's vetoes never land in the current Mayor's widget
export function buildMayoralActors(
  actions: { legislation_id: string; action_date: string | null; action_text: string }[],
  mayors: MayorTerm[]
): Map<string, string[]> {
  const terms = [...mayors].sort((a, b) => b.termStart.localeCompare(a.termStart)) // latest first
  const actors = new Map<string, string[]>()
  for (const a of actions) {
    if (!a.action_date || !isMayoralAction(a.action_text)) continue
    const date = a.action_date.slice(0, 10)
    const mayor = terms.find((m) => date >= m.termStart)
    if (!mayor) continue
    const list = actors.get(a.legislation_id) ?? []
    if (!list.includes(mayor.externalId)) actors.set(a.legislation_id, [...list, mayor.externalId])
  }
  return actors
}

export function decisionOutcome(title: string): LandUseDecision['outcome'] {
  const t = title.trim()
  if (/^Resolution approving with modifications/i.test(t)) return 'approved_with_modifications'
  if (/^Resolution disapproving/i.test(t)) return 'disapproved'
  if (/^Resolution affirming/i.test(t)) return 'affirmed'
  if (/^Resolution approving/i.test(t)) return 'approved'
  return 'other'
}

type DecisionRow = Pick<
  LegistarContentRow,
  'file_number' | 'title' | 'type' | 'status' | 'intro_date' | 'last_action_date' | 'legistar_url' | 'committees'
>

// LU file number → the Land Use resolution that decided it (one per LU item in practice)
export function buildLandUseDecisions(rows: DecisionRow[], landUseTitles: Map<string, string>): Map<string, LandUseDecision> {
  const decisions = new Map<string, LandUseDecision>()
  for (const r of rows) {
    if (/^T\d/.test(r.file_number) || !isLandUseResolution(r)) continue
    const lu = linkedLandUseFile(r)
    if (!lu || !landUseTitles.has(lu)) continue
    const decision: LandUseDecision = {
      fileNumber: r.file_number,
      outcome: decisionOutcome(r.title),
      status: r.status,
      date: latestDate(r.last_action_date, r.intro_date),
      url: r.legistar_url,
    }
    const prior = decisions.get(lu)
    if (!prior || (decision.date ?? '') > (prior.date ?? '')) decisions.set(lu, decision) // latest wins
  }
  return decisions
}

const hearingKey = (title: string, date: string | null) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${date ?? ''}`

// Oversight T-items with the same title on the same date are one joint hearing
export function buildJointHearings(
  rows: Pick<LegistarContentRow, 'file_number' | 'title' | 'intro_date' | 'committees'>[]
): Map<string, JointHearing> {
  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    if (!/^T\d/.test(r.file_number) || !/^Oversight/i.test(r.title.trim())) continue
    const key = hearingKey(r.title, r.intro_date)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }
  const byFile = new Map<string, JointHearing>()
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const fileNumbers = members.map((m) => m.file_number).sort()
    const committees = [...new Set(members.map((m) => m.committees?.name).filter((n): n is string => !!n))].sort()
    const group = { canonical: fileNumbers[0], fileNumbers, committees }
    for (const f of fileNumbers) byFile.set(f, group)
  }
  return byFile
}

export function toContentItem(
  row: LegistarContentRow,
  now: Date = new Date(),
  ctx: AdapterContext = emptyContext()
): NormalizedItem | null {
  const itemType = classify(row)
  if (!itemType || !row.legistar_url) return null

  // Folded into another item: a Land Use decision into its LU item, a joint
  // hearing's extra filings into the first one
  if (itemType === 'resolution' && isLandUseResolution(row)) {
    const lu = linkedLandUseFile(row)
    if (lu && ctx.landUseTitles.has(lu)) return null
  }
  const joint = itemType === 'hearing' ? ctx.jointHearings.get(row.file_number) : undefined
  if (joint && joint.canonical !== row.file_number) return null
  const decision = itemType === 'project' ? ctx.landUseDecisions.get(row.file_number) : undefined

  // Activity is only what has already happened. An oversight hearing's
  // intro/last-action date is the hearing date itself, which is often ahead;
  // a future hearing counts from when we first saw it, and its date becomes
  // next_event_at so the §6.3 upcoming curve ranks it.
  const today = now.toISOString().slice(0, 10)
  const past = (d: string | null | undefined) => (d && d.slice(0, 10) <= today ? d : null)
  const dates = [row.legislation_history[0]?.action_date, row.last_action_date, row.intro_date, decision?.date]
  if (!latestDate(...dates)) return null // no dates at all: skip, as before
  const lastActivity = latestDate(...dates.map(past)) ?? row.created_at
  if (!lastActivity) return null

  // Hearing dates carry no time; midday Eastern keeps the same calendar day in New York
  const hearingAt = itemType === 'hearing' && row.intro_date && row.intro_date >= today ? `${row.intro_date}T17:00:00Z` : null
  const nextEventAt = [...row.events.map((e) => e.event_date), hearingAt]
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
    if (linked) landUseDistricts = parseCouncilDistricts(ctx.landUseTitles.get(linked) ?? '')
  }

  // An LU item's own location (its tax lots or address) puts it in neighborhood widgets
  const location = itemType === 'project' ? ctx.landUseLocations.get(row.file_number) : undefined
  const places: NormalizedItem['places'] = isLandUse
    ? [
        ...landUseDistricts.map((id) => ({ type: 'council_district' as const, id })),
        ...(location?.ntaCodes ?? []).map((id) => ({ type: 'neighborhood' as const, id })),
      ]
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
  // The Mayor is an actor on items they signed, vetoed, withdrew or held a hearing on
  for (const externalId of ctx.mayoralActors.get(row.id) ?? []) {
    people.push({ legislatorExternalId: externalId, role: 'actor' })
  }

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
    metadata: {
      file_number: row.file_number,
      slug: row.slug,
      ...(decision ? { council_decision: decision } : {}),
      // Its ZAP proposal is folded into this item (recommendations plan Q8)
      ...(location?.zapProjectId
        ? { zap: { project_id: location.zapProjectId, url: `https://zap.planning.nyc.gov/projects/${location.zapProjectId}` } }
        : {}),
      ...(itemType === 'hearing'
        ? {
            committees: joint?.committees ?? (row.committees ? [row.committees.name] : []),
            ...(joint ? { joint_file_numbers: joint.fileNumbers } : {}),
          }
        : {}),
    },
    legislationId: row.id,
  }
}

const SELECT = `
  id, slug, file_number, title, status, type, intro_date, last_action_date,
  ai_summary, official_summary, legistar_url, created_at,
  sponsorships(is_primary, legislators(legistar_id, district)),
  committee_id,
  legislation_topics(topics(slug)),
  legislation_history(action_date),
  events(event_date)
`

async function readAll<T>(
  label: string,
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999)
    if (error) throw new Error(`[nyc-legistar] ${label} read failed: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

async function loadContext(supabase: SupabaseClient, committeeNames: Map<string, string>): Promise<AdapterContext> {
  const withCommittee = <R extends { committee_id: string | null }>(r: R) => {
    const name = r.committee_id ? committeeNames.get(r.committee_id) : undefined
    return { ...r, committees: name ? { name } : null }
  }

  const [landUse, resolutions, hearings] = await Promise.all([
    readAll<{ file_number: string; title: string }>('Land Use titles', (from, to) =>
      supabase.from('legislation').select('file_number, title').like('file_number', 'LU %').order('file_number').range(from, to)
    ),
    readAll<Omit<DecisionRow, 'committees'> & { committee_id: string | null }>('Land Use resolutions', (from, to) =>
      supabase
        .from('legislation')
        .select('file_number, title, type, status, intro_date, last_action_date, legistar_url, committee_id')
        .eq('type', 'resolution')
        .ilike('title', '%L.U. No%')
        .order('file_number')
        .range(from, to)
    ),
    readAll<{ file_number: string; title: string; intro_date: string | null; committee_id: string | null }>(
      'oversight hearings',
      (from, to) =>
        supabase
          .from('legislation')
          .select('file_number, title, intro_date, committee_id')
          .like('file_number', 'T%')
          .ilike('title', '%Oversight%')
          .order('file_number')
          .range(from, to)
    ),
  ])

  const landUseTitles = new Map(landUse.map((r) => [r.file_number, r.title]))
  return {
    landUseTitles,
    landUseDecisions: buildLandUseDecisions(resolutions.map(withCommittee), landUseTitles),
    jointHearings: buildJointHearings(hearings.map(withCommittee)),
    mayoralActors: await loadMayoralActors(supabase),
    landUseLocations: await loadLandUseLocations(supabase),
  }
}

async function loadLandUseLocations(supabase: SupabaseClient): Promise<AdapterContext['landUseLocations']> {
  const rows = await readAll<{ file_number: string; nta_codes: string[]; zap_project_id: string | null }>(
    'Land Use locations',
    (from, to) => supabase.from('land_use_locations').select('file_number, nta_codes, zap_project_id').order('file_number').range(from, to)
  ).catch((err) => {
    // Before migration 027 there's no table; Land Use items keep their council districts only
    console.warn(err instanceof Error ? err.message : err)
    return []
  })
  return new Map(rows.map((r) => [r.file_number, { ntaCodes: r.nta_codes ?? [], zapProjectId: r.zap_project_id }]))
}

async function loadMayoralActors(supabase: SupabaseClient): Promise<Map<string, string[]>> {
  const { data: mayors, error } = await supabase
    .from('legislators')
    .select('slug, term_start')
    .eq('is_manual', true)
    .eq('title', 'Mayor')
    .not('term_start', 'is', null)
  if (error) {
    // Before migration 026 there are no manual records; ingest carries on without them
    console.warn(`[nyc-legistar] mayor read failed, skipping mayoral actors: ${error.message}`)
    return new Map()
  }
  const terms: MayorTerm[] = (mayors ?? []).map((m) => ({ externalId: `manual:${m.slug}`, termStart: m.term_start as string }))
  if (!terms.length) return new Map()

  const earliest = terms.map((t) => t.termStart).sort()[0]
  const actions = await readAll<{ legislation_id: string; action_date: string | null; action_text: string }>(
    'mayoral actions',
    (from, to) =>
      supabase
        .from('legislation_history')
        .select('legislation_id, action_date, action_text')
        .ilike('action_text', '%by Mayor')
        .gte('action_date', earliest)
        .order('id')
        .range(from, to)
  )
  return buildMayoralActors(actions, terms)
}

async function loadCommitteeNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('committees').select('id, name')
  if (error) throw new Error(`[nyc-legistar] committees read failed: ${error.message}`)
  return new Map((data ?? []).map((c) => [c.id as string, c.name as string]))
}

export function createNycLegistarAdapter(supabase: SupabaseClient): SourceAdapter<LegistarContentRow> {
  const now = new Date()
  let ctx = emptyContext()

  return {
    slug: 'nyc-legistar',
    fullScan: true,

    // Full scan every run: legislation.updated_at never changes, and summaries,
    // sponsors and history change without touching it. The runner skips
    // unchanged items by hash, so `since` is ignored here.
    async *fetchChanged() {
      const committeeNames = await loadCommitteeNames(supabase)
      ctx = await loadContext(supabase, committeeNames)
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

    toContentItem: (row) => toContentItem(row, now, ctx),
  }
}
