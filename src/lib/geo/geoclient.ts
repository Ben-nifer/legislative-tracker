// NYC Geoclient v2: address → districts (onboarding-build-planv1.1.md §4.1, B6).
// Privacy (spec §S1, §14): the address is used for this one request only. It is
// never logged, stored or put in an error message, and coordinates are dropped.

const GEOCLIENT_URL = 'https://api.nyc.gov/geoclient/v2/search.json'
const TIMEOUT_MS = 5000

export type BoroughCode = 'MN' | 'BX' | 'BK' | 'QN' | 'SI'

export interface ResolvedDistricts {
  councilDistrict: string // "39"; matches places.place_id for council_district
  stateSenateDistrict: string | null
  assemblyDistrict: string | null
  congressionalDistrict: string | null
  ntaCode: string | null // NTA 2020, e.g. BK0602
  borough: BoroughCode | null
  communityDistrict: string | null // "306" = Brooklyn CB 6
}

// Geoclient rejects addresses outside NYC and unplaceable text the same way,
// so both are `not_found` (one combined message in S1, per product decision).
export type GeocodeResult =
  | { status: 'ok'; districts: ResolvedDistricts }
  | { status: 'not_found' }
  | { status: 'unavailable' }

const BOROUGH_BY_CODE: Record<string, BoroughCode> = { '1': 'MN', '2': 'BX', '3': 'BK', '4': 'QN', '5': 'SI' }

// "052" → "52"; empty or non-numeric → null
function district(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const n = Number(value)
  return n > 0 ? String(n) : null
}

interface GeoclientResult {
  status?: string
  response?: Record<string, unknown>
}

export function parseGeoclientResponse(json: unknown): GeocodeResult {
  const results = (json as { results?: GeoclientResult[] } | null)?.results
  if (!Array.isArray(results)) return { status: 'not_found' }

  // Possible matches without a council district are landmarks or intersections
  // Geoclient couldn't pin to a lot ("Times Square"); treat them as unplaced.
  for (const r of results) {
    if (r.status !== 'EXACT_MATCH' && r.status !== 'POSSIBLE_MATCH') continue
    const res = r.response ?? {}
    const councilDistrict = district(res.cityCouncilDistrict)
    if (!councilDistrict) continue

    const nta = typeof res.nta2020 === 'string' && /^[A-Z]{2}\d{4}$/.test(res.nta2020) ? res.nta2020 : null
    const boroughCode = String(res.boroughCode1In ?? res.bblBoroughCode ?? '')
    const cd = typeof res.communityDistrict === 'string' && /^[1-5]\d{2}$/.test(res.communityDistrict)
      ? res.communityDistrict
      : null

    return {
      status: 'ok',
      districts: {
        councilDistrict,
        stateSenateDistrict: district(res.stateSenatorialDistrict),
        assemblyDistrict: district(res.assemblyDistrict),
        congressionalDistrict: district(res.congressionalDistrict),
        ntaCode: nta,
        borough: BOROUGH_BY_CODE[boroughCode] ?? (nta ? (nta.slice(0, 2) as BoroughCode) : null),
        communityDistrict: cd,
      },
    }
  }
  return { status: 'not_found' }
}

export async function geocodeNycAddress(
  address: string,
  opts: { key?: string; fetchImpl?: typeof fetch } = {}
): Promise<GeocodeResult> {
  const key = opts.key ?? process.env.NYC_GEOCLIENT_KEY
  if (!key) {
    console.error('Geoclient: NYC_GEOCLIENT_KEY is not set')
    return { status: 'unavailable' }
  }
  const input = address.trim()
  if (!input) return { status: 'not_found' }

  try {
    const res = await (opts.fetchImpl ?? fetch)(`${GEOCLIENT_URL}?input=${encodeURIComponent(input)}`, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`Geoclient: HTTP ${res.status}`)
      return { status: 'unavailable' }
    }
    return parseGeoclientResponse(await res.json())
  } catch (err) {
    // Log the error class only; messages can echo the request URL (and so the address)
    console.error(`Geoclient: request failed (${err instanceof Error ? err.name : 'unknown'})`)
    return { status: 'unavailable' }
  }
}
