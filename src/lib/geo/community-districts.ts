import { createServiceClient } from '@/lib/supabase/server'
import { bboxOfGeometry } from '@/lib/geo/point-in-polygon'

// NYC Community Districts boundary layer — owner-specified authoritative
// source for the neighborhood map feature (kept separate from the
// NYC Open Data feeds used by src/lib/council/sync-community-boards.ts,
// which solves a different problem: council-district-to-board-name lookup).
const COMMUNITY_DISTRICTS_URL =
  'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Community_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson'

const BOROUGH_NAMES: Record<string, string> = {
  '1': 'Manhattan',
  '2': 'The Bronx',
  '3': 'Brooklyn',
  '4': 'Queens',
  '5': 'Staten Island',
}

type ArcGISFeature = {
  properties: { BoroCD: number }
  geometry: { type: string; coordinates: unknown }
}

type ArcGISResponse = {
  features: ArcGISFeature[]
}

function boroCdToParts(boroCd: number): { name: string; slug: string; borough: string } | null {
  const str = String(boroCd).padStart(3, '0')
  const boroCode = str.charAt(0)
  const cdNum = parseInt(str.slice(1), 10)
  const boroName = BOROUGH_NAMES[boroCode]
  if (!boroName || !cdNum || cdNum > 20) return null // skip Joint Interest Areas / parks

  const name = `${boroName} Community Board ${cdNum}`
  const slug = `${boroName.toLowerCase().replace(/\s+/g, '-')}-cd-${cdNum}`
  return { name, slug, borough: boroName }
}

export async function syncCommunityDistricts(): Promise<{
  synced: number
  skipped: number
  errors: string[]
}> {
  const errors: string[] = []

  const res = await fetch(COMMUNITY_DISTRICTS_URL, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`ArcGIS FeatureServer fetch failed: ${res.status}`)

  const data = (await res.json()) as ArcGISResponse
  const supabase = createServiceClient()

  let synced = 0
  let skipped = 0

  for (const feature of data.features) {
    const parts = boroCdToParts(feature.properties.BoroCD)
    if (!parts) {
      skipped++
      continue
    }

    const bbox = bboxOfGeometry(feature.geometry as { coordinates: unknown })

    const { error } = await supabase.from('community_districts').upsert(
      {
        boro_cd: String(feature.properties.BoroCD).padStart(3, '0'),
        slug: parts.slug,
        name: parts.name,
        borough: parts.borough,
        geometry: feature.geometry,
        bbox,
        source_updated_at: new Date().toISOString(),
      },
      { onConflict: 'boro_cd' }
    )

    if (error) {
      errors.push(`${parts.name}: ${error.message}`)
    } else {
      synced++
    }
  }

  return { synced, skipped, errors }
}
