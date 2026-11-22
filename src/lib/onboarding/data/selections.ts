import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuestContext } from '../guest'

// Onboarding selections for signed-in users (build plan §4.3, B8): an existing
// account opening /welcome starts from its saved follows, and finishing saves
// the changes. Same shape as the guest cookie, without its size caps.

export type Selections = GuestContext

export async function loadUserSelections(supabase: SupabaseClient, userId: string): Promise<Selections> {
  const [places, jurisdictions, legislators, topics, interests, profile] = await Promise.all([
    supabase.from('user_places').select('place_type, place_id').eq('user_id', userId),
    supabase.from('user_jurisdiction_follows').select('place_type, place_id').eq('user_id', userId).order('created_at'),
    supabase.from('legislator_follows').select('legislator_id').eq('user_id', userId).order('created_at'),
    supabase.from('topic_follows').select('topic_id').eq('user_id', userId).order('created_at'),
    supabase.from('user_interests').select('normalized_phrase, display_phrase').eq('user_id', userId).order('created_at'),
    supabase.from('user_profiles').select('council_member_id').eq('id', userId).maybeSingle(),
  ])

  let resolved = (places.data ?? []).map((p) => ({ type: p.place_type, id: p.place_id })) as Selections['places']
  // Accounts from before onboarding only have the profile's council member (B8)
  if (!resolved.length && profile.data?.council_member_id) {
    const { data: member } = await supabase.from('legislators').select('district').eq('id', profile.data.council_member_id).maybeSingle()
    if (member?.district) resolved = [{ type: 'city', id: 'nyc' }, { type: 'council_district', id: member.district }]
  }

  return {
    v: 1,
    places: resolved,
    jurisdictions: (jurisdictions.data ?? []).map((j) => ({ type: j.place_type, id: j.place_id })) as Selections['jurisdictions'],
    legislatorIds: (legislators.data ?? []).map((l) => l.legislator_id as string),
    topicIds: (topics.data ?? []).map((t) => t.topic_id as string),
    interests: (interests.data ?? []).map((i) => ({ phrase: i.normalized_phrase as string, display: i.display_phrase as string })),
  }
}

const placeKey = (p: { type: string; id: string }) => `${p.type}:${p.id}`

async function must(label: string, op: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await op
  if (error) throw new Error(`${label} failed: ${error.message}`)
}

/**
 * Applies what changed during onboarding: removes only what the user turned off
 * (present in `initial`, absent in `final`) and adds what's new. Follows made
 * elsewhere meanwhile are left alone. Resolved places are replaced when present.
 */
export async function saveUserSelections(supabase: SupabaseClient, userId: string, initial: Selections, final: Selections): Promise<void> {
  const removedJur = initial.jurisdictions.filter((j) => !final.jurisdictions.some((f) => placeKey(f) === placeKey(j)))
  const removedLeg = initial.legislatorIds.filter((id) => !final.legislatorIds.includes(id))
  const removedTopics = initial.topicIds.filter((id) => !final.topicIds.includes(id))
  const removedPhrases = initial.interests.filter((i) => !final.interests.some((f) => f.phrase === i.phrase)).map((i) => i.phrase)

  for (const j of removedJur) {
    await must('jurisdiction unfollow', supabase.from('user_jurisdiction_follows').delete().match({ user_id: userId, place_type: j.type, place_id: j.id }))
  }
  if (removedLeg.length) await must('legislator unfollow', supabase.from('legislator_follows').delete().eq('user_id', userId).in('legislator_id', removedLeg))
  if (removedTopics.length) await must('topic unfollow', supabase.from('topic_follows').delete().eq('user_id', userId).in('topic_id', removedTopics))
  if (removedPhrases.length) await must('interest removal', supabase.from('user_interests').delete().eq('user_id', userId).in('normalized_phrase', removedPhrases))

  const upserts: [string, string, Record<string, unknown>[]][] = [
    ['user_jurisdiction_follows', 'user_id,place_type,place_id', final.jurisdictions.map((j) => ({ user_id: userId, place_type: j.type, place_id: j.id }))],
    ['legislator_follows', 'user_id,legislator_id', final.legislatorIds.map((id) => ({ user_id: userId, legislator_id: id }))],
    ['topic_follows', 'user_id,topic_id', final.topicIds.map((id) => ({ user_id: userId, topic_id: id }))],
    ['user_interests', 'user_id,normalized_phrase', final.interests.map((i) => ({ user_id: userId, normalized_phrase: i.phrase, display_phrase: i.display }))],
  ]
  for (const [table, onConflict, rows] of upserts) {
    if (rows.length) await must(table, supabase.from(table).upsert(rows, { onConflict, ignoreDuplicates: true }))
  }

  if (final.places.length && final.places.map(placeKey).sort().join() !== initial.places.map(placeKey).sort().join()) {
    await must('user_places delete', supabase.from('user_places').delete().eq('user_id', userId))
    await must('user_places insert', supabase.from('user_places').insert(final.places.map((p) => ({ user_id: userId, place_type: p.type, place_id: p.id }))))
  }
}
