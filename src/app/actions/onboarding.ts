'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { geocodeRateLimit } from '@/lib/rate-limit'
import { resolveAddress as resolveAddressData, type AddressResolution } from '@/lib/onboarding/data/address'
import { searchNeighborhoods as searchNeighborhoodsData, type NeighborhoodMatch } from '@/lib/onboarding/data/neighborhoods'
import { getCoverage as getCoverageData, type Coverage } from '@/lib/onboarding/data/coverage'
import { getRepresentatives as getRepresentativesData, type RepresentativeCard } from '@/lib/onboarding/data/representatives'
import { guestContextSchema } from '@/lib/onboarding/guest'

// Onboarding data for the screens (onboarding-build-planv1.1.md §4.6).

const addressSchema = z.string().trim().min(3).max(200)

/**
 * S1: address → district and NTA IDs. Signed-in users' places are saved to
 * user_places; guests' are written to the onb_ctx cookie by the client.
 * The address is never stored, logged or returned (spec §S1).
 */
export async function resolveAddress(address: string): Promise<AddressResolution | { status: 'rate_limited' }> {
  const parsed = addressSchema.safeParse(address)
  if (!parsed.success) return { status: 'not_found' }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const { success } = await geocodeRateLimit.limit(user?.id ?? `ip:${ip}`)
  if (!success) return { status: 'rate_limited' }

  const result = await resolveAddressData(supabase, parsed.data)

  if (result.status === 'ok' && user) {
    const { error: deleteError } = await supabase.from('user_places').delete().eq('user_id', user.id)
    const { error } = deleteError
      ? { error: deleteError }
      : await supabase
          .from('user_places')
          .insert(result.places.map((p) => ({ user_id: user.id, place_type: p.type, place_id: p.id })))
    if (error) console.error('user_places save failed:', error.message)
  }

  return result
}

export async function searchNeighborhoods(query: string): Promise<NeighborhoodMatch[]> {
  const q = z.string().trim().max(60).safeParse(query)
  if (!q.success) return []
  return searchNeighborhoodsData(createServiceClient(), q.data)
}

export async function getCoverage(): Promise<Coverage> {
  return getCoverageData(createServiceClient())
}

export async function getRepresentatives(places: unknown): Promise<RepresentativeCard[]> {
  const parsed = guestContextSchema.shape.places.safeParse(places)
  if (!parsed.success) return []
  return getRepresentativesData(createServiceClient(), parsed.data)
}
