'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { checkModeration } from '@/lib/moderation/check'
import { commentRateLimit, voteRateLimit } from '@/lib/rate-limit'

export type NewProposalComment = {
  id: string
  body: string
  created_at: string
  stance_context: 'support' | 'oppose' | 'neutral' | null
  author: { username: string; display_name: string }
}

export async function addProposalComment(
  proposalId: string,
  body: string,
  parentCommentId?: string | null
): Promise<{ error?: string; comment?: NewProposalComment }> {
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

  const [{ data: stanceRow }, { data: profile }, { data: proposal }] = await Promise.all([
    supabase
      .from('proposal_stances')
      .select('stance')
      .eq('user_id', user.id)
      .eq('local_proposal_id', proposalId)
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('username, display_name')
      .eq('id', user.id)
      .single(),
    supabase
      .from('local_proposals')
      .select('slug, title')
      .eq('id', proposalId)
      .single(),
  ])

  const stanceContext = (stanceRow?.stance && stanceRow.stance !== 'watching')
    ? stanceRow.stance as 'support' | 'oppose' | 'neutral'
    : null

  const { data, error } = await supabase
    .from('proposal_comments')
    .insert({
      user_id: user.id,
      local_proposal_id: proposalId,
      body: body.trim(),
      parent_comment_id: parentCommentId ?? null,
      stance_context: stanceContext,
      is_hidden: false,
      is_flagged: false,
    })
    .select('id, body, created_at, stance_context')
    .single()

  if (error || !data) {
    console.error('[addProposalComment] insert error:', error)
    return { error: error?.message ?? 'Failed to post comment' }
  }

  if (parentCommentId && proposal) {
    const { data: parent } = await supabase
      .from('proposal_comments')
      .select('user_id')
      .eq('id', parentCommentId)
      .single()

    if (parent && parent.user_id !== user.id) {
      await createServiceClient().from('notifications').insert({
        user_id: parent.user_id,
        type: 'proposal_comment_reply',
        title: `${profile?.display_name ?? 'Someone'} replied to your comment`,
        body: `On ${proposal.title}`,
        url: `/proposals/${proposal.slug}#comment-${data.id}`,
        local_proposal_id: proposalId,
        proposal_comment_id: data.id,
        actor_user_id: user.id,
      })
    }
  }

  revalidatePath('/proposals', 'layout')

  return {
    comment: {
      id: data.id,
      body: data.body,
      created_at: data.created_at,
      stance_context: data.stance_context as NewProposalComment['stance_context'],
      author: {
        username: profile?.username ?? 'unknown',
        display_name: profile?.display_name ?? 'Unknown User',
      },
    },
  }
}

export async function voteProposalComment(
  commentId: string,
  vote: 1 | -1 | 0
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to vote' }

  const { success } = await voteRateLimit.limit(user.id)
  if (!success) return { error: 'Too many requests. Please try again later.' }

  const { data: existing } = await supabase
    .from('proposal_comment_votes')
    .select('vote')
    .match({ user_id: user.id, comment_id: commentId })
    .maybeSingle()

  if (vote === 0) {
    await supabase
      .from('proposal_comment_votes')
      .delete()
      .match({ user_id: user.id, comment_id: commentId })
  } else {
    await supabase.from('proposal_comment_votes').upsert(
      { user_id: user.id, comment_id: commentId, vote },
      { onConflict: 'user_id,comment_id' }
    )
  }

  if (vote === 1 && existing?.vote !== 1) {
    const { data: comment } = await supabase
      .from('proposal_comments')
      .select('user_id, local_proposal_id, proposal:local_proposals(slug, title)')
      .eq('id', commentId)
      .single()

    if (comment && comment.user_id !== user.id) {
      const proposalData = Array.isArray(comment.proposal) ? comment.proposal[0] : comment.proposal
      await createServiceClient().from('notifications').insert({
        user_id: comment.user_id,
        type: 'proposal_comment_upvote',
        title: 'Your comment was upvoted',
        body: proposalData?.title ? `On ${proposalData.title}` : null,
        url: proposalData?.slug ? `/proposals/${proposalData.slug}#comment-${commentId}` : null,
        local_proposal_id: comment.local_proposal_id,
        proposal_comment_id: commentId,
        actor_user_id: user.id,
      })
    }
  }

  return {}
}

export async function reportProposalComment(commentId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to report' }

  const { error } = await supabase
    .from('proposal_comments')
    .update({ is_flagged: true })
    .eq('id', commentId)

  if (error) return { error: error.message }
  return {}
}

export async function editProposalComment(
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
    .from('proposal_comments')
    .update({ body: newBody.trim(), updated_at: new Date().toISOString() })
    .eq('id', commentId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/proposals', 'layout')
  return {}
}

export async function deleteProposalComment(commentId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to delete' }

  const { error } = await supabase
    .from('proposal_comments')
    .delete()
    .eq('id', commentId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/proposals', 'layout')
  return {}
}
