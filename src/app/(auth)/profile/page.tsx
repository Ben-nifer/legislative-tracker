import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ProfilePageClient from './ProfilePageClient'

export default async function ProfilePage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/profile')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, username, display_name, bio, avatar_url, links, notification_preferences, council_member_id, community_board, council_member:legislators(id, full_name, slug, district, borough, photo_url)')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/onboarding')

  const [
    { count: supportCount },
    { count: opposeCount },
    { count: neutralCount },
    { count: followingCount },
    { data: predefinedTagsData },
    { data: userTagsData },
  ] = await Promise.all([
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'support'),
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'oppose'),
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'neutral'),
    supabase.from('legislation_follows').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('interest_tags').select('id, name, slug, is_predefined').eq('is_predefined', true).order('name'),
    supabase.from('user_interest_tags').select('tag:interest_tags(id, name, slug, is_predefined)').eq('user_id', user.id),
  ])

  const predefinedTags = predefinedTagsData ?? []
  const userTags = (userTagsData ?? []).flatMap((r) => {
    const t = Array.isArray(r.tag) ? r.tag[0] : r.tag
    return t ? [t] : []
  })
  const selectedIds = userTags.map(t => t.id)
  const customTags = userTags.filter(t => !t.is_predefined)

  const councilMember = profile.council_member
    ? (Array.isArray(profile.council_member) ? profile.council_member[0] : profile.council_member) ?? null
    : null

  return (
    <ProfilePageClient
      profile={profile}
      stats={{
        supporting: supportCount ?? 0,
        opposing: opposeCount ?? 0,
        neutral: neutralCount ?? 0,
        following: followingCount ?? 0,
      }}
      predefinedTags={predefinedTags}
      selectedIds={selectedIds}
      customTags={customTags}
      initialCouncilMember={councilMember}
      initialCommunityBoard={profile.community_board ?? null}
    />
  )
}
