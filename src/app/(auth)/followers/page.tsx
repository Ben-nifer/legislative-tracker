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

  const [{ data: followersData }, { data: myFollowingData }] = await Promise.all([
    supabase
      .from('user_follows')
      .select('follower_id')
      .eq('following_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('user_follows')
      .select('following_id')
      .eq('follower_id', user.id),
  ])

  const followerIds = (followersData ?? []).map((f) => f.follower_id)
  const { data: followerProfiles } = followerIds.length > 0
    ? await supabase
        .from('user_profiles')
        .select('id, username, display_name, bio')
        .in('id', followerIds)
    : { data: [] }

  const myFollowingIds = new Set((myFollowingData ?? []).map((f) => f.following_id))
  const profileMap = new Map((followerProfiles ?? []).map((p) => [p.id, p]))
  const followers = followerIds.flatMap((id) => {
    const profile = profileMap.get(id)
    return profile ? [{ ...profile, followsYouBack: myFollowingIds.has(profile.id) }] : []
  })

  return (
    <main className="min-h-screen bg-nyc-bg">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">

        {/* Header */}
        <div>
          <Link
            href="/following"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-nyc-muted-light transition-colors hover:text-white"
          >
            <ArrowLeft size={14} /> Following
          </Link>
          <div className="flex items-center gap-2 mt-2">
            <Users size={20} className="text-nyc-orange" />
            <h1 className="text-2xl font-bold text-white">
              Followers
              {followers.length > 0 && (
                <span className="ml-2 text-lg font-normal text-nyc-muted-light">({followers.length})</span>
              )}
            </h1>
          </div>
          <p className="mt-1 text-sm text-nyc-muted-light">People who follow you</p>
        </div>

        {/* List */}
        {followers.length === 0 ? (
          <div className="rounded border border-dashed border-nyc-border/40 p-12 text-center">
            <Users size={32} className="mx-auto mb-3 text-nyc-muted-light/30" />
            <p className="text-sm text-nyc-muted-light">No followers yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {followers.map((f) => (
              <Link
                key={f.id}
                href={`/users/${f.username}`}
                className="flex items-center gap-4 rounded border border-nyc-border bg-nyc-card p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card-hover"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-nyc-blue/10 text-sm font-bold text-nyc-blue">
                  {f.display_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-nyc-blue">{f.display_name}</p>
                    {f.followsYouBack && (
                      <span className="rounded-full border border-nyc-orange/30 bg-nyc-orange/10 px-2 py-0.5 text-xs text-nyc-orange">
                        Following
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-nyc-muted">@{f.username}</p>
                  {f.bio && (
                    <p className="mt-1 line-clamp-1 text-xs text-nyc-muted">{f.bio}</p>
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
