import { createServerSupabaseClient } from '@/lib/supabase/server'
import LegislationCard, {
  type LegislationCardData,
} from '@/components/legislation/LegislationCard'
import LegislationFilters from '@/components/legislation/LegislationFilters'
import { FileText } from 'lucide-react'
import { Suspense } from 'react'

export const metadata = {
  title: 'Browse Legislation | NYC Legislative Tracker',
  description: 'Browse and search New York City Council legislation.',
}

// Don't cache filtered results — each URL is unique
export const revalidate = 0

type Filters = {
  q?: string
  status?: string
  committee_id?: string
  sort?: string
}

async function getFilterOptions() {
  const supabase = await createServerSupabaseClient()

  const [{ data: statusRows }, { data: legRows }] = await Promise.all([
    supabase
      .from('legislation')
      .select('status')
      .eq('type', 'introduction')
      .not('status', 'is', null)
      .order('status'),
    supabase
      .from('legislation')
      .select('committee_id')
      .eq('type', 'introduction')
      .not('committee_id', 'is', null),
  ])

  // Deduplicate statuses
  const statuses = [...new Set((statusRows ?? []).map((r) => r.status as string))].sort()

  // Fetch committees that have at least one introduction
  const committeeIds = [...new Set((legRows ?? []).map((r) => r.committee_id as string))]
  const { data: committeeRows } = committeeIds.length > 0
    ? await supabase.from('committees').select('id, name').in('id', committeeIds).order('name')
    : { data: [] as { id: string; name: string }[] }

  return { statuses, committees: committeeRows ?? [] }
}

async function getLegislation(filters: Filters): Promise<LegislationCardData[]> {
  const supabase = await createServerSupabaseClient()

  const sortByEngagement = !filters.sort || filters.sort === 'most_engaged'

  let query = supabase
    .from('legislation')
    .select(
      `
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
      stats:legislation_stats(
        support_count,
        oppose_count,
        neutral_count,
        watching_count,
        comment_count,
        bookmark_count,
        trending_score
      ),
      sponsorships(
        is_primary,
        legislator:legislators(full_name, slug)
      )
    `
    )
    .eq('type', 'introduction')
    .limit(60)

  if (sortByEngagement) {
    query = query.order('trending_score', { referencedTable: 'legislation_stats', ascending: false, nullsFirst: false })
  } else {
    query = query.order('intro_date', { ascending: false })
  }

  if (filters.q) {
    query = query.or(
      `title.ilike.%${filters.q}%,ai_summary.ilike.%${filters.q}%,official_summary.ilike.%${filters.q}%`
    )
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.committee_id) {
    query = query.eq('committee_id', filters.committee_id)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching legislation:', error.message)
    return []
  }

  return (data ?? []).map((row) => {
    const primarySponsorship = (row.sponsorships ?? []).find((s) => s.is_primary)
    const primaryLegislator = primarySponsorship
      ? Array.isArray(primarySponsorship.legislator)
        ? primarySponsorship.legislator[0]
        : primarySponsorship.legislator
      : null

    const statsRow = Array.isArray(row.stats) ? row.stats[0] : row.stats

    return {
      id: row.id,
      file_number: row.file_number,
      slug: row.slug,
      title: row.title,
      short_summary: row.short_summary ?? null,
      status: row.status,
      type: row.type,
      intro_date: row.intro_date,
      last_action_date: row.last_action_date,
      ai_summary: row.ai_summary,
      official_summary: row.official_summary,
      stats: statsRow
        ? {
            support_count: statsRow.support_count ?? 0,
            oppose_count: statsRow.oppose_count ?? 0,
            neutral_count: statsRow.neutral_count ?? 0,
            watching_count: statsRow.watching_count ?? 0,
            comment_count: statsRow.comment_count ?? 0,
            bookmark_count: statsRow.bookmark_count ?? 0,
          }
        : null,
      primary_sponsor: primaryLegislator?.full_name ?? null,
      primary_sponsor_slug: primaryLegislator?.slug ?? null,
    }
  })
}

export default async function LegislationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; committee_id?: string; sort?: string }>
}) {
  const params = await searchParams
  const filters: Filters = {
    q: params.q,
    status: params.status,
    committee_id: params.committee_id,
    sort: params.sort,
  }

  const [legislation, { statuses, committees }] = await Promise.all([
    getLegislation(filters),
    getFilterOptions(),
  ])

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* Page header */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <FileText className="text-indigo-400" size={28} />
            <div>
              <h1 className="text-2xl font-bold text-slate-100">
                NYC Council Legislation
              </h1>
              <p className="mt-0.5 text-sm text-slate-400">
                Browse bills introduced in the New York City Council
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-6">
            <Suspense>
              <LegislationFilters statuses={statuses} committees={committees} />
            </Suspense>
          </div>

          {/* Result count */}
          <p className="mt-4 text-xs text-slate-500">
            {hasFilters
              ? `${legislation.length} result${legislation.length === 1 ? '' : 's'} found`
              : `Showing ${legislation.length} most recently introduced items`}
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {legislation.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {legislation.map((item) => (
              <LegislationCard key={item.id} legislation={item} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <FileText className="mb-4 text-slate-700" size={48} />
      <h2 className="mb-2 text-lg font-semibold text-slate-400">
        {hasFilters ? 'No results found' : 'No legislation yet'}
      </h2>
      <p className="max-w-sm text-sm text-slate-600">
        {hasFilters
          ? 'Try adjusting your filters or search term.'
          : 'Legislation will appear here once the Legistar sync has run. Check back soon.'}
      </p>
    </div>
  )
}
