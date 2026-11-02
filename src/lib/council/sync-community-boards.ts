import { createServiceClient } from '@/lib/supabase/server'
import { pointInMultiPolygon, centroidOfMultiPolygon, type MultiPolygon } from '@/lib/geo/point-in-polygon'

// ── NYC Open Data endpoints ──────────────────────────────────────────────────
const COMMUNITY_DISTRICTS_URL = 'https://data.cityofnewyork.us/resource/5crt-au7u.geojson'
const COUNCIL_DISTRICTS_URL = 'https://data.cityofnewyork.us/resource/872g-cjhh.geojson'

// ── Borough name lookup (from boro_cd first digit) ───────────────────────────
const BOROUGH_NAMES: Record<string, string> = {
  '1': 'Manhattan',
  '2': 'The Bronx',
  '3': 'Brooklyn',
  '4': 'Queens',
  '5': 'Staten Island',
}

// boro_cd "410" → "Queens Community Board 10"
// Returns null for Joint Interest Areas (district number > 20)
function boroCdToName(boroCd: string): string | null {
  const boroCode = boroCd.charAt(0)
  const cdNum = parseInt(boroCd.slice(1), 10)
  if (!cdNum || cdNum > 20) return null
  const boroName = BOROUGH_NAMES[boroCode]
  if (!boroName) return null
  return `${boroName} Community Board ${cdNum}`
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function syncCommunityBoardsFromOpenData(): Promise<{
  councilDistrictsMapped: number
  communityBoardsMatched: number
  errors: string[]
}> {
  const errors: string[] = []

  // Fetch both datasets
  const [cdRes, ccRes] = await Promise.all([
    fetch(COMMUNITY_DISTRICTS_URL),
    fetch(COUNCIL_DISTRICTS_URL),
  ])

  if (!cdRes.ok) throw new Error(`Community districts fetch failed: ${cdRes.status}`)
  if (!ccRes.ok) throw new Error(`Council districts fetch failed: ${ccRes.status}`)

  const [cdGeo, ccGeo] = await Promise.all([cdRes.json(), ccRes.json()])

  // Parse community districts
  type CDFeature = {
    properties: { boro_cd: string }
    geometry: { type: string; coordinates: unknown }
  }

  const communityDistricts: { name: string; centroid: [number, number] }[] = []

  for (const feature of (cdGeo.features as CDFeature[])) {
    const name = boroCdToName(feature.properties.boro_cd)
    if (!name) continue // skip Joint Interest Areas

    const mp = feature.geometry.coordinates as MultiPolygon
    const centroid = centroidOfMultiPolygon(mp)
    communityDistricts.push({ name, centroid })
  }

  // Parse council districts
  type CCFeature = {
    properties: { coundist: string | number }
    geometry: { type: string; coordinates: unknown }
  }

  const councilDistricts: { num: number; mp: MultiPolygon }[] = []

  for (const feature of (ccGeo.features as CCFeature[])) {
    const num = parseInt(String(feature.properties.coundist), 10)
    if (!num) continue
    councilDistricts.push({ num, mp: feature.geometry.coordinates as MultiPolygon })
  }

  // For each community district centroid, find which council district contains it
  const boardsByCouncilDistrict = new Map<number, string[]>()

  let communityBoardsMatched = 0

  for (const { name, centroid } of communityDistricts) {
    const [px, py] = centroid
    const match = councilDistricts.find(cd => pointInMultiPolygon(px, py, cd.mp))

    if (!match) {
      errors.push(`No council district found for ${name} (centroid ${px.toFixed(4)}, ${py.toFixed(4)})`)
      continue
    }

    const existing = boardsByCouncilDistrict.get(match.num) ?? []
    boardsByCouncilDistrict.set(match.num, [...existing, name])
    communityBoardsMatched++
  }

  // Update DB
  const supabase = createServiceClient()
  let councilDistrictsMapped = 0

  for (const [districtNum, boards] of boardsByCouncilDistrict) {
    const { error } = await supabase
      .from('legislators')
      .update({ community_boards: boards.sort() })
      .eq('district', districtNum)

    if (error) {
      errors.push(`District ${districtNum}: DB update failed — ${error.message}`)
    } else {
      councilDistrictsMapped++
    }
  }

  return { councilDistrictsMapped, communityBoardsMatched, errors }
}
