'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { stanceRateLimit, followRateLimit } from '@/lib/rate-limit'

export type ProposalStance = 'support' | 'oppose' | 'neutral'

/**
 * Log an engagement event for proposal trending calculations.
 * Best-effort — never blocks the main action.
 */
export async function logProposalEngagement(
  proposalId: string,
  eventType: 'view' | 'stance' | 'comment' | 'bookmark'
): Promise<void> {
  try {
    const supabase = createServiceClient()
    const userClient = await createServerSupabaseClient()
    const { data: { user } } = await userClient.auth.getUser()

    await supabase.from('proposal_engagement_events').insert({
      local_proposal_id: proposalId,
      user_id: user?.id ?? null,
      event_type: eventType,
    })
  } catch {
    // best-effort
  }
}

/**
 * Set or clear a user's stance on a local proposal.
 * Pass `null` to remove the stance entirely.
 */
export async function setProposalStance(
  proposalId: string,
  stance: ProposalStance | null
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { success } = await stanceRateLimit.limit(user.id)
  if (!success) return { error: 'Too many requests. Please try again later.' }

  if (stance === null) {
    const { error } = await supabase
      .from('proposal_stances')
      .delete()
      .match({ user_id: user.id, local_proposal_id: proposalId })

    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('proposal_stances').upsert(
      {
        user_id: user.id,
        local_proposal_id: proposalId,
        stance,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,local_proposal_id' }
    )

    if (error) return { error: error.message }
    await logProposalEngagement(proposalId, 'stance')
  }

  const serviceSupabase = createServiceClient()
  const { data: allStances } = await serviceSupabase
    .from('proposal_stances')
    .select('stance')
    .eq('local_proposal_id', proposalId)

  const counts = { support_count: 0, oppose_count: 0, neutral_count: 0 }
  for (const row of allStances ?? []) {
    if (row.stance === 'support') counts.support_count++
    else if (row.stance === 'oppose') counts.oppose_count++
    else if (row.stance === 'neutral') counts.neutral_count++
  }

  await serviceSupabase
    .from('proposal_stats')
    .upsert({ local_proposal_id: proposalId, ...counts }, { onConflict: 'local_proposal_id' })

  revalidatePath('/neighborhood')
  revalidatePath('/proposals')
  return {}
}

export async function followProposal(proposalId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { success } = await followRateLimit.limit(user.id)
  if (!success) return { error: 'Too many requests. Please try again later.' }

  const { error } = await supabase
    .from('proposal_follows')
    .insert({ user_id: user.id, local_proposal_id: proposalId })

  if (error) return { error: error.message }

  await updateProposalWatchingCount(proposalId)

  revalidatePath('/neighborhood')
  revalidatePath('/proposals')
  return {}
}

export async function unfollowProposal(proposalId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('proposal_follows')
    .delete()
    .match({ user_id: user.id, local_proposal_id: proposalId })

  if (error) return { error: error.message }

  await updateProposalWatchingCount(proposalId)

  revalidatePath('/neighborhood')
  revalidatePath('/proposals')
  return {}
}

async function updateProposalWatchingCount(proposalId: string) {
  const service = createServiceClient()
  const { count } = await service
    .from('proposal_follows')
    .select('*', { count: 'exact', head: true })
    .eq('local_proposal_id', proposalId)

  await service
    .from('proposal_stats')
    .update({ watching_count: count ?? 0 })
    .eq('local_proposal_id', proposalId)
}

export async function bookmarkProposal(proposalId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('proposal_bookmarks')
    .insert({ user_id: user.id, local_proposal_id: proposalId })

  if (error) return { error: error.message }
  await logProposalEngagement(proposalId, 'bookmark')
  revalidatePath('/neighborhood')
  revalidatePath('/proposals')
  return {}
}

export async function unbookmarkProposal(proposalId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('proposal_bookmarks')
    .delete()
    .match({ user_id: user.id, local_proposal_id: proposalId })

  if (error) return { error: error.message }
  revalidatePath('/neighborhood')
  revalidatePath('/proposals')
  return {}
}
