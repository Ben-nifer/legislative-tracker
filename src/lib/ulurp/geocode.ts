import { createServiceClient } from '@/lib/supabase/server'
import { extractAddress } from '@/lib/ai/extract-address'
import { lookupUlurpCentroids } from './bbl'

type GeoSearchFeature = {
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { borough?: string; confidence?: number }
}

async function geocodeAddress(address: string): Promise<GeoSearchFeature | null> {
  const res = await fetch(
    `https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(address)}&size=1`,
    { signal: AbortSignal.timeout(8000) }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data?.features?.[0] ?? null
}

async function updateProposalPoint(
  supabase: ReturnType<typeof createServiceClient>,
  proposalId: string,
  point: [number, number]
) {
  const [lng, lat] = point
  await supabase
    .from('local_proposals')
    .update({
      geometry: { type: 'Point', coordinates: [lng, lat] },
      bbox: [lng, lat, lng, lat],
      geometry_precise: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', proposalId)
}

/**
 * Upgrades up to 25 ULURP proposals still at their district-centroid
 * fallback location to a real location. Primary method: join the project's
 * ZAP-BBL tax lots (Socrata 2iga-a6mk) to PLUTO lat/long — reliable, no
 * guessing. Fallback for projects with no BBL match: ask Claude to extract
 * a street address/intersection from the title+description and geocode it
 * via NYC Planning Labs GeoSearch. Resolves Open Question 1 from the V2
 * neighborhood-map plan.
 */
export async function geocodeUlurpProposalsBatch(): Promise<{
  processed: number
  geocodedViaBbl: number
  geocodedViaAddress: number
  noMatchFound: number
  remaining: number
  error?: string
}> {
  const supabase = createServiceClient()

  const { data: batch, error } = await supabase
    .from('local_proposals')
    .select('id, source_id, title, description, borough')
    .eq('proposal_family', 'ulurp')
    .eq('geometry_precise', false)
    .order('last_action_date', { ascending: false })
    .limit(25)

  const empty = { processed: 0, geocodedViaBbl: 0, geocodedViaAddress: 0, noMatchFound: 0, remaining: 0 }
  if (error) return { ...empty, error: error.message }
  if (!batch || batch.length === 0) return empty

  let geocodedViaBbl = 0
  let geocodedViaAddress = 0
  let noMatchFound = 0
  let firstError: string | undefined

  let centroidByProject: Map<string, [number, number]>
  try {
    centroidByProject = await lookupUlurpCentroids(batch.map((b) => b.source_id))
  } catch (e) {
    centroidByProject = new Map()
    firstError = String(e)
  }

  const needsFallback = batch.filter((item) => !centroidByProject.has(item.source_id))
  for (const item of batch) {
    const bblCentroid = centroidByProject.get(item.source_id)
    if (bblCentroid) {
      await updateProposalPoint(supabase, item.id, bblCentroid)
      geocodedViaBbl++
    }
  }

  const CONCURRENCY = 3
  for (let i = 0; i < needsFallback.length; i += CONCURRENCY) {
    const chunk = needsFallback.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (item) => {
        const { address, error: extractError } = await extractAddress(item.title, item.description, item.borough)
        if (extractError && !firstError) firstError = extractError
        if (!address) {
          noMatchFound++
          return
        }

        let feature: GeoSearchFeature | null
        try {
          feature = await geocodeAddress(address)
        } catch {
          feature = null
        }

        const confidence = feature?.properties.confidence ?? 0
        const featureBorough = feature?.properties.borough?.toLowerCase()
        const proposalBorough = item.borough?.toLowerCase()
        const boroughMatches = !proposalBorough || !featureBorough || featureBorough === proposalBorough

        if (!feature || confidence < 0.5 || !boroughMatches) {
          noMatchFound++
          return
        }

        await updateProposalPoint(supabase, item.id, feature.geometry.coordinates)
        geocodedViaAddress++
      })
    )
  }

  const { count: remaining } = await supabase
    .from('local_proposals')
    .select('*', { count: 'exact', head: true })
    .eq('proposal_family', 'ulurp')
    .eq('geometry_precise', false)

  return {
    processed: batch.length,
    geocodedViaBbl,
    geocodedViaAddress,
    noMatchFound,
    remaining: remaining ?? 0,
    ...(firstError ? { error: firstError } : {}),
  }
}
