import { createServerSupabaseClient } from '@/lib/supabase/server'
import LegislationCard, {
  type LegislationCardData,
} from '@/components/legislation/LegislationCard'
import Link from 'next/link'
import { TrendingUp, Flame, Clock, Calendar, CalendarDays, Infinity } from 'lucide-react'

export const metadata = {
  title: 'Trending | NYC Legislative Tracker',
  description: 'See which NYC Council legislation is gaining the most attention.',
}

export const revalidate = 900

type Period = '24h' | '7d' | 'month' | 'year' | 'all'

const STATS_FIELDS = `
  support_count, oppose_count, neutral_count, watching_count,
  comment_count, bookmark_count, engagement_24h, engagement_7d, trending_score,
  legislation!inner(
    id, file_number, slug, title, short_summary, status, type,
    intro_date, last_action_date, ai_summary, official_summary,
    sponsorships(is_primary, legislator:legislators(full_name, slug))
  )
`

function buildCard(row: Record<string, unknown>): LegislationCardData | null {
  const leg = Array.isArray(row.legislation) ? (row.legislation as unknown[])[0] : row.legislation
  if (!leg || typeof leg !== 'object') return null
  const l = leg as Record<string, unknown>
  if (l.type !== 'introduction') return null

  const sponsorships = (l.sponsorships as { is_primary: boolean; legislator: unknown }[] | null) ?? []
  const primarySponsorship = sponsorships.find((s) => s.is_primary)
  const rawLegislator = primarySponsorship
    ? Array.isArray(primarySponsorship.legislator)
      ? (primarySponsorship.legislator as unknown[])[0]
      : primarySponsorship.legislator
    : null
  const legislator = rawLegislator as { full_name?: string; slug?: string } | null

  return {
    id: l.id as string,
    file_number: l.file_number as string,
    slug: l.slug as string,
    title: l.title as string,
    short_summary: (l.short_summary as string | null) ?? null,
    status: l.status as string,
    type: l.type as string,
    intro_date: (l.intro_date as string | null) ?? null,
    last_action_date: (l.last_action_date as string | null) ?? null,
    ai_summary: (l.ai_summary as string | null) ?? null,
    official_summary: (l.official_summary as string | null) ?? null,
    stats: {
      support_count: (row.support_count as number) ?? 0,
      oppose_count: (row.oppose_count as number) ?? 0,
      neutral_count: (row.neutral_count as number) ?? 0,
      watching_count: (row.watching_count as number) ?? 0,
      comment_count: (row.comment_count as number) ?? 0,
      bookmark_count: (row.bookmark_count as number) ?? 0,
    },
    primary_sponsor: legislator?.full_name ?? null,
    primary_sponsor_slug: legislator?.slug ?? null,
  }
}

async function getTrending(period: Period): Promise<LegislationCardData[]> {
  const supabase = await createServerSupabaseClient()

  // 24h and 7d: use pre-computed engagement columns
  if (period === '24h' || period === '7d') {
    const orderCol = period === '24h' ? 'engagement_24h' : 'engagement_7d'
    const { data, error } = await supabase
      .from('legislation_stats')
      .select(STATS_FIELDS)
      .gt(orderCol, 0)
      .order(orderCol, { ascending: false })
      .limit(100)

    if (error) { console.error('Error fetching trending:', error.message); return [] }
    return (data ?? []).map(r => buildCard(r as unknown as Record<string, unknown>)).filter(Boolean) as LegislationCardData[]
  }

  // month / year / all: aggregate engagement_events in JS, then fetch details
  let sinceDate: string | null = null
  if (period === 'month') {
    const now = new Date()
    sinceDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  } else if (period === 'year') {
    sinceDate = new Date(new Date().getFullYear(), 0, 1).toISOString()
  }

  let eventsQuery = supabase
    .from('engagement_events')
    .select('legislation_id')
    .limit(3000)

  if (sinceDate) {
    eventsQuery = eventsQuery.gte('created_at', sinceDate)
  }

  const { data: events } = await eventsQuery

  const counts = new Map<string, number>()
  for (const e of events ?? []) {
    if (e.legislation_id) {
      counts.set(e.legislation_id, (counts.get(e.legislation_id) ?? 0) + 1)
    }
  }

  const topIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([id]) => id)

  if (topIds.length === 0) return []

  const { data, error } = await supabase
    .from('legislation_stats')
    .select(STATS_FIELDS)
    .in('legislation_id', topIds)

  if (error) { console.error('Error fetching trending details:', error.message); return [] }

  const byId = new Map<string, LegislationCardData>()
  for (const row of data ?? []) {
    const card = buildCard(row as unknown as Record<string, unknown>)
    if (card) byId.set(card.id, card)
  }

  // return in engagement-count order
  return topIds.map(id => byId.get(id)).filter(Boolean) as LegislationCardData[]
}

function periodLabel(period: Period): string {
  if (period === '24h') return 'past 24 hours'
  if (period === '7d') return 'past 7 days'
  if (period === 'month') return 'this month'
  if (period === 'year') return 'this year'
  return 'all time'
}

const PAGE_SIZE = 10

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; page?: string }>
}) {
  const { period: rawPeriod, page: rawPage } = await searchParams
  const validPeriods: Period[] = ['24h', '7d', 'month', 'year', 'all']
  const period: Period = validPeriods.includes(rawPeriod as Period) ? (rawPeriod as Period) : '24h'

  const parsedPage = parseInt(rawPage ?? '1', 10)
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1

  const items = await getTrending(period)

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasNext = page * PAGE_SIZE < items.length
  const hasPrev = page > 1
  const startRank = (page - 1) * PAGE_SIZE + 1
  const endRank = Math.min(page * PAGE_SIZE, items.length)

  return (
    <main className="min-h-screen bg-nyc-bg">
      {/* Header */}
      <div className="border-b border-white/10 bg-nyc-blue px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <TrendingUp className="text-nyc-orange" size={28} />
            <div>
              <h1 className="text-2xl font-black uppercase tracking-widest text-white">Trending Legislation</h1>
              <p className="mt-0.5 text-sm text-blue-200">
                NYC Council bills gaining the most attention
              </p>
            </div>
          </div>

          {/* Period tabs */}
          <div className="mt-6 flex flex-wrap gap-2">
            <PeriodTab href="/trending?period=24h" active={period === '24h'} icon={<Flame size={14} />} label="24 hours" />
            <PeriodTab href="/trending?period=7d" active={period === '7d'} icon={<Clock size={14} />} label="7 days" />
            <PeriodTab href="/trending?period=month" active={period === 'month'} icon={<Calendar size={14} />} label="This month" />
            <PeriodTab href="/trending?period=year" active={period === 'year'} icon={<CalendarDays size={14} />} label="This year" />
            <PeriodTab href="/trending?period=all" active={period === 'all'} icon={<Infinity size={14} />} label="All time" />
          </div>

          {items.length > 0 && (
            <p className="mt-4 text-xs text-blue-200/70">
              Showing #{startRank}–#{endRank} by engagement — {periodLabel(period)}
            </p>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {items.length === 0 ? (
          <EmptyState period={period} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((item, i) => (
                <div key={item.id} className="relative">
                  <span className="absolute -left-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-nyc-orange text-xs font-bold text-white shadow">
                    {startRank + i}
                  </span>
                  <LegislationCard legislation={item} />
                </div>
              ))}
            </div>

            {(hasPrev || hasNext) && (
              <div className="mt-10 flex items-center justify-center gap-4">
                {hasPrev ? (
                  <Link
                    href={`/trending?period=${period}&page=${page - 1}`}
                    className="rounded border border-nyc-border bg-nyc-card px-5 py-2 text-sm font-bold text-nyc-blue transition-colors hover:border-nyc-border-light hover:text-nyc-orange"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <div className="w-28" />
                )}
                <span className="text-sm text-nyc-muted-light">Page {page} of {totalPages}</span>
                {hasNext ? (
                  <Link
                    href={`/trending?period=${period}&page=${page + 1}`}
                    className="rounded border border-nyc-border bg-nyc-card px-5 py-2 text-sm font-bold text-nyc-blue transition-colors hover:border-nyc-border-light hover:text-nyc-orange"
                  >
                    Next →
                  </Link>
                ) : (
                  <div className="w-28" />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function PeriodTab({
  href,
  active,
  icon,
  label,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className={[
        'flex items-center gap-1.5 rounded border px-4 py-2 text-sm font-bold uppercase tracking-wide transition-colors',
        active
          ? 'border-nyc-orange bg-nyc-orange/20 text-nyc-orange'
          : 'border-white/20 text-blue-200 hover:border-white/40 hover:text-white',
      ].join(' ')}
    >
      {icon}
      {label}
    </Link>
  )
}

function EmptyState({ period }: { period: Period }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <TrendingUp className="mb-4 text-nyc-muted-light/30" size={48} />
      <h2 className="mb-2 text-lg font-semibold text-white">No trending data yet</h2>
      <p className="max-w-sm text-sm text-nyc-muted-light">
        Trending is calculated from engagement events — {periodLabel(period)}. Check back after the
        stats refresh runs.
      </p>
    </div>
  )
}
