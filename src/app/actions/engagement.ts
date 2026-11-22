'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { stanceRateLimit } from '@/lib/rate-limit'
import { refreshStanceCounts } from '@/lib/engagement/stats'

export type Stance = 'support' | 'oppose' | 'neutral'

/**
 * Log an engagement event for trending calculations.
 * Uses the service client to bypass RLS — safe because we're only inserting
 * append-only analytics rows, not reading or mutating user data.
 */
export async function logEngagement(
  legislationId: string,
  eventType: 'view' | 'stance' | 'comment' | 'bookmark'
): Promise<void> {
  try {
    const supabase = createServiceClient()
    const userClient = await createServerSupabaseClient()
    const { data: { user } } = await userClient.auth.getUser()

    await supabase.from('engagement_events').insert({
      legislation_id: legislationId,
      user_id: user?.id ?? null,
      event_type: eventType,
    })
  } catch {
    // Engagement logging is best-effort — never block the main action
  }
}

/**
 * Set or clear a user's stance on a piece of legislation.
 * Pass `null` to remove the stance entirely.
 */
export async function setStance(
  legislationId: string,
  stance: Stance | null
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const { success } = await stanceRateLimit.limit(user.id)
  if (!success) return { error: 'Too many requests. Please try again later.' }

  if (stance === null) {
    const { error } = await supabase
      .from('user_stances')
      .delete()
      .match({ user_id: user.id, legislation_id: legislationId })

    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('user_stances').upsert(
      {
        user_id: user.id,
        legislation_id: legislationId,
        stance,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,legislation_id' }
    )

    if (error) return { error: error.message }
    await logEngagement(legislationId, 'stance')
  }

  // Recount stances and update legislation_stats immediately so the
  // tally reflects the change without waiting for the next cron run.
  await refreshStanceCounts(createServiceClient(), legislationId)

  revalidatePath('/legislation')
  revalidatePath('/')
  return {}
}

