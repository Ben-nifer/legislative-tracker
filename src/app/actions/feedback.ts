'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkModeration } from '@/lib/moderation/check'
import { feedbackRateLimit, commentRateLimit } from '@/lib/rate-limit'

export async function submitFeedback(
  type: 'feature' | 'bug',
  body: string,
  mediaUrl?: string | null,
  mediaType?: string | null,
): Promise<{ error?: string; id?: string }> {
  if (!body.trim()) return { error: 'Feedback cannot be empty' }
  if (body.length > 1000) return { error: 'Feedback is too long (max 1000 characters)' }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to submit feedback' }

  const { success } = await feedbackRateLimit.limit(user.id)
  if (!success) return { error: 'Too many submissions. Please wait before trying again.' }

  const { flagged, categories } = await checkModeration(body)
  if (flagged) return { error: `Flagged for: ${categories.join(', ')}. Please revise.` }

  const { data, error } = await supabase
    .from('feedback_posts')
    .insert({
      user_id: user.id,
      type,
      body: body.trim(),
      media_url: mediaUrl ?? null,
      media_type: mediaType ?? null,
    })
    .select('id')
    .single()

  if (error || !data) return { error: error?.message ?? 'Failed to submit feedback' }
  revalidatePath('/feedback')
  return { id: data.id }
}

export async function toggleFeedbackLike(
  postId: string,
  currentlyLiked: boolean,
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to like' }

  if (currentlyLiked) {
    const { error } = await supabase
      .from('feedback_likes')
      .delete()
      .match({ user_id: user.id, post_id: postId })
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('feedback_likes')
      .upsert({ user_id: user.id, post_id: postId }, { onConflict: 'user_id,post_id' })
    if (error) return { error: error.message }
  }

  revalidatePath('/feedback')
  return {}
}

export async function addFeedbackComment(
  postId: string,
  body: string,
): Promise<{ error?: string; id?: string }> {
  if (!body.trim()) return { error: 'Comment cannot be empty' }
  if (body.length > 500) return { error: 'Comment is too long (max 500 characters)' }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to comment' }

  const { success } = await commentRateLimit.limit(user.id)
  if (!success) return { error: 'Too many comments. Please wait.' }

  const { flagged, categories } = await checkModeration(body)
  if (flagged) return { error: `Flagged for: ${categories.join(', ')}` }

  const { data, error } = await supabase
    .from('feedback_comments')
    .insert({ user_id: user.id, post_id: postId, body: body.trim() })
    .select('id')
    .single()

  if (error || !data) return { error: error?.message ?? 'Failed to post comment' }
  revalidatePath(`/feedback/${postId}`)
  return { id: data.id }
}

export async function deleteFeedbackPost(postId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('feedback_posts')
    .delete()
    .eq('id', postId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/feedback')
  return {}
}

export async function deleteFeedbackComment(commentId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('feedback_comments')
    .delete()
    .eq('id', commentId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/feedback')
  return {}
}
