'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkModeration } from '@/lib/moderation/check'

export async function addComment(
  legislationId: string,
  body: string,
  parentCommentId?: string | null
): Promise<{ error?: string }> {
  if (!body.trim()) return { error: 'Comment cannot be empty' }
  if (body.length > 2000) return { error: 'Comment is too long (max 2000 characters)' }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to comment' }

  // Check moderation
  const { flagged, categories } = await checkModeration(body)
  if (flagged) {
    return {
      error: `Your comment was flagged for: ${categories.join(', ')}. Please revise and try again.`,
    }
  }

  // Get user's current stance for context
  const { data: stanceRow } = await supabase
    .from('user_stances')
    .select('stance')
    .eq('user_id', user.id)
    .eq('legislation_id', legislationId)
    .maybeSingle()

  const stanceContext = stanceRow?.stance ?? null

  const { error } = await supabase.from('comments').insert({
    user_id: user.id,
    legislation_id: legislationId,
    body: body.trim(),
    parent_comment_id: parentCommentId ?? null,
    stance_context: stanceContext,
  })

  if (error) return { error: error.message }

  revalidatePath('/legislation', 'layout')
  return {}
}

export async function voteComment(
  commentId: string,
  vote: 1 | -1 | 0
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to vote' }

  if (vote === 0) {
    // Remove vote
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

  revalidatePath('/legislation', 'layout')
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
