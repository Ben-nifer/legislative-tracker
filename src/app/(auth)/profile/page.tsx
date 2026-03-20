import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import ProfileEditor from './ProfileEditor'

export default async function ProfilePage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/profile')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('username, display_name, bio, avatar_url')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/onboarding')

  // Engagement stats
  const [{ count: supportCount }, { count: opposeCount }, { count: neutralCount }, { count: bookmarkCount }] =
    await Promise.all([
      supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'support'),
      supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'oppose'),
      supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('stance', 'neutral'),
      supabase.from('bookmarks').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    ])

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

        {/* Edit form */}
        <ProfileEditor profile={profile} />
      </div>
    </div>
  )
}
