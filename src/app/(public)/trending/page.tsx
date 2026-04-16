import { createServerSupabaseClient } from '@/lib/supabase/server'
import LegislationCard, {
  type LegislationCardData,
} from '@/components/legislation/LegislationCard'
import Link from 'next/link'
import { TrendingUp, Flame, Clock } from 'lucide-react'

export const metadata = {
  title: 'Trending | NYC Legislative Tracker',
  description: 'See which NYC Council legislation is gaining the most attention.',
}

// Revalidate every 15 minutes — aligned with the cron refresh
export const revalidate = 900

type Period = '24h' | '7d'

async function getTrending(period: Period): Promise<LegislationCardData[]> {
  const supabase = await createServerSupabaseClient()
  const orderCol = period === '24h' ? 'engagement_24h' : 'engagement_7d'

  const { data, error } = await supabase
    .from('legislation_stats')
    .select(
      `
      support_count,
      oppose_count,
      neutral_count,
      watching_count,
      comment_count,
      bookmark_count,
      engagement_24h,
      engagement_7d,
      trending_score,
      legislation!inner(
        id,
        file_number,
        slug,
        title,
        short_summary,
        status,
        type,
        intro_date,
        last_action_date,
        ai_summary,
        official_summary,
        sponsorships(
          is_primary,
          legislator:legislators(full_name, slug)
        )
      )
    `
    )
    .gt(orderCol, 0)
    .order(orderCol, { ascending: false })
    .limit(40)

  if (error) {
    console.error('Error fetching trending:', error.message)
    return []
  }

  const results: LegislationCardData[] = []

  for (const row of data ?? []) {
    const leg = Array.isArray(row.legislation) ? row.legislation[0] : row.legislation
    if (!leg || leg.type !== 'introduction') continue

    const primarySponsorship = (leg.sponsorships ?? []).find((s) => s.is_primary)
    const primaryLegislator = primarySponsorship
      ? Array.isArray(primarySponsorship.legislator)
        ? primarySponsorship.legislator[0]
        : primarySponsorship.legislator
      : null

    results.push({
      id: leg.id,
      file_number: leg.file_number,
      slug: leg.slug,
      title: leg.title,
      short_summary: leg.short_summary ?? null,
      status: leg.status,
      type: leg.type,
      intro_date: leg.intro_date,
      last_action_date: leg.last_action_date,
      ai_summary: leg.ai_summary,
      official_summary: leg.official_summary,
      stats: {
        support_count: row.support_count ?? 0,
        oppose_count: row.oppose_count ?? 0,
        neutral_count: row.neutral_count ?? 0,
        watching_count: row.watching_count ?? 0,
        comment_count: row.comment_count ?? 0,
        bookmark_count: row.bookmark_count ?? 0,
      },
      primary_sponsor: primaryLegislator?.full_name ?? null,
      primary_sponsor_slug: primaryLegislator?.slug ?? null,
    })
  }

  return results
}

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: rawPeriod } = await searchParams
  const period: Period = rawPeriod === '7d' ? '7d' : '24h'

  const items = await getTrending(period)

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <TrendingUp className="text-purple-400" size={28} />
            <div>
              <h1 className="text-2xl font-bold text-slate-100">Trending Legislation</h1>
              <p className="mt-0.5 text-sm text-slate-400">
                NYC Council bills gaining the most attention
              </p>
            </div>
          </div>

          {/* Period tabs */}
          <div className="mt-6 flex gap-2">
            <PeriodTab
              href="/trending?period=24h"
              active={period === '24h'}
              icon={<Flame size={14} />}
              label="Last 24 hours"
            />
            <PeriodTab
              href="/trending?period=7d"
              active={period === '7d'}
              icon={<Clock size={14} />}
              label="Last 7 days"
            />
          </div>

          {items.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Showing top {items.length} by engagement in the{' '}
              {period === '24h' ? 'past 24 hours' : 'past 7 days'}
            </p>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {items.length === 0 ? (
          <EmptyState period={period} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item, i) => (
              <div key={item.id} className="relative">
                {/* Rank badge */}
                <span className="absolute -left-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white shadow">
                  {i + 1}
                </span>
                <LegislationCard legislation={item} />
              </div>
            ))}
          </div>
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
        'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-purple-500/50 bg-purple-500/20 text-purple-300'
          : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200',
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
      <TrendingUp className="mb-4 text-slate-700" size={48} />
      <h2 className="mb-2 text-lg font-semibold text-slate-400">No trending data yet</h2>
      <p className="max-w-sm text-sm text-slate-600">
        Trending is calculated from engagement events in the{' '}
        {period === '24h' ? 'past 24 hours' : 'past 7 days'}. Check back after the
        stats refresh runs.
      </p>
    </div>
  )
}
