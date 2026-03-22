'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// ── Users ─────────────────────────────────────────────────────────────────────

export async function followUser(
  targetUserId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (user.id === targetUserId) return { error: 'Cannot follow yourself' }

  const { error } = await supabase
    .from('user_follows')
    .insert({ follower_id: user.id, following_id: targetUserId })

  if (error) return { error: error.message }

  // Notify the target user
  await supabase.from('notifications').insert({
    user_id: targetUserId,
    type: 'new_follower',
    actor_user_id: user.id,
    title: 'New follower',
    body: 'Someone started following you',
  })

  revalidatePath(`/users/[username]`, 'page')
  return {}
}

export async function unfollowUser(
  targetUserId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_follows')
    .delete()
    .match({ follower_id: user.id, following_id: targetUserId })

  if (error) return { error: error.message }

  revalidatePath(`/users/[username]`, 'page')
  return {}
}

// ── Council members ──────────────────────────────────────────────────────────

export async function followLegislator(
  legislatorId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('legislator_follows')
    .insert({ user_id: user.id, legislator_id: legislatorId })

  if (error) return { error: error.message }

  revalidatePath('/following')
  revalidatePath('/users/[username]', 'page')
  return {}
}

export async function unfollowLegislator(
  legislatorId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('legislator_follows')
    .delete()
    .match({ user_id: user.id, legislator_id: legislatorId })

  if (error) return { error: error.message }

  revalidatePath('/following')
  revalidatePath('/users/[username]', 'page')
  return {}
}

// ── Topics ───────────────────────────────────────────────────────────────────

export async function followTopic(
  topicId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('topic_follows')
    .insert({ user_id: user.id, topic_id: topicId })

  if (error) return { error: error.message }

  revalidatePath('/following')
  return {}
}

export async function unfollowTopic(
  topicId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('topic_follows')
    .delete()
    .match({ user_id: user.id, topic_id: topicId })

  if (error) return { error: error.message }

  revalidatePath('/following')
  return {}
}
