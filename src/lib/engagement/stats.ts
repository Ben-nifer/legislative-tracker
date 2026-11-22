import type { SupabaseClient } from '@supabase/supabase-js'

// Immediate legislation_stats updates after a stance or follow, so counts don't
// wait for the next refresh-stats cron. Shared by the server actions and the
// auth callback (which completes a pending stance or save after sign-in).
// Pass the service client: the recount reads every user's rows.

export async function refreshStanceCounts(service: SupabaseClient, legislationId: string): Promise<void> {
  const { data: allStances } = await service
    .from('user_stances')
    .select('stance')
    .eq('legislation_id', legislationId)

  const counts = { support_count: 0, oppose_count: 0, neutral_count: 0 }
  for (const row of allStances ?? []) {
    if (row.stance === 'support') counts.support_count++
    else if (row.stance === 'oppose') counts.oppose_count++
    else if (row.stance === 'neutral') counts.neutral_count++
  }

  await service
    .from('legislation_stats')
    .upsert({ legislation_id: legislationId, ...counts }, { onConflict: 'legislation_id' })
}

export async function refreshWatchingCount(service: SupabaseClient, legislationId: string): Promise<void> {
  const { count } = await service
    .from('legislation_follows')
    .select('*', { count: 'exact', head: true })
    .eq('legislation_id', legislationId)

  await service
    .from('legislation_stats')
    .update({ watching_count: count ?? 0 })
    .eq('legislation_id', legislationId)
}
