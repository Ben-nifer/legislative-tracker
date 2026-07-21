import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ViewLogger from '@/components/legislation/ViewLogger'
import {
  MessageSquare,
  Calendar,
  User,
  Building2,
  ExternalLink,
  FileText,
  ArrowLeft,
  Clock,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import CommentThread from '@/components/comments/CommentThread'
import EngagementSection from '@/components/legislation/EngagementSection'
import FollowTopicButton from '@/components/topics/FollowTopicButton'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Sponsor = {
  full_name: string
  slug: string
  district: number | null
  is_primary: boolean
}

type HistoryItem = {
  id: string
  action_date: string | null
  action_text: string | null
  action_body_name: string | null
  passed_flag: boolean | null
}

type Hearing = {
  id: string
  event_date: string | null
  event_type: string | null
  location: string | null
  video_url: string | null
}

type LegislationDetail = {
  id: string
  file_number: string
  slug: string
  title: string
  status: string
  type: string
  intro_date: string | null
  last_action_date: string | null
  ai_summary: string | null
  official_summary: string | null
  legistar_url: string | null
  full_text_url: string | null
  committee_name: string | null
  sponsors: Sponsor[]
  history: HistoryItem[]
  upcoming_hearings: Hearing[]
  stats: {
    support_count: number
    oppose_count: number
    neutral_count: number
    watching_count: number
    comment_count: number
    bookmark_count: number
  }
  topics: { id: string; name: string; slug: string }[]
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getLegislation(slug: string): Promise<LegislationDetail | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('legislation')
    .select(`
      id,
      file_number,
      slug,
      title,
      status,
      type,
      intro_date,
      last_action_date,
      ai_summary,
      official_summary,
      legistar_url,
      full_text_url,
      stats:legislation_stats(
        support_count,
        oppose_count,
        neutral_count,
        watching_count,
        comment_count,
        bookmark_count
      ),
      sponsorships(
        is_primary,
        legislator:legislators(full_name, slug, district)
      ),
      history:legislation_history(
        id,
        action_date,
        action_text,
        action_body_name,
        passed_flag,
        sequence
      ),
      events(
        id,
        event_date,
        event_type,
        location,
        video_url
      ),
      legislation_topics(topic:topics(id, name, slug))
    `)
    .eq('slug', slug)
    .single()

  if (error || !data) return null

  const now = new Date()
  const statsRow = Array.isArray(data.stats) ? data.stats[0] : data.stats

  const sponsors: Sponsor[] = (data.sponsorships ?? [])
    .flatMap((s) => {
      const legislator = Array.isArray(s.legislator) ? s.legislator[0] : s.legislator
      if (!legislator) return []
      return [{ full_name: legislator.full_name, slug: legislator.slug, district: legislator.district, is_primary: s.is_primary }]
    })
    .sort((a: Sponsor, b: Sponsor) => Number(b.is_primary) - Number(a.is_primary))

  const upcomingHearings: Hearing[] = (data.events ?? [])
    .filter((e: { event_date: string | null }) => e.event_date && new Date(e.event_date) >= now)
    .slice(0, 3)

  return {
    id: data.id,
    file_number: data.file_number,
    slug: data.slug,
    title: data.title,
    status: data.status,
    type: data.type ?? 'other',
    intro_date: data.intro_date,
    last_action_date: data.last_action_date,
    ai_summary: data.ai_summary,
    official_summary: data.official_summary,
    legistar_url: data.legistar_url,
    full_text_url: data.full_text_url,
    committee_name: null,
    sponsors,
    history: (data.history ?? []).sort((a, b) => {
      if (a.sequence != null && b.sequence != null) return b.sequence - a.sequence
      return new Date(b.action_date ?? 0).getTime() - new Date(a.action_date ?? 0).getTime()
    }),
    upcoming_hearings: upcomingHearings,
    stats: {
      support_count: statsRow?.support_count ?? 0,
      oppose_count: statsRow?.oppose_count ?? 0,
      neutral_count: statsRow?.neutral_count ?? 0,
      watching_count: statsRow?.watching_count ?? 0,
      comment_count: statsRow?.comment_count ?? 0,
      bookmark_count: statsRow?.bookmark_count ?? 0,
    },
    topics: ((data.legislation_topics ?? []) as { topic: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null }[])
      .flatMap((lt) => {
        const t = Array.isArray(lt.topic) ? lt.topic[0] : lt.topic
        return t ? [t] : []
      }),
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function isValidSummary(text: string | null | undefined): boolean {
  if (!text || text.trim().length < 20) return false
  if (/^\d+$/.test(text.trim())) return false
  return true
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const legislation = await getLegislation(slug)
  if (!legislation) return { title: 'Not Found' }
  const summary = isValidSummary(legislation.ai_summary)
    ? legislation.ai_summary
    : isValidSummary(legislation.official_summary)
    ? legislation.official_summary
    : null
  return {
    title: `${legislation.file_number} | NYC Legislative Tracker`,
    description: summary ?? legislation.title,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border border-emerald-200' }
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', border: 'border border-red-200' }
  if (s.includes('hearing'))
    return { bg: 'bg-blue-50', text: 'text-nyc-blue', dot: 'bg-blue-500', border: 'border border-blue-200' }
  if (s.includes('committee'))
    return { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', border: 'border border-orange-200' }
  return { bg: 'bg-slate-50', text: 'text-nyc-muted', dot: 'bg-nyc-muted', border: 'border border-nyc-border' }
}

function fmt(dateStr: string | null) {
  if (!dateStr) return null
  return format(new Date(dateStr), 'MMM d, yyyy')
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function LegislationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const legislation = await getLegislation(slug)
  if (!legislation) notFound()

  let userStance: 'support' | 'oppose' | 'neutral' | null = null
  let isFollowing = false
  let friendsFollowing: { display_name: string; username: string }[] = []
  let followedTopicIds = new Set<string>()

  if (user) {
    const [stanceResult, followResult, followingIdsResult, topicFollowsResult] = await Promise.all([
      supabase
        .from('user_stances')
        .select('stance')
        .match({ user_id: user.id, legislation_id: legislation.id })
        .maybeSingle(),
      supabase
        .from('legislation_follows')
        .select('legislation_id')
        .match({ user_id: user.id, legislation_id: legislation.id })
        .maybeSingle(),
      supabase
        .from('user_follows')
        .select('following_id')
        .eq('follower_id', user.id),
      supabase
        .from('topic_follows')
        .select('topic_id')
        .eq('user_id', user.id),
    ])
    userStance = (stanceResult.data?.stance as typeof userStance) ?? null
    isFollowing = !!followResult.data
    followedTopicIds = new Set((topicFollowsResult.data ?? []).map((r) => r.topic_id))

    const followingIds = (followingIdsResult.data ?? []).map((r) => r.following_id)
    if (followingIds.length > 0) {
      const { data: friendRows } = await supabase
        .from('legislation_follows')
        .select('user_id, user_profiles(display_name, username)')
        .eq('legislation_id', legislation.id)
        .in('user_id', followingIds)
        .limit(5)
      friendsFollowing = (friendRows ?? []).flatMap((r) => {
        const p = Array.isArray(r.user_profiles) ? r.user_profiles[0] : r.user_profiles
        return p ? [{ display_name: p.display_name, username: p.username }] : []
      })
    }
  }

  const statusStyle = getStatusStyle(legislation.status)
  const summary = isValidSummary(legislation.ai_summary)
    ? legislation.ai_summary
    : isValidSummary(legislation.official_summary)
    ? legislation.official_summary
    : null
  const primarySponsor = legislation.sponsors.find((s) => s.is_primary)
  const coSponsors = legislation.sponsors.filter((s) => !s.is_primary)

  return (
    <main className="min-h-screen bg-nyc-bg">
      <ViewLogger legislationId={legislation.id} />

      {/* Back nav */}
      <div className="border-b border-white/10 bg-nyc-blue px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/legislation"
            className="inline-flex items-center gap-1.5 text-sm text-blue-200 transition-colors hover:text-white"
          >
            <ArrowLeft size={14} /> All Legislation
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-4">

          {/* ── Header ─────────────────────────────────────────────── */}
          <section className="rounded border border-nyc-border bg-nyc-card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                {legislation.status}
              </span>
              <span className="font-mono text-sm text-nyc-muted">
                {legislation.file_number}
              </span>
              <span className="rounded border border-nyc-border px-2.5 py-0.5 text-xs capitalize text-nyc-muted">
                {legislation.type}
              </span>
            </div>

            <h1 className="text-2xl font-bold leading-snug text-nyc-blue sm:text-3xl">
              {legislation.title}
            </h1>

            {legislation.intro_date && (
              <p className="mt-2 text-sm text-nyc-muted">
                Introduced {fmt(legislation.intro_date)}
                {primarySponsor && (
                  <> by{' '}
                    <Link
                      href={`/council-members/${primarySponsor.slug}`}
                      className="text-nyc-orange hover:underline"
                    >
                      {primarySponsor.full_name}
                    </Link>
                  </>
                )}
              </p>
            )}

            {legislation.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {legislation.topics.map((topic) => (
                  <FollowTopicButton
                    key={topic.id}
                    topicId={topic.id}
                    topicName={topic.name}
                    initialFollowing={followedTopicIds.has(topic.id)}
                    isLoggedIn={!!user}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Summary ────────────────────────────────────────────── */}
          <section className="rounded border border-nyc-border bg-nyc-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
              <FileText size={14} /> Summary
            </h2>
            {summary ? (
              <>
                <p className="leading-relaxed text-nyc-blue">{summary}</p>
                {legislation.ai_summary && isValidSummary(legislation.ai_summary) && (
                  <p className="mt-2 text-xs text-nyc-muted/60">
                    AI-generated summary &mdash; may not reflect official language
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm italic text-nyc-muted">No summary available yet.</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {legislation.full_text_url && (
                <a
                  href={legislation.full_text_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded border border-nyc-border px-3 py-1.5 text-xs text-nyc-muted transition-colors hover:border-nyc-border-light hover:text-nyc-blue"
                >
                  <ExternalLink size={12} /> Read Full Bill Text
                </a>
              )}
              {legislation.legistar_url && (
                <a
                  href={legislation.legistar_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded border border-nyc-border px-3 py-1.5 text-xs text-nyc-muted transition-colors hover:border-nyc-border-light hover:text-nyc-blue"
                >
                  <ExternalLink size={12} /> View on Legistar
                </a>
              )}
            </div>
          </section>

          {/* ── Two-col: Sponsors + Details ─────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Sponsors */}
            <section className="rounded border border-nyc-border bg-nyc-card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
                <User size={14} /> Sponsors
              </h2>
              {legislation.sponsors.length === 0 ? (
                <p className="text-sm italic text-nyc-muted">No sponsors listed.</p>
              ) : (
                <ul className="space-y-2">
                  {primarySponsor && (
                    <li className="flex items-center justify-between">
                      <Link
                        href={`/council-members/${primarySponsor.slug}`}
                        className="text-sm font-medium text-nyc-orange hover:underline"
                      >
                        {primarySponsor.full_name}
                      </Link>
                      <span className="rounded border border-nyc-orange/30 bg-nyc-orange/10 px-2 py-0.5 text-xs text-nyc-orange">
                        Primary
                      </span>
                    </li>
                  )}
                  {coSponsors.map((s) => (
                    <li key={s.slug} className="flex items-center justify-between">
                      <Link
                        href={`/council-members/${s.slug}`}
                        className="text-sm text-nyc-blue hover:text-nyc-orange hover:underline"
                      >
                        {s.full_name}
                      </Link>
                      {s.district && (
                        <span className="text-xs text-nyc-muted">Dist. {s.district}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Bill details */}
            <section className="rounded border border-nyc-border bg-nyc-card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
                <Building2 size={14} /> Details
              </h2>
              <dl className="space-y-2 text-sm">
                {legislation.committee_name && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-nyc-muted">Committee</dt>
                    <dd className="text-right text-nyc-blue">{legislation.committee_name}</dd>
                  </div>
                )}
                {legislation.intro_date && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-nyc-muted">Introduced</dt>
                    <dd className="text-nyc-blue">{fmt(legislation.intro_date)}</dd>
                  </div>
                )}
                {legislation.last_action_date && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-nyc-muted">Last Action</dt>
                    <dd className="text-nyc-blue">{fmt(legislation.last_action_date)}</dd>
                  </div>
                )}
              </dl>
            </section>
          </div>

          {/* ── Upcoming Hearings ───────────────────────────────────── */}
          {legislation.upcoming_hearings.length > 0 && (
            <section className="rounded border border-blue-200 bg-blue-50 p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-blue">
                <Calendar size={14} /> Upcoming Hearings
              </h2>
              <ul className="space-y-3">
                {legislation.upcoming_hearings.map((hearing) => (
                  <li key={hearing.id} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-nyc-blue/10 text-nyc-blue">
                      <Calendar size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-nyc-blue">
                        {hearing.event_type ?? 'Hearing'}
                      </p>
                      {hearing.event_date && (
                        <p className="text-xs text-nyc-muted">
                          {format(new Date(hearing.event_date), 'EEEE, MMM d, yyyy · h:mm a')}
                          <span className="ml-1 text-nyc-muted/60">
                            ({formatDistanceToNow(new Date(hearing.event_date), { addSuffix: true })})
                          </span>
                        </p>
                      )}
                      {hearing.location && (
                        <p className="text-xs text-nyc-muted">{hearing.location}</p>
                      )}
                      {hearing.video_url && (
                        <a
                          href={hearing.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-nyc-orange hover:underline"
                        >
                          Watch live <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Engagement ──────────────────────────────────────────── */}
          <section className="rounded border border-nyc-border bg-nyc-card p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
              Public Engagement
            </h2>
            <EngagementSection
              legislationId={legislation.id}
              initialStats={legislation.stats}
              initialUserStance={userStance}
              initialWatching={isFollowing}
              isLoggedIn={!!user}
              friendsFollowing={friendsFollowing}
            />
          </section>

          {/* ── Action history ──────────────────────────────────────── */}
          {legislation.history.length > 0 && (
            <section className="rounded border border-nyc-border bg-nyc-card p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
                <Clock size={14} /> History
              </h2>
              <ol className="relative border-l border-nyc-border pl-5 space-y-4">
                {legislation.history.map((item, i) => {
                  const dotColor = item.passed_flag === true
                    ? 'bg-emerald-500'
                    : item.passed_flag === false
                    ? 'bg-red-500'
                    : i === 0
                    ? 'bg-nyc-orange'
                    : 'bg-nyc-muted/40'
                  return (
                    <li key={item.id} className="relative">
                      <span className={`absolute -left-[21px] h-3 w-3 rounded-full border-2 border-nyc-card ${dotColor}`} />
                      <p className="text-sm text-nyc-blue">
                        {item.action_text ?? 'Action recorded'}
                      </p>
                      {item.action_body_name && (
                        <p className="mt-0.5 text-xs text-nyc-muted">
                          {item.action_body_name}
                        </p>
                      )}
                      {item.action_date && (
                        <p className="mt-0.5 text-xs text-nyc-muted/60">
                          {fmt(item.action_date)}
                          <span className="ml-1.5">
                            · {formatDistanceToNow(new Date(item.action_date), { addSuffix: true })}
                          </span>
                        </p>
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>
          )}

          {/* ── Comments ────────────────────────────────────────────── */}
          <div className="rounded border border-nyc-border bg-nyc-card p-5">
            <CommentThread legislationId={legislation.id} />
          </div>

        </div>
      </div>
    </main>
  )
}
