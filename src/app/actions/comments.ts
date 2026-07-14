'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkModeration } from '@/lib/moderation/check'
import { commentRateLimit, voteRateLimit } from '@/lib/rate-limit'

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

  const { success } = await commentRateLimit.limit(user.id)
  if (!success) return { error: 'Too many comments. Please wait before posting again.' }

  const { flagged, categories } = await checkModeration(body)
  if (flagged) {
    return {
      error: `Your comment was flagged for: ${categories.join(', ')}. Please revise and try again.`,
    }
  }

  const [{ data: stanceRow }, { data: profile }, { data: leg }] = await Promise.all([
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
    supabase
      .from('legislation')
      .select('file_number, slug')
      .eq('id', legislationId)
      .single(),
  ])

  const stanceContext = (stanceRow?.stance && stanceRow.stance !== 'watching')
    ? stanceRow.stance as 'support' | 'oppose' | 'neutral'
    : null

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

  // Notify parent comment author of reply
  if (parentCommentId && leg) {
    const { data: parent } = await supabase
      .from('comments')
      .select('user_id')
      .eq('id', parentCommentId)
      .single()

    if (parent && parent.user_id !== user.id) {
      await supabase.from('notifications').insert({
        user_id: parent.user_id,
        type: 'comment_reply',
        title: `${profile?.display_name ?? 'Someone'} replied to your comment`,
        body: `On ${leg.file_number}`,
        url: `/legislation/${leg.slug}`,
        legislation_id: legislationId,
        comment_id: data.id,
        actor_user_id: user.id,
      })
    }
  }

  revalidatePath('/legislation', 'layout')

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

  const { success } = await voteRateLimit.limit(user.id)
  if (!success) return { error: 'Too many requests. Please try again later.' }

  // Check existing vote before mutating to avoid duplicate upvote notifications
  const { data: existing } = await supabase
    .from('comment_votes')
    .select('vote')
    .match({ user_id: user.id, comment_id: commentId })
    .maybeSingle()

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

  // Notify comment author on new upvote (not if they already had an upvote from this user)
  if (vote === 1 && existing?.vote !== 1) {
    const { data: comment } = await supabase
      .from('comments')
      .select('user_id, legislation_id, legislation:legislation(file_number, slug)')
      .eq('id', commentId)
      .single()

    if (comment && comment.user_id !== user.id) {
      const legData = Array.isArray(comment.legislation)
        ? comment.legislation[0]
        : comment.legislation
      await supabase.from('notifications').insert({
        user_id: comment.user_id,
        type: 'comment_upvote',
        title: 'Your comment was upvoted',
        body: legData?.file_number ? `On ${legData.file_number}` : null,
        url: legData?.slug ? `/legislation/${legData.slug}` : null,
        legislation_id: comment.legislation_id,
        comment_id: commentId,
        actor_user_id: user.id,
      })
    }
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

export async function editComment(
  commentId: string,
  newBody: string
): Promise<{ error?: string }> {
  if (!newBody.trim()) return { error: 'Comment cannot be empty' }
  if (newBody.length > 2000) return { error: 'Comment is too long (max 2000 characters)' }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to edit' }

  const { flagged, categories } = await checkModeration(newBody)
  if (flagged) {
    return {
      error: `Your comment was flagged for: ${categories.join(', ')}. Please revise and try again.`,
    }
  }

  const { error } = await supabase
    .from('comments')
    .update({ body: newBody.trim(), updated_at: new Date().toISOString() })
    .eq('id', commentId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/legislation', 'layout')
  return {}
}

export async function deleteComment(
  commentId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to delete' }

  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', commentId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/legislation', 'layout')
  return {}
}
