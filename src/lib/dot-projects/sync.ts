import { createServiceClient } from '@/lib/supabase/server'
import { fetchDotCapitalProjects } from './client'
import type { DotCapitalProject } from './types'
import { bboxOfGeometry, bboxesOverlap, pointInGeometry } from '@/lib/geo/point-in-polygon'

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function flattenLineVertices(geom: DotCapitalProject['the_geom']): [number, number][] {
  const coords = geom.coordinates
  if (geom.type === 'LineString') return coords as [number, number][]
  // MultiLineString: array of line parts, each an array of [lng, lat]
  return (coords as [number, number][][]).flat()
}

// Cap how many vertices we sample against district polygons so a long
// route doesn't blow up the ingestion run's time budget.
function sampleVertices(vertices: [number, number][], max = 25): [number, number][] {
  if (vertices.length <= max) return vertices
  const step = vertices.length / max
  return Array.from({ length: max }, (_, i) => vertices[Math.floor(i * step)]!)
}

function parseNumeric(value: string | undefined): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function syncDotCapitalProjects(): Promise<{
  fetched: number
  synced: number
  skippedNoGeometry: number
  errors: string[]
}> {
  const errors: string[] = []
  const projects = await fetchDotCapitalProjects()
  const supabase = createServiceClient()

  const { data: districtRows } = await supabase
    .from('community_districts')
    .select('slug, geometry, bbox')

  const districts = (districtRows ?? []).map((d) => ({
    slug: d.slug as string,
    geometry: d.geometry as { type: string; coordinates: unknown },
    bbox: d.bbox as [number, number, number, number],
  }))

  let synced = 0
  let skippedNoGeometry = 0

  for (const p of projects) {
    const vertices = flattenLineVertices(p.the_geom)
    if (vertices.length === 0) {
      skippedNoGeometry++
      continue
    }

    const isDegeneratePoint = vertices.every(
      (v) => v[0] === vertices[0]![0] && v[1] === vertices[0]![1]
    )

    const bbox = bboxOfGeometry(p.the_geom as { coordinates: unknown })

    const matchedDistrictSlugs = new Set<string>()
    for (const v of sampleVertices(vertices)) {
      for (const district of districts) {
        if (!bboxesOverlap(bbox, district.bbox)) continue
        if (pointInGeometry(v[0], v[1], district.geometry)) {
          matchedDistrictSlugs.add(district.slug)
        }
      }
    }

    if (matchedDistrictSlugs.size === 0) {
      skippedNoGeometry++
      continue
    }

    const geometry = isDegeneratePoint
      ? { type: 'Point' as const, coordinates: vertices[0]! }
      : p.the_geom

    const title =
      p.projtitle?.trim() ||
      [p.onstreetna, p.fromstreet, p.tostreetna].filter(Boolean).length === 3
        ? `${p.onstreetna} from ${p.fromstreet} to ${p.tostreetna}`
        : `DOT Capital Project ${p.projectid}`

    const proposalType =
      p.leadagency?.toUpperCase().includes('DOT') ? 'dot_street_redesign' : 'dot_capital_construction'

    const { data: proposal, error } = await supabase
      .from('local_proposals')
      .upsert(
        {
          source: 'dot_capital',
          source_id: p.projectid,
          proposal_family: 'dot',
          proposal_type: proposalType,
          geometry_type: isDegeneratePoint ? 'point' : 'line',
          geometry,
          bbox,
          community_districts: Array.from(matchedDistrictSlugs),
          title,
          description: p.projectt_1?.trim() || p.projecttyp?.trim() || null,
          status: p.projectsta?.trim() || 'Unknown',
          borough: p.boroughnam ?? null,
          lead_agency: p.leadagency ?? null,
          slug: `dot-${toSlug(p.projectid)}`,
          source_url: null,
          filed_date: null,
          last_action_date: p.constructi ? `${p.constructi}-01-01` : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'source,source_id' }
      )
      .select('id')
      .single()

    if (error || !proposal) {
      errors.push(`${p.projectid}: ${error?.message ?? 'upsert failed'}`)
      continue
    }

    await supabase.from('dot_proposal_details').upsert(
      {
        local_proposal_id: proposal.id,
        managing_agency: p.managingag ?? null,
        project_type_code: p.projecttyp ?? null,
        project_type_desc: p.projectt_1 ?? null,
        on_street_name: p.onstreetna ?? null,
        from_street_name: p.fromstreet ?? null,
        to_street_name: p.tostreetna ?? null,
        construction_fy: p.constructi ?? null,
        project_cost: parseNumeric(p.projectcos),
      },
      { onConflict: 'local_proposal_id' }
    )

    synced++
  }

  return { fetched: projects.length, synced, skippedNoGeometry, errors: errors.slice(0, 20) }
}
