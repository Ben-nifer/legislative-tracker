'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkModeration } from '@/lib/moderation/check'

export type NewComment = {
  id: string
  body: string
  created_at: string
  stance_context: 'support' | 'oppose' | 'neutral' | null
  author: { username: string; display_name: string }
}

export async function addComment(
  legislationId: string,
  body: string,
  parentCommentId?: string | null
): Promise<{ error?: string; comment?: NewComment }> {
  if (!body.trim()) return { error: 'Comment cannot be empty' }
  if (body.length > 2000) return { error: 'Comment is too long (max 2000 characters)' }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to comment' }

  const { flagged, categories } = await checkModeration(body)
  if (flagged) {
    return {
      error: `Your comment was flagged for: ${categories.join(', ')}. Please revise and try again.`,
    }
  }

  const [{ data: stanceRow }, { data: profile }] = await Promise.all([
    supabase
      .from('user_stances')
      .select('stance')
      .eq('user_id', user.id)
      .eq('legislation_id', legislationId)
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('username, display_name')
      .eq('id', user.id)
      .single(),
  ])

  const stanceContext = stanceRow?.stance ?? null

  const { data, error } = await supabase
    .from('comments')
    .insert({
      user_id: user.id,
      legislation_id: legislationId,
      body: body.trim(),
      parent_comment_id: parentCommentId ?? null,
      stance_context: stanceContext,
      is_hidden: false,
      is_flagged: false,
    })
    .select('id, body, created_at, stance_context')
    .single()

  if (error || !data) {
    console.error('[addComment] insert error:', error)
    return { error: error?.message ?? 'Failed to post comment' }
  }

  revalidatePath('/legislation/[slug]', 'page')

  return {
    comment: {
      id: data.id,
      body: data.body,
      created_at: data.created_at,
      stance_context: data.stance_context as NewComment['stance_context'],
      author: {
        username: profile?.username ?? 'unknown',
        display_name: profile?.display_name ?? 'Unknown User',
      },
    },
  }
}

export async function voteComment(
  commentId: string,
  vote: 1 | -1 | 0
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to vote' }

  if (vote === 0) {
    await supabase
      .from('comment_votes')
      .delete()
      .match({ user_id: user.id, comment_id: commentId })
  } else {
    await supabase.from('comment_votes').upsert(
      { user_id: user.id, comment_id: commentId, vote },
      { onConflict: 'user_id,comment_id' }
    )
  }

  return {}
}

export async function reportComment(
  commentId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to report' }

  const { error } = await supabase
    .from('comments')
    .update({ is_flagged: true })
    .eq('id', commentId)

  if (error) return { error: error.message }
  return {}
}
