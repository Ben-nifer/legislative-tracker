import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuestContext } from '../onboarding/guest'
import type { FeedContext, FeedTopic } from './types'

// A user's widget list isn't stored separately: it's derived from their follows
// (recommendations-planv1.2.md §3.6), or from the guest cookie.

export function contextFromGuest(guest: GuestContext | null, userId: string | null = null): FeedContext {
  if (!guest) return { userId, jurisdictions: [], topics: [], legislatorIds: [] }
  // The cookie keeps chips and typed interests apart, so chips come first
  const topics: FeedTopic[] = [
    ...guest.topicIds.map((id) => ({ kind: 'topic' as const, id })),
    ...guest.interests.map((i) => ({ kind: 'interest' as const, phrase: i.phrase, display: i.display })),
  ]
  return {
    userId,
    jurisdictions: guest.jurisdictions.map((j) => ({ type: j.type, id: j.id })),
    topics,
    legislatorIds: guest.legislatorIds,
  }
}

export async function loadUserContext(supabase: SupabaseClient, userId: string): Promise<FeedContext> {
  const [jurisdictions, topicFollows, interests, legislators] = await Promise.all([
    supabase.from('user_jurisdiction_follows').select('place_type, place_id, created_at').eq('user_id', userId).order('created_at'),
    supabase.from('topic_follows').select('topic_id, created_at').eq('user_id', userId).order('created_at'),
    supabase.from('user_interests').select('normalized_phrase, display_phrase, created_at').eq('user_id', userId).order('created_at'),
    supabase.from('legislator_follows').select('legislator_id, created_at').eq('user_id', userId).order('created_at'),
  ])

  // Chips and typed interests together, in the order the user added them (§7.2)
  const topics = [
    ...(topicFollows.data ?? []).map((t) => ({ at: (t.created_at as string) ?? '', topic: { kind: 'topic' as const, id: t.topic_id as string } })),
    ...(interests.data ?? []).map((i) => ({
      at: i.created_at as string,
      topic: { kind: 'interest' as const, phrase: i.normalized_phrase as string, display: i.display_phrase as string },
    })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((t) => t.topic)

  return {
    userId,
    jurisdictions: (jurisdictions.data ?? []).map((j) => ({ type: j.place_type as string, id: j.place_id as string })),
    topics,
    legislatorIds: (legislators.data ?? []).map((l) => l.legislator_id as string),
  }
}
