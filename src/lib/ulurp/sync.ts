import { createServiceClient } from '@/lib/supabase/server'
import { fetchZapProjects } from './client'
import type { ZapProject } from './types'

const BOROUGH_DIGITS: Record<string, string> = {
  manhattan: '1',
  bronx: '2',
  'the bronx': '2',
  brooklyn: '3',
  queens: '4',
  'staten island': '5',
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// "X10" + "Bronx" → "210" (matches community_districts.boro_cd format)
function toBoroCd(communityDistrict: string | undefined, borough: string | undefined): string | null {
  if (!communityDistrict || !borough) return null
  const digit = BOROUGH_DIGITS[borough.toLowerCase()]
  if (!digit) return null
  const cdNum = communityDistrict.replace(/\D/g, '')
  if (!cdNum) return null
  return `${digit}${cdNum.padStart(2, '0')}`
}

// actions/ceqr_type is only ~4.6% populated in ZAP — fall back to keyword
// matching on the project brief. Documented heuristic (Open Question 2 in
// the V2 neighborhood-map plan); defaults to housing_site when ambiguous.
function classifyProposalType(p: ZapProject): 'ulurp_housing_site' | 'ulurp_rezoning_area' {
  const haystack = `${p.actions ?? ''} ${p.ceqr_type ?? ''} ${p.project_brief ?? ''}`.toLowerCase()
  if (/rezon|zoning map amendment|zma\b/.test(haystack)) return 'ulurp_rezoning_area'
  return 'ulurp_housing_site'
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export async function syncUlurpProposals(): Promise<{
  fetched: number
  synced: number
  skippedNoDistrict: number
  errors: string[]
}> {
  const errors: string[] = []
  const projects = await fetchZapProjects()
  const supabase = createServiceClient()

  const { data: districtRows } = await supabase
    .from('community_districts')
    .select('boro_cd, slug, geometry, bbox')

  const districtByBoroCd = new Map((districtRows ?? []).map((d) => [d.boro_cd, d]))

  // Proposals already upgraded from the centroid fallback to a real geocoded
  // point (via the admin "Geocode ULURP Proposals" job) must keep that
  // location on re-sync — otherwise this daily cron would silently revert
  // every geocoded proposal back to its district centroid each night.
  const { data: preciseRows } = await supabase
    .from('local_proposals')
    .select('source_id, geometry_type, geometry, bbox')
    .eq('source', 'zap_ulurp')
    .eq('geometry_precise', true)

  const preciseBySourceId = new Map((preciseRows ?? []).map((r) => [r.source_id, r]))

  let synced = 0
  let skippedNoDistrict = 0

  for (const p of projects) {
    const boroCd = toBoroCd(p.community_district, p.borough)
    const district = boroCd ? districtByBoroCd.get(boroCd) : null
    if (!district) {
      skippedNoDistrict++
      continue
    }

    // No BBL/lat-long on this dataset (see Open Question 1) — plot at the
    // district's bbox center as a documented fallback until a BBL join lands.
    const bbox = district.bbox as [number, number, number, number]
    const centroid: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]

    const title = p.project_name?.trim() || `ULURP Application ${p.project_id}`
    const slug = `ulurp-${toSlug(p.project_id)}`
    const status = p.public_status?.trim() || p.project_status?.trim() || 'Unknown'
    const lastActionDate =
      parseDate(p.current_milestone_date) ??
      parseDate(p.approval_date) ??
      parseDate(p.certified_referred) ??
      parseDate(p.app_filed_date)

    const precise = preciseBySourceId.get(p.project_id)

    // Geometry columns are NOT NULL, so a Postgres upsert needs a value for
    // them regardless of whether it resolves to an insert or an update —
    // re-supply the existing geocoded point for already-precise proposals
    // instead of the fallback centroid, so re-syncing doesn't revert them.
    const geometryFields = precise
      ? { geometry_type: precise.geometry_type, geometry: precise.geometry, bbox: precise.bbox }
      : {
          geometry_type: 'point' as const,
          geometry: { type: 'Point' as const, coordinates: centroid },
          bbox: [centroid[0], centroid[1], centroid[0], centroid[1]],
        }

    const { data: proposal, error } = await supabase
      .from('local_proposals')
      .upsert(
        {
          source: 'zap_ulurp',
          source_id: p.project_id,
          proposal_family: 'ulurp',
          proposal_type: classifyProposalType(p),
          community_districts: [district.slug],
          title,
          description: p.project_brief?.trim() || null,
          status,
          borough: p.borough ?? null,
          lead_agency: 'DCP',
          slug,
          source_url: `https://zap.planning.nyc.gov/projects/${p.project_id}`,
          filed_date: parseDate(p.app_filed_date),
          last_action_date: lastActionDate,
          updated_at: new Date().toISOString(),
          ...geometryFields,
        },
        { onConflict: 'source,source_id' }
      )
      .select('id')
      .single()

    if (error || !proposal) {
      errors.push(`${p.project_id}: ${error?.message ?? 'upsert failed'}`)
      continue
    }

    await supabase.from('ulurp_proposal_details').upsert(
      {
        local_proposal_id: proposal.id,
        ceqr_number: p.ceqr_number ?? null,
        ceqr_type: p.ceqr_type ?? null,
        actions: p.actions ?? null,
        ulurp_numbers: p.ulurp_non ?? null,
        cc_district: p.cc_district ?? null,
        mih_flag: p.mih_flag ? p.mih_flag.toLowerCase() === 'true' || p.mih_flag === '1' : null,
        public_status: p.public_status ?? null,
      },
      { onConflict: 'local_proposal_id' }
    )

    // Append a history row only if the milestone actually changed.
    if (p.current_milestone) {
      const { data: lastHistory } = await supabase
        .from('local_proposal_history')
        .select('milestone_text')
        .eq('local_proposal_id', proposal.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (lastHistory?.milestone_text !== p.current_milestone) {
        await supabase.from('local_proposal_history').insert({
          local_proposal_id: proposal.id,
          milestone_date: parseDate(p.current_milestone_date),
          milestone_text: p.current_milestone,
        })
      }
    }

    synced++
  }

  return { fetched: projects.length, synced, skippedNoDistrict, errors: errors.slice(0, 20) }
}
