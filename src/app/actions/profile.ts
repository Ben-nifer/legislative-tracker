'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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
}): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_profiles')
    .update({
      display_name: formData.display_name,
      bio: formData.bio || null,
    })
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
