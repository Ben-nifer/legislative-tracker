'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { geocodeRateLimit } from '@/lib/rate-limit'
import { geocodeNycAddress } from '@/lib/geo/geoclient'

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function updateProfile(formData: {
  display_name: string
  bio: string | null
  links?: { platform: string; url: string }[]
}): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_profiles')
    .update({
      display_name: formData.display_name,
      bio: formData.bio || null,
      links: formData.links ?? [],
    })
    .eq('id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/profile')
  revalidatePath('/users/[username]', 'page')
  return {}
}

export async function updateNotificationPreferences(prefs: {
  hearing_alerts: boolean
  bill_updates: boolean
  comment_engagement: boolean
  new_followers: boolean
}): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_profiles')
    .update({ notification_preferences: prefs })
    .eq('id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/profile')
  return {}
}

export async function updateAvatarUrl(url: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_profiles')
    .update({ avatar_url: url })
    .eq('id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/profile')
  revalidatePath('/users/[username]', 'page')
  return {}
}

export async function addInterestTag(tagId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_interest_tags')
    .insert({ user_id: user.id, tag_id: tagId })

  if (error) return { error: error.message }
  revalidatePath('/profile')
  revalidatePath('/users/[username]', 'page')
  return {}
}

export async function removeInterestTag(tagId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_interest_tags')
    .delete()
    .match({ user_id: user.id, tag_id: tagId })

  if (error) return { error: error.message }
  revalidatePath('/profile')
  revalidatePath('/users/[username]', 'page')
  return {}
}

export async function createCustomTag(
  name: string
): Promise<{ error?: string; tag?: { id: string; name: string; slug: string; is_predefined: boolean } }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const trimmed = name.trim()
  if (!trimmed) return { error: 'Tag name cannot be empty' }
  if (trimmed.length > 30) return { error: 'Tag name must be 30 characters or fewer' }

  const slug = toSlug(trimmed)
  if (!slug) return { error: 'Invalid tag name' }

  // Create the tag (or find existing one with the same slug for this user)
  const { data: tag, error: insertError } = await supabase
    .from('interest_tags')
    .insert({ name: trimmed, slug, is_predefined: false, created_by_user_id: user.id })
    .select('id, name, slug, is_predefined')
    .single()

  if (insertError) return { error: insertError.message }

  // Add to user's interests
  const { error: linkError } = await supabase
    .from('user_interest_tags')
    .insert({ user_id: user.id, tag_id: tag.id })

  if (linkError) return { error: linkError.message }

  revalidatePath('/profile')
  revalidatePath('/users/[username]', 'page')
  return { tag }
}

const BOROUGH_CODES: Record<string, string> = {
  '1': 'Manhattan', '2': 'Bronx', '3': 'Brooklyn', '4': 'Queens', '5': 'Staten Island',
}

function formatCommunityDistrict(cd: string): string {
  const borough = BOROUGH_CODES[cd.charAt(0)] ?? 'NYC'
  const boardNum = parseInt(cd.slice(1), 10)
  return `${borough} Community Board ${boardNum}`
}

export async function lookupAddressDistrict(address: string): Promise<{
  legislator?: { id: string; full_name: string; slug: string; district: number; borough: string | null; photo_url: string | null }
  communityBoard?: string
  error?: string
}> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const { success } = await geocodeRateLimit.limit(user?.id ?? `ip:${ip}`)
  if (!success) return { error: 'Too many requests. Please try again later.' }

  // NYC Geoclient (onboarding-build-planv1.1.md §4.1); the address isn't logged or kept
  const result = await geocodeNycAddress(address)
  if (result.status === 'unavailable') return { error: 'Address lookup is unavailable right now. Please try again.' }
  if (result.status === 'not_found') return { error: 'Address not found in NYC. Please check the address and try again.' }

  const { councilDistrict, communityDistrict } = result.districts
  const { data: legislator } = await supabase
    .from('legislators')
    .select('id, full_name, slug, district, borough, photo_url')
    .eq('district', councilDistrict)
    .eq('is_active', true)
    .maybeSingle()

  if (!legislator) return { error: `No active council member found for District ${councilDistrict}.` }

  return { legislator, communityBoard: communityDistrict ? formatCommunityDistrict(communityDistrict) : undefined }
}

export async function saveCouncilMember(
  legislatorId: string,
  communityBoard: string | null
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_profiles')
    .update({ council_member_id: legislatorId, community_board: communityBoard })
    .eq('id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/profile')
  return {}
}

export async function setEmailDigests(
  enabled: boolean
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_profiles')
    .update({ email_digests_enabled: enabled })
    .eq('id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/settings/notifications')
  return {}
}
