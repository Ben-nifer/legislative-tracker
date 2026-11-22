import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeNycAddress, type ResolvedDistricts } from '../../geo/geoclient'
import type { GuestPlace } from '../guest'
import { addressLabel } from '../address-label'

export { addressLabel }

// resolveAddress (onboarding-build-planv1.1.md §4.1, §4.6): address → district
// and NTA IDs. Only IDs leave this module; the address isn't returned or kept.

export type AddressResolution =
  | {
      status: 'ok'
      places: GuestPlace[] // → user_places (signed in) or the onb_ctx cookie (guests)
      label: string // confirmation chip: "Council District 39 · Park Slope"
      councilDistrict: string
      neighborhood: { ntaCode: string; name: string } | null
      communityDistrict: string | null
    }
  | { status: 'not_found' } // outside NYC or unplaceable: one combined message in S1
  | { status: 'unavailable' } // Geoclient down: S1 falls back to Skip with a toast

export function districtsToPlaces(d: ResolvedDistricts): GuestPlace[] {
  const places: GuestPlace[] = [
    { type: 'city', id: 'nyc' },
    { type: 'state', id: 'NY' },
    { type: 'council_district', id: d.councilDistrict },
  ]
  if (d.stateSenateDistrict) places.push({ type: 'state_senate', id: d.stateSenateDistrict })
  if (d.assemblyDistrict) places.push({ type: 'assembly', id: d.assemblyDistrict })
  if (d.congressionalDistrict) places.push({ type: 'congressional', id: d.congressionalDistrict })
  if (d.ntaCode) places.push({ type: 'neighborhood', id: d.ntaCode })
  return places
}

export async function resolveAddress(supabase: SupabaseClient, address: string): Promise<AddressResolution> {
  const result = await geocodeNycAddress(address)
  if (result.status !== 'ok') return result

  const d = result.districts
  let neighborhood: { ntaCode: string; name: string } | null = null
  if (d.ntaCode) {
    const { data } = await supabase
      .from('places')
      .select('name')
      .eq('place_type', 'neighborhood')
      .eq('place_id', d.ntaCode)
      .maybeSingle()
    // An NTA code the gazetteer doesn't know (parks, airports) is dropped rather than stored
    if (data) neighborhood = { ntaCode: d.ntaCode, name: data.name as string }
  }

  return {
    status: 'ok',
    places: districtsToPlaces({ ...d, ntaCode: neighborhood?.ntaCode ?? null }),
    label: addressLabel(d.councilDistrict, neighborhood?.name ?? null),
    councilDistrict: d.councilDistrict,
    neighborhood,
    communityDistrict: d.communityDistrict,
  }
}
