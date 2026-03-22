import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, ArrowLeft } from 'lucide-react'

export const metadata = {
  title: 'Followers | NYC Legislative Tracker',
}

export const revalidate = 0

export default async function FollowersPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/followers')

  const { data: followersData } = await supabase
    .from('user_follows')
    .select('follower_id, profile:user_profiles!user_follows_follower_id_fkey(id, username, display_name, bio)')
    .eq('following_id', user.id)
    .order('created_at', { ascending: false })

  // Also get who the current user is following so we can show mutual status
  const { data: myFollowingData } = await supabase
    .from('user_follows')
    .select('following_id')
    .eq('follower_id', user.id)

  const myFollowingIds = new Set((myFollowingData ?? []).map((f) => f.following_id))

  const followers = (followersData ?? []).flatMap((f) => {
    const profile = Array.isArray(f.profile) ? f.profile[0] : f.profile
    return profile ? [{ ...profile, followsYouBack: myFollowingIds.has(profile.id) }] : []
  })

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">

        {/* Header */}
        <div>
          <Link
            href="/following"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
          >
            <ArrowLeft size={14} /> Following
          </Link>
          <div className="flex items-center gap-2 mt-2">
            <Users size={20} className="text-indigo-400" />
            <h1 className="text-2xl font-bold text-white">
              Followers
              {followers.length > 0 && (
                <span className="ml-2 text-lg font-normal text-slate-400">({followers.length})</span>
              )}
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">People who follow you</p>
        </div>

        {/* List */}
        {followers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center">
            <Users size={32} className="mx-auto mb-3 text-slate-700" />
            <p className="text-sm text-slate-500">No followers yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {followers.map((f) => (
              <Link
                key={f.id}
                href={`/users/${f.username}`}
                className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700 hover:bg-slate-800/60"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-bold text-indigo-300">
                  {f.display_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-100">{f.display_name}</p>
                    {f.followsYouBack && (
                      <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-400">
                        Following
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">@{f.username}</p>
                  {f.bio && (
                    <p className="mt-1 line-clamp-1 text-xs text-slate-400">{f.bio}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
