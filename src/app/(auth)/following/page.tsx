import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Tag, FileText, ArrowRight, UserRound, Bell } from 'lucide-react'
import { format } from 'date-fns'
import LegislationFollowRow from '@/components/following/LegislationFollowRow'

export const metadata = {
  title: 'Following | NYC Legislative Tracker',
}

export const revalidate = 0

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

export default async function FollowingPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/following')

  const [
    { data: legislatorFollows },
    { data: topicFollows },
    { data: userFollows },
    { data: legislationFollows },
  ] = await Promise.all([
    supabase
      .from('legislator_follows')
      .select('legislator_id, legislator:legislators(id, full_name, slug, district, borough, party)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('topic_follows')
      .select('topic_id, topic:topics(id, name, slug)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('user_follows')
      .select('following_id, profile:user_profiles!user_follows_following_id_fkey(id, username, display_name, bio)')
      .eq('follower_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('legislation_follows')
      .select(`
        legislation_id,
        notify_updates,
        notify_hearings,
        notify_amendments,
        legislation:legislation(id, file_number, slug, title, status)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const followedLegislators = (legislatorFollows ?? []).flatMap((f) => {
    const leg = Array.isArray(f.legislator) ? f.legislator[0] : f.legislator
    return leg ? [leg] : []
  })

  const followedTopics = (topicFollows ?? []).flatMap((f) => {
    const topic = Array.isArray(f.topic) ? f.topic[0] : f.topic
    return topic ? [topic] : []
  })

  const followedLegislation = (legislationFollows ?? []).flatMap((f) => {
    const leg = Array.isArray(f.legislation) ? f.legislation[0] : f.legislation
    if (!leg) return []
    return [{
      ...leg,
      notify_updates: f.notify_updates ?? true,
      notify_hearings: f.notify_hearings ?? true,
      notify_amendments: f.notify_amendments ?? true,
    }]
  })

  const followedUsers = (userFollows ?? []).flatMap((f) => {
    const profile = Array.isArray(f.profile) ? f.profile[0] : f.profile
    return profile ? [profile] : []
  })

  // Feed: recent legislation from followed legislators
  let feedItems: {
    id: string; slug: string; file_number: string; title: string
    status: string; intro_date: string | null; sponsor: string
  }[] = []

  if (followedLegislators.length > 0) {
    const legislatorIds = followedLegislators.map((l) => l.id)
    const { data: sponsorships } = await supabase
      .from('sponsorships')
      .select('is_primary, legislator_id, legislation:legislation(id, slug, file_number, title, status, intro_date)')
      .in('legislator_id', legislatorIds)
      .order('legislation(intro_date)', { ascending: false })
      .limit(30)

    const seen = new Set<string>()
    feedItems = (sponsorships ?? [])
      .flatMap((s) => {
        const leg = Array.isArray(s.legislation) ? s.legislation[0] : s.legislation
        if (!leg || seen.has(leg.id)) return []
        seen.add(leg.id)
        const sponsor = followedLegislators.find((l) => l.id === s.legislator_id)
        return [{ ...leg, sponsor: sponsor?.full_name ?? '' }]
      })
      .slice(0, 20)
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 space-y-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Following</h1>
          <Link href="/followers" className="text-sm text-indigo-400 hover:underline">
            View followers
          </Link>
        </div>

        {/* ── Followed Users ─────────────────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <UserRound size={16} className="text-pink-400" />
            <h2 className="font-semibold text-slate-200">
              Users
              {followedUsers.length > 0 && (
                <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                  {followedUsers.length}
                </span>
              )}
            </h2>
          </div>

          {followedUsers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center">
              <p className="text-sm text-slate-500">You&apos;re not following any users yet.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {followedUsers.map((u) => (
                <Link
                  key={u.id}
                  href={`/users/${u.username}`}
                  className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pink-500/20 text-sm font-bold text-pink-300">
                    {u.display_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">{u.display_name}</p>
                    <p className="truncate text-xs text-slate-500">@{u.username}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── Followed Council Members ──────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Users size={16} className="text-indigo-400" />
            <h2 className="font-semibold text-slate-200">
              Council Members
              {followedLegislators.length > 0 && (
                <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                  {followedLegislators.length}
                </span>
              )}
            </h2>
          </div>

          {followedLegislators.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center">
              <p className="text-sm text-slate-500">You&apos;re not following any council members yet.</p>
              <Link href="/council-members" className="mt-2 inline-flex items-center gap-1 text-sm text-indigo-400 hover:underline">
                Browse council members <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {followedLegislators.map((m) => (
                <Link
                  key={m.id}
                  href={`/council-members/${m.slug}`}
                  className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-bold text-indigo-300">
                    {m.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">{m.full_name}</p>
                    <p className="text-xs text-slate-500">
                      {m.district ? `District ${m.district}` : ''}
                      {m.district && m.borough ? ' · ' : ''}
                      {m.borough ?? ''}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── Followed Topics ───────────────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Tag size={16} className="text-purple-400" />
            <h2 className="font-semibold text-slate-200">
              Topics
              {followedTopics.length > 0 && (
                <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                  {followedTopics.length}
                </span>
              )}
            </h2>
          </div>

          {followedTopics.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center">
              <p className="text-sm text-slate-500">You&apos;re not following any topics yet.</p>
              <Link href="/legislation" className="mt-2 inline-flex items-center gap-1 text-sm text-indigo-400 hover:underline">
                Browse legislation to find topics <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {followedTopics.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-sm text-purple-300"
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* ── Followed Legislation ─────────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Bell size={16} className="text-emerald-400" />
            <h2 className="font-semibold text-slate-200">
              Legislation
              {followedLegislation.length > 0 && (
                <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                  {followedLegislation.length}
                </span>
              )}
            </h2>
          </div>

          {followedLegislation.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center">
              <p className="text-sm text-slate-500">You aren&apos;t following any bills yet.</p>
              <Link href="/legislation" className="mt-2 inline-flex items-center gap-1 text-sm text-indigo-400 hover:underline">
                Browse legislation to find bills to follow <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {followedLegislation.map((leg) => (
                <LegislationFollowRow
                  key={leg.id}
                  legislationId={leg.id}
                  slug={leg.slug}
                  file_number={leg.file_number}
                  title={leg.title}
                  status={leg.status}
                  notifyUpdates={leg.notify_updates}
                  notifyHearings={leg.notify_hearings}
                  notifyAmendments={leg.notify_amendments}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Feed: Recent from followed legislators ────────────────── */}
        {followedLegislators.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <FileText size={16} className="text-slate-400" />
              <h2 className="font-semibold text-slate-200">Recent legislation from people you follow</h2>
            </div>

            {feedItems.length === 0 ? (
              <p className="text-sm text-slate-500">No recent legislation found.</p>
            ) : (
              <div className="space-y-3">
                {feedItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/legislation/${item.slug}`}
                    className="block rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700 hover:bg-slate-800/60"
                  >
                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${getStatusStyle(item.status)}`}>
                        {item.status}
                      </span>
                      <span className="font-mono text-xs text-slate-500">{item.file_number}</span>
                      <span className="text-xs text-slate-600">by {item.sponsor}</span>
                      {item.intro_date && (
                        <span className="ml-auto text-xs text-slate-600">
                          {format(new Date(item.intro_date), 'MMM d, yyyy')}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-sm text-slate-300">{item.title}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

      </div>
    </main>
  )
}
