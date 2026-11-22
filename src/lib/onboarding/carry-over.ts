import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuestContext } from './guest'
import type { PendingAction } from './session'
import { refreshStanceCounts, refreshWatchingCount } from '../engagement/stats'
import { validateEvent, type AnalyticsEvent } from '../analytics/events'

// Sign-in carry-over (onboarding-build-planv1.1.md §4.3, spec §8): the guest
// session's choices attach to the account, the guest's analytics and feed
// impressions are linked to it, and a gated action waiting for sign-in is
// completed. All writes use the service client with an explicit user ID.

async function existingIds(service: SupabaseClient, table: string, column: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const { data, error } = await service.from(table).select(column).in(column, ids)
  if (error) throw new Error(`${table} read failed: ${error.message}`)
  return (data ?? []).map((r) => (r as unknown as Record<string, string>)[column])
}

async function must(label: string, op: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await op
  if (error) throw new Error(`${label} failed: ${error.message}`)
}

/**
 * Follows are added to whatever the account already has. Resolved places
 * replace the account's, since they describe one address. IDs that no longer
 * exist are dropped rather than failing the whole carry-over.
 */
export async function carryOverGuestContext(service: SupabaseClient, userId: string, ctx: GuestContext): Promise<void> {
  const [legislatorIds, topicIds, phrases] = await Promise.all([
    existingIds(service, 'legislators', 'id', ctx.legislatorIds),
    existingIds(service, 'topics', 'id', ctx.topicIds),
    existingIds(service, 'interest_phrases', 'normalized_phrase', ctx.interests.map((i) => i.phrase)),
  ])

  if (ctx.places.length) {
    await must('user_places delete', service.from('user_places').delete().eq('user_id', userId))
    await must(
      'user_places insert',
      service.from('user_places').insert(ctx.places.map((p) => ({ user_id: userId, place_type: p.type, place_id: p.id })))
    )

    // Keep the profile's "your council member" in step, unless the user already chose one
    const district = ctx.places.find((p) => p.type === 'council_district')?.id
    if (district) {
      const { data: member } = await service
        .from('legislators')
        .select('id')
        .eq('district', district)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (member) {
        await must(
          'user_profiles council member',
          service.from('user_profiles').update({ council_member_id: member.id }).eq('id', userId).is('council_member_id', null)
        )
      }
    }
  }

  const upserts: [string, string, Record<string, unknown>[]][] = [
    [
      'user_jurisdiction_follows',
      'user_id,place_type,place_id',
      ctx.jurisdictions.map((j) => ({ user_id: userId, place_type: j.type, place_id: j.id })),
    ],
    ['legislator_follows', 'user_id,legislator_id', legislatorIds.map((id) => ({ user_id: userId, legislator_id: id }))],
    ['topic_follows', 'user_id,topic_id', topicIds.map((id) => ({ user_id: userId, topic_id: id }))],
    [
      'user_interests',
      'user_id,normalized_phrase',
      ctx.interests
        .filter((i) => phrases.includes(i.phrase))
        .map((i) => ({ user_id: userId, normalized_phrase: i.phrase, display_phrase: i.display })),
    ],
  ]
  for (const [table, onConflict, rows] of upserts) {
    if (rows.length) await must(table, service.from(table).upsert(rows, { onConflict, ignoreDuplicates: true }))
  }
}

// The guest's rows from this browser session now belong to the account
export async function linkGuestSession(service: SupabaseClient, userId: string, sessionId: string): Promise<void> {
  await Promise.all(
    ['analytics_events', 'feed_impressions'].map((table) =>
      must(
        `${table} link`,
        service.from(table).update({ user_id: userId }).eq('session_id', sessionId).is('user_id', null)
      )
    )
  )
}

export async function completePendingAction(service: SupabaseClient, userId: string, pending: PendingAction): Promise<void> {
  if (pending.action === 'stance') {
    await must(
      'user_stances upsert',
      service.from('user_stances').upsert(
        { user_id: userId, legislation_id: pending.legislationId, stance: pending.stance, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,legislation_id' }
      )
    )
    await service
      .from('engagement_events')
      .insert({ legislation_id: pending.legislationId, user_id: userId, event_type: 'stance' })
    await refreshStanceCounts(service, pending.legislationId)
    return
  }

  await must(
    'legislation_follows upsert',
    service.from('legislation_follows').upsert(
      {
        user_id: userId,
        legislation_id: pending.legislationId,
        notify_updates: true,
        notify_hearings: true,
        notify_amendments: true,
      },
      { onConflict: 'user_id,legislation_id', ignoreDuplicates: true }
    )
  )
  await refreshWatchingCount(service, pending.legislationId)
}

export async function recordServerEvent(
  service: SupabaseClient,
  sessionId: string,
  userId: string | null,
  event: AnalyticsEvent
): Promise<void> {
  const valid = validateEvent(event)
  if (!valid) throw new Error(`invalid analytics event ${event.name}`)
  await must(
    'analytics_events insert',
    service.from('analytics_events').insert({ session_id: sessionId, user_id: userId, name: valid.name, props: valid.props })
  )
}
