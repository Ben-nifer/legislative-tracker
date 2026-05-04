import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowLeft, MessageSquare, Bookmark, Link as LinkIcon } from 'lucide-react'
import FollowUserButton from '@/components/profile/FollowUserButton'
import Avatar from '@/components/profile/Avatar'
import OwnProfileEditor from './OwnProfileEditor'
import { PLATFORMS } from './platforms'
import AboutEditor from './AboutEditor'
import CouncilMemberFinder from '@/app/(auth)/profile/CouncilMemberFinder'

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
    .select('id, username, display_name, bio, avatar_url, links')
    .eq('username', username)
    .maybeSingle()

  if (!profile) notFound()

  const isOwnProfile = user?.id === profile.id

  // Base queries for all profiles
  const baseQueries = [
    user && !isOwnProfile
      ? supabase
          .from('user_follows')
          .select('following_id')
          .match({ follower_id: user.id, following_id: profile.id })
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id),
    supabase.from('legislator_follows').select('*', { count: 'exact', head: true }).eq('user_id', profile.id),
    supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('following_id', profile.id),
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', profile.id).eq('stance', 'support'),
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', profile.id).eq('stance', 'oppose'),
    supabase.from('user_stances').select('*', { count: 'exact', head: true }).eq('user_id', profile.id).eq('stance', 'neutral'),
    supabase
      .from('legislation_follows')
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
    supabase.from('user_interest_tags').select('tag:interest_tags(id, name, slug, is_predefined)').eq('user_id', profile.id),
  ] as const

  // Extra queries for own profile edit mode
  const ownerQueries = isOwnProfile
    ? [
        supabase
          .from('user_profiles')
          .select('notification_preferences, council_member_id, community_board, council_member:legislators(id, full_name, slug, district, borough, photo_url)')
          .eq('id', profile.id)
          .maybeSingle(),
        supabase.from('interest_tags').select('id, name, slug, is_predefined').eq('is_predefined', true).order('name'),
        supabase.from('user_interest_tags').select('tag:interest_tags(id, name, slug, is_predefined)').eq('user_id', profile.id),
      ] as const
    : null

  const results = await Promise.all(baseQueries)
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
    { data: interestTagsData },
  ] = results

  const isFollowing = !!(isFollowingResult as { data: unknown }).data
  const followingCount = (userFollowingCount ?? 0) + (legislatorFollowingCount ?? 0)

  const interestTags = (interestTagsData ?? []).flatMap((r) => {
    const t = Array.isArray(r.tag) ? r.tag[0] : r.tag
    return t ? [t] : []
  })

  const bookmarks = (bookmarksData ?? []).flatMap((b) => {
    const leg = Array.isArray(b.legislation) ? b.legislation[0] : b.legislation
    return leg ? [leg] : []
  })

  const comments = (commentsData ?? []).map((c) => {
    const leg = Array.isArray(c.legislation) ? c.legislation[0] : c.legislation
    return { ...c, legislation: leg ?? null }
  })

  const activeLinks = ((profile.links ?? []) as { platform: string; url: string }[]).filter(l => l.url?.trim())

  // Owner-specific data for edit mode
  let ownerData: {
    notificationPreferences: Record<string, boolean> | null
    communityBoard: string | null
    councilMember: { id: string; full_name: string; slug: string; district: number; borough: string | null; photo_url: string | null } | null
    predefinedTags: { id: string; name: string; slug: string; is_predefined: boolean }[]
    selectedIds: string[]
    customTags: { id: string; name: string; slug: string; is_predefined: boolean }[]
  } | null = null

  if (isOwnProfile && ownerQueries) {
    const [ownerProfileResult, predefinedTagsResult, userTagsResult] = await Promise.all(ownerQueries)
    const ownerProfile = ownerProfileResult.data
    const councilMemberRaw = ownerProfile?.council_member
    const councilMember = councilMemberRaw
      ? (Array.isArray(councilMemberRaw) ? councilMemberRaw[0] : councilMemberRaw) ?? null
      : null

    const predefinedTags = predefinedTagsResult.data ?? []
    const userTags = (userTagsResult.data ?? []).flatMap((r) => {
      const t = Array.isArray(r.tag) ? r.tag[0] : r.tag
      return t ? [t] : []
    })

    ownerData = {
      notificationPreferences: ownerProfile?.notification_preferences ?? null,
      communityBoard: ownerProfile?.community_board ?? null,
      councilMember: councilMember as typeof ownerData extends null ? never : NonNullable<typeof ownerData>['councilMember'],
      predefinedTags,
      selectedIds: userTags.map(t => t.id),
      customTags: userTags.filter(t => !t.is_predefined),
    }
  }

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
          <Avatar src={profile.avatar_url} name={profile.display_name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-white">{profile.display_name}</h1>
                <p className="text-slate-500 text-sm mt-0.5">@{profile.username}</p>
              </div>
              {isOwnProfile && ownerData && (
                <OwnProfileEditor
                  profile={{
                    id: profile.id,
                    username: profile.username,
                    display_name: profile.display_name,
                    bio: profile.bio,
                    avatar_url: profile.avatar_url,
                    links: profile.links as { platform: string; url: string }[] | null,
                    notification_preferences: ownerData.notificationPreferences as {
                      hearing_alerts: boolean
                      bill_updates: boolean
                      comment_engagement: boolean
                      new_followers: boolean
                    } | null,
                  }}
                  predefinedTags={ownerData.predefinedTags}
                  selectedIds={ownerData.selectedIds}
                  customTags={ownerData.customTags}
                />
              )}
            </div>

            {/* Social links */}
            {activeLinks.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {activeLinks.map(({ platform, url }) => {
                  const p = PLATFORMS.find(pl => pl.key === platform)
                  const Icon = p?.Icon ?? LinkIcon
                  const color = p?.color ?? 'text-slate-400'
                  const href = url.startsWith('http') ? url : `https://${url}`
                  return (
                    <a
                      key={platform}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={p?.label ?? platform}
                      className={`flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs ${color} transition-colors hover:border-slate-600`}
                    >
                      <Icon size={13} />
                      {p?.label ?? platform}
                    </a>
                  )
                })}
              </div>
            )}

            {/* Interest tags */}
            {interestTags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {interestTags.map((tag) => (
                  <span
                    key={tag.id}
                    className={[
                      'rounded-full border px-2.5 py-0.5 text-xs',
                      tag.is_predefined
                        ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
                        : 'border-purple-500/30 bg-purple-500/10 text-purple-300',
                    ].join(' ')}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
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

            {!isOwnProfile && (
              <div className="mt-3">
                <FollowUserButton
                  targetUserId={profile.id}
                  initialIsFollowing={isFollowing}
                  isOwnProfile={isOwnProfile}
                />
              </div>
            )}
          </div>
        </section>

        {/* About */}
        <AboutEditor initialBio={profile.bio} displayName={profile.display_name} isOwnProfile={isOwnProfile} />

        {/* Council Member Finder — own profile only */}
        {isOwnProfile && ownerData && (
          <CouncilMemberFinder
            initialMember={ownerData.councilMember}
            initialCommunityBoard={ownerData.communityBoard}
          />
        )}

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

        {/* Following legislation */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            <Bookmark size={14} />
            Following
            {bookmarks.length > 0 && (
              <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs normal-case text-slate-300">
                {bookmarks.length}
              </span>
            )}
          </h2>
          {bookmarks.length === 0 ? (
            <p className="text-sm italic text-slate-600">Not following any legislation.</p>
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
