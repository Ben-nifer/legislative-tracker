import type { SupabaseClient } from '@supabase/supabase-js'
import type { NormalizedItem, SourceAdapter, Stage } from '../types'

// Neighborhood adapter (onboarding-build-planv1.1.md §4.8, B12): serves the
// kept DOT/ULURP rows in `local_proposals` as neighborhood content items,
// tagged to the NTA 2020 neighborhoods their geometry intersects. It never
// calls ZAP or the DOT dataset; keeping local_proposals fresh is out of scope
// (build plan Q3). NTA matching runs in SQL (local_proposal_rows, migration 027).

const PAGE_SIZE = 500

// DOT rows carry no per-project link; the card falls back to the dataset
// (Street and Highway Capital Reconstruction Projects, Socrata jvk9-k4re)
export const DOT_DATASET_URL = 'https://data.cityofnewyork.us/d/jvk9-k4re'

export interface LocalProposalRow {
  id: string
  source: 'zap_ulurp' | 'dot_capital'
  source_id: string
  proposal_family: 'ulurp' | 'dot'
  proposal_type: 'ulurp_housing_site' | 'ulurp_rezoning_area' | 'dot_street_redesign' | 'dot_capital_construction'
  geometry_type: 'point' | 'line' | 'polygon'
  geometry_precise: boolean
  community_districts: string[]
  title: string
  description: string | null
  ai_summary: string | null
  status: string
  borough: string | null
  lead_agency: string | null
  slug: string
  source_url: string | null
  filed_date: string | null
  last_action_date: string | null
  created_at: string | null
  nta_codes: string[] // every NTA the geometry intersects, whatever its precision
  latest_milestone_date: string | null
  latest_milestone_text: string | null
  ulurp: {
    actions: string | null
    review_type: string | null // 'ULURP' | 'Non-ULURP'
    cc_district: string | null
    applicant_name: string | null
    applicant_type: string | null
    ceqr_number: string | null
    mih: boolean | null
  } | null
  dot: {
    project_type: string | null
    on_street: string | null
    from_street: string | null
    to_street: string | null
    construction_fy: string | null
    project_cost: number | null
  } | null
}

// ZAP public statuses and DOT project statuses → §5.2 stages. ZAP "Completed"
// covers approvals and withdrawals alike (the row doesn't say which), so it
// maps to the final-outcome stage rather than dead.
const STAGE_BY_STATUS: Record<string, Stage> = {
  // ZAP (ULURP and non-ULURP land use reviews)
  'Filed': 'introduced',
  'Noticed': 'introduced',
  'In Public Review': 'in_committee',
  'Completed': 'enacted',
  // DOT capital projects
  'Completed Project': 'enacted',
  'Substantial Completion': 'enacted',
  'Final Completion': 'enacted',
}

export function mapStage(status: string): Stage | undefined {
  return STAGE_BY_STATUS[status.trim()]
}

// Plan §4.8: only geometry flagged precise is tagged to neighborhoods. A
// district-centroid fallback point would land the item in whichever NTA holds
// the centroid. (Build plan Q5 remainder: approve or change this.)
export function hasPreciseGeometry(row: Pick<LocalProposalRow, 'geometry_precise'>): boolean {
  return row.geometry_precise
}

export function neighborhoodPlaces(row: Pick<LocalProposalRow, 'geometry_precise' | 'nta_codes'>): NormalizedItem['places'] {
  if (!hasPreciseGeometry(row)) return []
  return [...new Set(row.nta_codes)].sort().map((id) => ({ type: 'neighborhood' as const, id }))
}

function nonEmpty(text: string | null | undefined): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}

function latestDate(...dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => !!d)
  return valid.length ? valid.reduce((a, b) => (a > b ? a : b)) : null
}

export function toContentItem(row: LocalProposalRow, now: Date = new Date()): NormalizedItem | null {
  const title = nonEmpty(row.title)
  if (!title) return null

  const url = nonEmpty(row.source_url) ?? (row.source === 'dot_capital' ? DOT_DATASET_URL : null)
  if (!url) return null

  // Only dates that have passed count as activity; else when the row was loaded
  const today = now.toISOString().slice(0, 10)
  const past = (d: string | null | undefined) => (d && d.slice(0, 10) <= today ? d : null)
  const lastActivity =
    latestDate(past(row.last_action_date), past(row.latest_milestone_date), past(row.filed_date)) ?? row.created_at
  if (!lastActivity) return null

  const stage = mapStage(row.status)
  if (!stage) console.warn(`[nyc-local-proposals] unmapped status "${row.status}" on ${row.source}:${row.source_id}`)

  return {
    externalId: `${row.source}:${row.source_id}`,
    itemType: 'project',
    title,
    summary: nonEmpty(row.ai_summary) ?? nonEmpty(row.description),
    url,
    jurisdictionLevel: 'neighborhood',
    stage,
    statusRaw: row.status,
    introducedAt: row.filed_date ?? undefined,
    lastActivityAt: lastActivity,
    isDead: stage === 'dead',
    places: neighborhoodPlaces(row),
    people: [],
    metadata: {
      subtype: row.proposal_type,
      family: row.proposal_family,
      slug: row.slug,
      geometry_type: row.geometry_type,
      geometry_precise: row.geometry_precise,
      community_districts: row.community_districts,
      ...(row.borough ? { borough: row.borough } : {}),
      ...(row.lead_agency ? { lead_agency: row.lead_agency } : {}),
      ...(row.latest_milestone_text
        ? { latest_milestone: { date: row.latest_milestone_date, text: row.latest_milestone_text } }
        : {}),
      ...(row.ulurp ? { ulurp: row.ulurp } : {}),
      ...(row.dot ? { dot: row.dot } : {}),
    },
  }
}

export function createNycLocalProposalsAdapter(supabase: SupabaseClient): SourceAdapter<LocalProposalRow> {
  const now = new Date()

  return {
    slug: 'nyc-local-proposals',
    // local_proposals is the whole catalog, read in full each run (~1.6k rows);
    // the runner skips unchanged items by hash and prunes ones no longer there
    fullScan: true,

    async *fetchChanged() {
      let after: string | null = null
      for (;;) {
        const { data, error } = await supabase.rpc('local_proposal_rows', { p_after: after, p_limit: PAGE_SIZE })
        if (error) throw new Error(`[nyc-local-proposals] read failed: ${error.message}`)
        const rows = (data ?? []) as LocalProposalRow[]
        yield* rows
        if (rows.length < PAGE_SIZE) return
        after = rows[rows.length - 1].id
      }
    },

    toContentItem: (row) => toContentItem(row, now),
  }
}
