import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Tag, FileText, ArrowRight, UserRound, Bell, CalendarDays } from 'lucide-react'
import { format } from 'date-fns'
import LegislationCard, { type LegislationCardData } from '@/components/legislation/LegislationCard'

export const metadata = {
  title: 'Following | NYC Legislative Tracker',
}

export const revalidate = 0

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return 'bg-red-50 text-red-700 border border-red-200'
  if (s.includes('hearing'))
    return 'bg-blue-50 text-nyc-blue border border-blue-200'
  return 'bg-orange-50 text-orange-700 border border-orange-200'
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
        legislation:legislation(
          id, file_number, slug, title, short_summary, status, type,
          intro_date, last_action_date, ai_summary, official_summary,
          legislation_stats(support_count, oppose_count, neutral_count, watching_count, comment_count, bookmark_count),
          sponsorships!left(is_primary, legislator:legislators(full_name, slug))
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const followedLegislationIds = (legislationFollows ?? []).map((f) => f.legislation_id)
  const { data: upcomingEvents } = followedLegislationIds.length > 0
    ? await supabase
        .from('events')
        .select('id, event_date, event_type, location, legislation_id, legislation:legislation(file_number, slug, title, short_summary)')
        .in('legislation_id', followedLegislationIds)
        .gte('event_date', new Date().toISOString())
        .order('event_date', { ascending: true })
        .limit(20)
    : { data: [] }

  const followedLegislators = (legislatorFollows ?? []).flatMap((f) => {
    const leg = Array.isArray(f.legislator) ? f.legislator[0] : f.legislator
    return leg ? [leg] : []
  })

  const followedTopics = (topicFollows ?? []).flatMap((f) => {
    const topic = Array.isArray(f.topic) ? f.topic[0] : f.topic
    return topic ? [topic] : []
  })

  const followedLegislation: LegislationCardData[] = (legislationFollows ?? []).flatMap((f) => {
    const leg = Array.isArray(f.legislation) ? f.legislation[0] : f.legislation
    if (!leg) return []
    const stats = Array.isArray((leg as any).legislation_stats)
      ? (leg as any).legislation_stats[0]
      : (leg as any).legislation_stats
    const sponsorships: { is_primary: boolean; legislator: { full_name: string; slug: string } | null }[] =
      (leg as any).sponsorships ?? []
    const primarySponsor = sponsorships.find((s) => s.is_primary)?.legislator
    return [{
      id: leg.id,
      file_number: leg.file_number,
      slug: leg.slug,
      title: leg.title,
      short_summary: (leg as any).short_summary ?? null,
      status: leg.status,
      type: (leg as any).type ?? 'introduction',
      intro_date: (leg as any).intro_date ?? null,
      last_action_date: (leg as any).last_action_date ?? null,
      ai_summary: (leg as any).ai_summary ?? null,
      official_summary: (leg as any).official_summary ?? null,
      stats: stats ?? null,
      primary_sponsor: primarySponsor?.full_name ?? null,
      primary_sponsor_slug: primarySponsor?.slug ?? null,
    }]
  })

  type UpcomingEvent = {
    id: string
    event_date: string
    event_type: string | null
    location: string | null
    legislation_id: string
    legislation: { file_number: string; slug: string; title: string; short_summary: string | null } | null
  }

  const eventsByDate = new Map<string, UpcomingEvent[]>()
  for (const ev of (upcomingEvents ?? []) as unknown as UpcomingEvent[]) {
    if (!ev.event_date) continue
    const leg = Array.isArray(ev.legislation) ? ev.legislation[0] : ev.legislation
    const dateKey = format(new Date(ev.event_date), 'yyyy-MM-dd')
    if (!eventsByDate.has(dateKey)) eventsByDate.set(dateKey, [])
    eventsByDate.get(dateKey)!.push({ ...ev, legislation: leg ?? null })
  }
  const sortedDates = [...eventsByDate.keys()].sort()

  const followedUsers = (userFollows ?? []).flatMap((f) => {
    const profile = Array.isArray(f.profile) ? f.profile[0] : f.profile
    return profile ? [profile] : []
  })

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
    <main className="min-h-screen bg-nyc-bg">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 space-y-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Following</h1>
          <Link href="/followers" className="text-sm text-nyc-orange hover:underline">
            View followers
          </Link>
        </div>

        {/* ── Upcoming ──────────────────────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays size={16} className="text-blue-400" />
            <h2 className="font-semibold text-white">Upcoming</h2>
          </div>

          {sortedDates.length === 0 ? (
            <div className="rounded border border-dashed border-nyc-border/40 p-8 text-center">
              <p className="text-sm text-nyc-muted-light">No upcoming hearings or votes for bills you follow.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {sortedDates.map((dateKey) => {
                const events = eventsByDate.get(dateKey)!
                return (
                  <div key={dateKey}>
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-nyc-muted-light">
                      {format(new Date(dateKey + 'T12:00:00'), 'EEEE, MMMM d')}
                    </p>
                    <div className="space-y-2">
                      {events.map((ev) => {
                        const isVote = ev.event_type?.toLowerCase().includes('vote')
                        return (
                          <div
                            key={ev.id}
                            className="flex items-start gap-3 rounded border border-nyc-border bg-nyc-card p-4"
                          >
                            <span className={[
                              'mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide',
                              isVote
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-blue-50 text-nyc-blue border border-blue-200',
                            ].join(' ')}>
                              {ev.event_type ?? 'Hearing'}
                            </span>
                            <div className="min-w-0">
                              {ev.legislation ? (
                                <Link
                                  href={`/legislation/${ev.legislation.slug}`}
                                  className="text-sm font-medium text-nyc-blue hover:text-nyc-orange hover:underline transition-colors"
                                >
                                  <span className="font-mono text-xs text-nyc-muted mr-1.5">
                                    {ev.legislation.file_number}
                                  </span>
                                  {ev.legislation.short_summary ?? ev.legislation.title}
                                </Link>
                              ) : null}
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-nyc-muted">
                                <span>{format(new Date(ev.event_date), 'h:mm a')}</span>
                                {ev.location && <span>· {ev.location}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── Followed Users ─────────────────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <UserRound size={16} className="text-nyc-orange" />
            <h2 className="font-semibold text-white">
              Users
              {followedUsers.length > 0 && (
                <span className="ml-2 rounded-full border border-nyc-border/40 bg-white/10 px-2 py-0.5 text-xs text-white">
                  {followedUsers.length}
                </span>
              )}
            </h2>
          </div>

          {followedUsers.length === 0 ? (
            <div className="rounded border border-dashed border-nyc-border/40 p-8 text-center">
              <p className="text-sm text-nyc-muted-light">You&apos;re not following any users yet.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {followedUsers.map((u) => (
                <Link
                  key={u.id}
                  href={`/users/${u.username}`}
                  className="flex items-center gap-3 rounded border border-nyc-border bg-nyc-card p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card-hover"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nyc-orange/10 text-sm font-bold text-nyc-orange">
                    {u.display_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-nyc-blue">{u.display_name}</p>
                    <p className="truncate text-xs text-nyc-muted">@{u.username}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── Followed Council Members ──────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Users size={16} className="text-nyc-blue" />
            <h2 className="font-semibold text-white">
              Council Members
              {followedLegislators.length > 0 && (
                <span className="ml-2 rounded-full border border-nyc-border/40 bg-white/10 px-2 py-0.5 text-xs text-white">
                  {followedLegislators.length}
                </span>
              )}
            </h2>
          </div>

          {followedLegislators.length === 0 ? (
            <div className="rounded border border-dashed border-nyc-border/40 p-8 text-center">
              <p className="text-sm text-nyc-muted-light">You&apos;re not following any council members yet.</p>
              <Link href="/council-members" className="mt-2 inline-flex items-center gap-1 text-sm text-nyc-orange hover:underline">
                Browse council members <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {followedLegislators.map((m) => (
                <Link
                  key={m.id}
                  href={`/council-members/${m.slug}`}
                  className="flex items-center gap-3 rounded border border-nyc-border bg-nyc-card p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card-hover"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nyc-blue/10 text-sm font-bold text-nyc-blue">
                    {m.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-nyc-blue">{m.full_name}</p>
                    <p className="text-xs text-nyc-muted">
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
            <Tag size={16} className="text-nyc-orange" />
            <h2 className="font-semibold text-white">
              Topics
              {followedTopics.length > 0 && (
                <span className="ml-2 rounded-full border border-nyc-border/40 bg-white/10 px-2 py-0.5 text-xs text-white">
                  {followedTopics.length}
                </span>
              )}
            </h2>
          </div>

          {followedTopics.length === 0 ? (
            <div className="rounded border border-dashed border-nyc-border/40 p-8 text-center">
              <p className="text-sm text-nyc-muted-light">You&apos;re not following any topics yet.</p>
              <Link href="/legislation" className="mt-2 inline-flex items-center gap-1 text-sm text-nyc-orange hover:underline">
                Browse legislation to find topics <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {followedTopics.map((t) => (
                <Link
                  key={t.id}
                  href={`/legislation?topic=${t.slug}`}
                  className="rounded-full border border-nyc-orange/30 bg-nyc-orange/10 px-3 py-1 text-sm text-nyc-orange transition-colors hover:border-nyc-orange/60 hover:bg-nyc-orange/20"
                >
                  {t.name}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── Bills You Follow ─────────────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Bell size={16} className="text-emerald-500" />
            <h2 className="font-semibold text-white">
              Bills You Follow
              {followedLegislation.length > 0 && (
                <span className="ml-2 rounded-full border border-nyc-border/40 bg-white/10 px-2 py-0.5 text-xs text-white">
                  {followedLegislation.length}
                </span>
              )}
            </h2>
          </div>

          {followedLegislation.length === 0 ? (
            <div className="rounded border border-dashed border-nyc-border/40 p-8 text-center">
              <p className="text-sm text-nyc-muted-light">You aren&apos;t following any bills yet.</p>
              <Link href="/legislation" className="mt-2 inline-flex items-center gap-1 text-sm text-nyc-orange hover:underline">
                Browse legislation to find bills to follow <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {followedLegislation.map((leg) => (
                <LegislationCard
                  key={leg.id}
                  legislation={leg}
                  initialFollowing={true}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Feed: Recent from followed legislators ────────────────── */}
        {followedLegislators.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <FileText size={16} className="text-nyc-muted-light" />
              <h2 className="font-semibold text-white">Recent legislation from people you follow</h2>
            </div>

            {feedItems.length === 0 ? (
              <p className="text-sm text-nyc-muted-light">No recent legislation found.</p>
            ) : (
              <div className="space-y-3">
                {feedItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/legislation/${item.slug}`}
                    className="block rounded border border-nyc-border bg-nyc-card p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card-hover"
                  >
                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${getStatusStyle(item.status)}`}>
                        {item.status}
                      </span>
                      <span className="font-mono text-xs text-nyc-muted">{item.file_number}</span>
                      <span className="text-xs text-nyc-muted">by {item.sponsor}</span>
                      {item.intro_date && (
                        <span className="ml-auto text-xs text-nyc-muted">
                          {format(new Date(item.intro_date), 'MMM d, yyyy')}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-sm text-nyc-blue">{item.title}</p>
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
