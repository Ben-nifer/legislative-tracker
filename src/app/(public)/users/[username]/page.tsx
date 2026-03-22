import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowLeft, MessageSquare, Bookmark } from 'lucide-react'
import FollowUserButton from '@/components/profile/FollowUserButton'

export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('user_profiles')
    .select('display_name')
    .eq('username', username)
    .maybeSingle()
  if (!data) return { title: 'Not Found' }
  return { title: `${data.display_name} | NYC Legislative Tracker` }
}

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return 'bg-emerald-500/20 text-emerald-300'
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return 'bg-red-500/20 text-red-300'
  if (s.includes('hearing'))
    return 'bg-blue-500/20 text-blue-300'
  return 'bg-amber-500/20 text-amber-300'
}

function Initials({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-2xl font-bold text-indigo-300">
      {initials}
    </div>
  )
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, username, display_name, bio, avatar_url')
    .eq('username', username)
    .maybeSingle()

  if (!profile) notFound()

  const isOwnProfile = user?.id === profile.id

  const [
    isFollowingResult,
    { count: userFollowingCount },
    { count: legislatorFollowingCount },
    { count: followersCount },
    { count: supportCount },
    { count: opposeCount },
    { count: neutralCount },
    { data: bookmarksData },
    { data: commentsData },
  ] = await Promise.all([
    user && !isOwnProfile
      ? supabase
          .from('user_follows')
          .select('following_id')
          .match({ follower_id: user.id, following_id: profile.id })
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('user_follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', profile.id),
    supabase
      .from('legislator_follows')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id),
    supabase
      .from('user_follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', profile.id),
    supabase
      .from('user_stances')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('stance', 'support'),
    supabase
      .from('user_stances')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('stance', 'oppose'),
    supabase
      .from('user_stances')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('stance', 'neutral'),
    supabase
      .from('bookmarks')
      .select('legislation(id, slug, file_number, title, status)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('comments')
      .select('id, body, created_at, legislation(slug, file_number, title)')
      .eq('user_id', profile.id)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const isFollowing = !!(isFollowingResult as { data: unknown }).data
  const followingCount = (userFollowingCount ?? 0) + (legislatorFollowingCount ?? 0)

  const bookmarks = (bookmarksData ?? []).flatMap((b) => {
    const leg = Array.isArray(b.legislation) ? b.legislation[0] : b.legislation
    return leg ? [leg] : []
  })

  const comments = (commentsData ?? []).map((c) => {
    const leg = Array.isArray(c.legislation) ? c.legislation[0] : c.legislation
    return { ...c, legislation: leg ?? null }
  })

  return (
    <main className="min-h-screen bg-slate-950">
      {/* Back nav */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
          >
            <ArrowLeft size={14} /> Home
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Profile header */}
        <section className="flex items-start gap-5">
          <Initials name={profile.display_name} />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white">{profile.display_name}</h1>
            <p className="text-slate-500 text-sm mt-0.5">@{profile.username}</p>
            {profile.bio && (
              <p className="mt-2 text-sm text-slate-300">{profile.bio}</p>
            )}

            {/* Follower / following counts */}
            <div className="mt-3 flex items-center gap-4 text-sm">
              <span className="text-slate-400">
                <span className="font-semibold text-white">{followersCount ?? 0}</span> followers
              </span>
              <span className="text-slate-400">
                <span className="font-semibold text-white">{followingCount ?? 0}</span> following
              </span>
            </div>

            <div className="mt-3">
              <FollowUserButton
                targetUserId={profile.id}
                initialIsFollowing={isFollowing}
                isOwnProfile={isOwnProfile}
              />
            </div>
          </div>
        </section>

        {/* Stance summary */}
        <section>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Supporting', value: supportCount ?? 0, color: 'text-emerald-400' },
              { label: 'Opposing', value: opposeCount ?? 0, color: 'text-red-400' },
              { label: 'Neutral', value: neutralCount ?? 0, color: 'text-amber-400' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center"
              >
                <div className={`text-xl font-bold tabular-nums ${stat.color}`}>
                  {stat.value}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Saved legislation */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            <Bookmark size={14} />
            Saved Legislation
            {bookmarks.length > 0 && (
              <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs normal-case text-slate-300">
                {bookmarks.length}
              </span>
            )}
          </h2>
          {bookmarks.length === 0 ? (
            <p className="text-sm italic text-slate-600">No saved legislation.</p>
          ) : (
            <div className="space-y-3">
              {bookmarks.map((item) => (
                <Link
                  key={item.id}
                  href={`/legislation/${item.slug}`}
                  className="block rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700 hover:bg-slate-800/60"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${getStatusStyle(item.status)}`}>
                      {item.status}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{item.file_number}</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-slate-300">{item.title}</p>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Recent comments */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            <MessageSquare size={14} />
            Recent Comments
          </h2>
          {comments.length === 0 ? (
            <p className="text-sm italic text-slate-600">No comments yet.</p>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                >
                  <p className="line-clamp-3 text-sm text-slate-300">{comment.body}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {comment.legislation && (
                      <Link
                        href={`/legislation/${comment.legislation.slug}`}
                        className="font-mono text-xs text-indigo-400 hover:underline"
                      >
                        {comment.legislation.file_number}
                      </Link>
                    )}
                    <span className="text-xs text-slate-600">
                      {format(new Date(comment.created_at), 'MMM d, yyyy')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
