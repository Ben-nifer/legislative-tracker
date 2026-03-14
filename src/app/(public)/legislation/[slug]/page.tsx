import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ThumbsUp,
  ThumbsDown,
  Minus,
  Eye,
  MessageSquare,
  Bookmark,
  Calendar,
  User,
  Building2,
  ExternalLink,
  FileText,
  ArrowLeft,
  Clock,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

export const revalidate = 300

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
        passed_flag
      ),
      events(
        id,
        event_date,
        event_type,
        location,
        video_url
      )
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
    history: (data.history ?? []).slice(0, 10),
    upcoming_hearings: upcomingHearings,
    stats: {
      support_count: statsRow?.support_count ?? 0,
      oppose_count: statsRow?.oppose_count ?? 0,
      neutral_count: statsRow?.neutral_count ?? 0,
      watching_count: statsRow?.watching_count ?? 0,
      comment_count: statsRow?.comment_count ?? 0,
      bookmark_count: statsRow?.bookmark_count ?? 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const legislation = await getLegislation(slug)
  if (!legislation) return { title: 'Not Found' }
  return {
    title: `${legislation.file_number} | NYC Legislative Tracker`,
    description: legislation.ai_summary ?? legislation.official_summary ?? legislation.title,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' }
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return { bg: 'bg-red-500/20', text: 'text-red-300', dot: 'bg-red-400' }
  if (s.includes('hearing'))
    return { bg: 'bg-blue-500/20', text: 'text-blue-300', dot: 'bg-blue-400' }
  if (s.includes('committee'))
    return { bg: 'bg-amber-500/20', text: 'text-amber-300', dot: 'bg-amber-400' }
  return { bg: 'bg-slate-500/20', text: 'text-slate-300', dot: 'bg-slate-400' }
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
  const legislation = await getLegislation(slug)

  if (!legislation) notFound()

  const statusStyle = getStatusStyle(legislation.status)
  const summary = legislation.ai_summary ?? legislation.official_summary
  const primarySponsor = legislation.sponsors.find((s) => s.is_primary)
  const coSponsors = legislation.sponsors.filter((s) => !s.is_primary)
  const total =
    legislation.stats.support_count +
    legislation.stats.oppose_count +
    legislation.stats.neutral_count

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* Back nav */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/legislation"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
          >
            <ArrowLeft size={14} /> All Legislation
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">

          {/* ── Header ─────────────────────────────────────────────── */}
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                {legislation.status}
              </span>
              <span className="font-mono text-sm text-slate-400">
                {legislation.file_number}
              </span>
              <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs capitalize text-slate-400">
                {legislation.type}
              </span>
            </div>

            <h1 className="text-2xl font-bold leading-snug text-slate-100 sm:text-3xl">
              {legislation.title}
            </h1>

            {legislation.intro_date && (
              <p className="mt-2 text-sm text-slate-500">
                Introduced {fmt(legislation.intro_date)}
                {primarySponsor && (
                  <> by{' '}
                    <Link
                      href={`/council-members/${primarySponsor.slug}`}
                      className="text-indigo-400 hover:underline"
                    >
                      {primarySponsor.full_name}
                    </Link>
                  </>
                )}
              </p>
            )}
          </section>

          {/* ── Summary ────────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-700/60 bg-slate-800/80 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              <FileText size={14} /> Summary
            </h2>
            {summary ? (
              <>
                <p className="leading-relaxed text-slate-200">{summary}</p>
                {legislation.ai_summary && (
                  <p className="mt-2 text-xs text-slate-600">
                    AI-generated summary &mdash; may not reflect official language
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm italic text-slate-500">No summary available yet.</p>
            )}

            {legislation.full_text_url && (
              <a
                href={legislation.full_text_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-400 hover:text-slate-100"
              >
                <ExternalLink size={12} /> Read Full Bill Text
              </a>
            )}
            {legislation.legistar_url && (
              <a
                href={legislation.legistar_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 mt-4 inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-400 hover:text-slate-100"
              >
                <ExternalLink size={12} /> View on Legistar
              </a>
            )}
          </section>

          {/* ── Two-col: Sponsors + Details ─────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Sponsors */}
            <section className="rounded-xl border border-slate-700/60 bg-slate-800/80 p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <User size={14} /> Sponsors
              </h2>
              {legislation.sponsors.length === 0 ? (
                <p className="text-sm italic text-slate-500">No sponsors listed.</p>
              ) : (
                <ul className="space-y-2">
                  {primarySponsor && (
                    <li className="flex items-center justify-between">
                      <Link
                        href={`/council-members/${primarySponsor.slug}`}
                        className="text-sm font-medium text-indigo-400 hover:underline"
                      >
                        {primarySponsor.full_name}
                      </Link>
                      <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">
                        Primary
                      </span>
                    </li>
                  )}
                  {coSponsors.map((s) => (
                    <li key={s.slug} className="flex items-center justify-between">
                      <Link
                        href={`/council-members/${s.slug}`}
                        className="text-sm text-slate-300 hover:text-indigo-400 hover:underline"
                      >
                        {s.full_name}
                      </Link>
                      {s.district && (
                        <span className="text-xs text-slate-600">Dist. {s.district}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Bill details */}
            <section className="rounded-xl border border-slate-700/60 bg-slate-800/80 p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <Building2 size={14} /> Details
              </h2>
              <dl className="space-y-2 text-sm">
                {legislation.committee_name && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Committee</dt>
                    <dd className="text-right text-slate-300">{legislation.committee_name}</dd>
                  </div>
                )}
                {legislation.intro_date && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Introduced</dt>
                    <dd className="text-slate-300">{fmt(legislation.intro_date)}</dd>
                  </div>
                )}
                {legislation.last_action_date && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Last Action</dt>
                    <dd className="text-slate-300">{fmt(legislation.last_action_date)}</dd>
                  </div>
                )}
              </dl>
            </section>
          </div>

          {/* ── Upcoming Hearings ───────────────────────────────────── */}
          {legislation.upcoming_hearings.length > 0 && (
            <section className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-blue-400">
                <Calendar size={14} /> Upcoming Hearings
              </h2>
              <ul className="space-y-3">
                {legislation.upcoming_hearings.map((hearing) => (
                  <li key={hearing.id} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
                      <Calendar size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">
                        {hearing.event_type ?? 'Hearing'}
                      </p>
                      {hearing.event_date && (
                        <p className="text-xs text-slate-400">
                          {format(new Date(hearing.event_date), 'EEEE, MMM d, yyyy · h:mm a')}
                          <span className="ml-1 text-slate-600">
                            ({formatDistanceToNow(new Date(hearing.event_date), { addSuffix: true })})
                          </span>
                        </p>
                      )}
                      {hearing.location && (
                        <p className="text-xs text-slate-500">{hearing.location}</p>
                      )}
                      {hearing.video_url && (
                        <a
                          href={hearing.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
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
          <section className="rounded-xl border border-slate-700/60 bg-slate-800/80 p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Public Engagement
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <EngagementStat
                icon={<ThumbsUp size={18} />}
                count={legislation.stats.support_count}
                label="Support"
                color="text-emerald-400"
                bg="bg-emerald-500/10"
                border="border-emerald-500/20"
              />
              <EngagementStat
                icon={<ThumbsDown size={18} />}
                count={legislation.stats.oppose_count}
                label="Oppose"
                color="text-red-400"
                bg="bg-red-500/10"
                border="border-red-500/20"
              />
              <EngagementStat
                icon={<Minus size={18} />}
                count={legislation.stats.neutral_count}
                label="Neutral"
                color="text-amber-400"
                bg="bg-amber-500/10"
                border="border-amber-500/20"
              />
              <EngagementStat
                icon={<Eye size={18} />}
                count={legislation.stats.watching_count}
                label="Watching"
                color="text-blue-400"
                bg="bg-blue-500/10"
                border="border-blue-500/20"
              />
            </div>

            {/* Stance bar */}
            {total > 0 && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>{Math.round((legislation.stats.support_count / total) * 100)}% support</span>
                  <span>{total.toLocaleString()} responses</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="bg-emerald-500"
                    style={{ width: `${(legislation.stats.support_count / total) * 100}%` }}
                  />
                  <div
                    className="bg-amber-500"
                    style={{ width: `${(legislation.stats.neutral_count / total) * 100}%` }}
                  />
                  <div
                    className="bg-red-500"
                    style={{ width: `${(legislation.stats.oppose_count / total) * 100}%` }}
                  />
                </div>
                <div className="mt-1 flex gap-4 text-xs text-slate-600">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Support
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-amber-500" /> Neutral
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-red-500" /> Oppose
                  </span>
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-4 border-t border-slate-700/60 pt-4 text-sm text-slate-500">
              <span className="flex items-center gap-1.5">
                <MessageSquare size={14} />
                {legislation.stats.comment_count.toLocaleString()} comments
              </span>
              <span className="flex items-center gap-1.5">
                <Bookmark size={14} />
                {legislation.stats.bookmark_count.toLocaleString()} saves
              </span>
            </div>
          </section>

          {/* ── Action history ──────────────────────────────────────── */}
          {legislation.history.length > 0 && (
            <section className="rounded-xl border border-slate-700/60 bg-slate-800/80 p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <Clock size={14} /> History
              </h2>
              <ol className="relative border-l border-slate-700 pl-5 space-y-4">
                {legislation.history.map((item, i) => (
                  <li key={item.id} className="relative">
                    <span
                      className={`absolute -left-[21px] flex h-3 w-3 items-center justify-center rounded-full border-2 border-slate-950 ${
                        i === 0 ? 'bg-indigo-400' : 'bg-slate-600'
                      }`}
                    />
                    <p className="text-sm text-slate-200">
                      {item.action_text ?? 'Action recorded'}
                    </p>
                    {item.action_date && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {fmt(item.action_date)}
                        <span className="ml-1.5">
                          · {formatDistanceToNow(new Date(item.action_date), { addSuffix: true })}
                        </span>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ── Comments placeholder ────────────────────────────────── */}
          <section
            id="comments"
            className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center"
          >
            <MessageSquare className="mx-auto mb-3 text-slate-700" size={32} />
            <p className="text-sm font-medium text-slate-500">Comments coming soon</p>
            <p className="mt-1 text-xs text-slate-700">
              Full comment threads with upvotes, stances, and filtering — Week 4
            </p>
          </section>

        </div>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EngagementStat({
  icon,
  count,
  label,
  color,
  bg,
  border,
}: {
  icon: React.ReactNode
  count: number
  label: string
  color: string
  bg: string
  border: string
}) {
  return (
    <div className={`rounded-lg border p-3 ${bg} ${border}`}>
      <div className={`mb-1 ${color}`}>{icon}</div>
      <p className={`text-xl font-bold tabular-nums ${color}`}>
        {count.toLocaleString()}
      </p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}
