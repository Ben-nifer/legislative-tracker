import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ProfileEditor from './ProfileEditor'
import InterestTagsEditor from './InterestTagsEditor'
import AvatarUpload from './AvatarUpload'
import { Tag } from 'lucide-react'

export default async function ProfilePage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/profile')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('username, display_name, bio, avatar_url, id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/onboarding')

  // Engagement stats + interest tags in parallel
  const [
    { count: supportCount },
    { count: opposeCount },
    { count: neutralCount },
    { count: bookmarkCount },
    { data: predefinedTagsData },
    { data: userTagsData },
  ] = await Promise.all([
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'support'),
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'oppose'),
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'neutral'),
    supabase.from('bookmarks').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('interest_tags').select('id, name, slug, is_predefined').eq('is_predefined', true).order('name'),
    supabase
      .from('user_interest_tags')
      .select('tag:interest_tags(id, name, slug, is_predefined)')
      .eq('user_id', user.id),
  ])

  const predefinedTags = predefinedTagsData ?? []
  const userTags = (userTagsData ?? []).flatMap((r) => {
    const t = Array.isArray(r.tag) ? r.tag[0] : r.tag
    return t ? [t] : []
  })
  const selectedIds = userTags.map((t) => t.id)
  const customTags = userTags.filter((t) => !t.is_predefined)

  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Your Profile</h1>
          <p className="text-slate-400 text-sm mt-1">@{profile.username}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Supporting', value: supportCount ?? 0, color: 'text-emerald-400' },
            { label: 'Opposing', value: opposeCount ?? 0, color: 'text-red-400' },
            { label: 'Neutral', value: neutralCount ?? 0, color: 'text-amber-400' },
            { label: 'Saved', value: bookmarkCount ?? 0, color: 'text-indigo-400' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-slate-800/80 rounded-xl border border-slate-700 p-3 text-center"
            >
              <div className={`text-xl font-bold tabular-nums ${stat.color}`}>
                {stat.value}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Avatar */}
        <div className="flex justify-center">
          <AvatarUpload
            userId={profile.id}
            initialUrl={profile.avatar_url ?? null}
            displayName={profile.display_name}
          />
        </div>

        {/* Edit form */}
        <ProfileEditor profile={profile} />

        {/* Interest tags */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-white">
            <Tag size={16} className="text-purple-400" />
            Interests
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Select predefined interests or create your own. These appear on your public profile.
          </p>
          <InterestTagsEditor
            predefinedTags={predefinedTags}
            initialSelectedIds={selectedIds}
            initialCustomTags={customTags}
          />
        </div>
      </div>
    </div>
  )
}
