import { createServerSupabaseClient } from '@/lib/supabase/server'
import LegislationCard, {
  type LegislationCardData,
} from '@/components/legislation/LegislationCard'
import LegislationFilters from '@/components/legislation/LegislationFilters'
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import { Suspense } from 'react'
import Link from 'next/link'

export const metadata = {
  title: 'Browse Legislation | NYC Legislative Tracker',
  description: 'Browse and search New York City Council legislation.',
}

// Don't cache filtered results — each URL is unique
export const revalidate = 0

const PAGE_SIZE = 12

type Filters = {
  q?: string
  status?: string
  committee_id?: string
  sort?: string
  topic?: string
}

async function getFilterOptions() {
  const supabase = await createServerSupabaseClient()

  const [{ data: statusRows }, { data: legRows }, { data: topicsData }] = await Promise.all([
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
    supabase.from('topics').select('id, name, slug').order('name'),
  ])

  // Deduplicate statuses
  const statuses = [...new Set((statusRows ?? []).map((r) => r.status as string))].sort()

  // Fetch committees that have at least one introduction
  const committeeIds = [...new Set((legRows ?? []).map((r) => r.committee_id as string))]
  const { data: committeeRows } = committeeIds.length > 0
    ? await supabase.from('committees').select('id, name').in('id', committeeIds).order('name')
    : { data: [] as { id: string; name: string }[] }

  return { statuses, committees: committeeRows ?? [], topics: topicsData ?? [] }
}

async function getLegislation(
  filters: Filters,
  page: number
): Promise<{ items: LegislationCardData[]; total: number }> {
  const supabase = await createServerSupabaseClient()

  const sortByEngagement = !filters.sort || filters.sort === 'most_engaged'
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

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
    `,
      { count: 'exact' }
    )
    .eq('type', 'introduction')
    .range(from, to)

  if (sortByEngagement) {
    query = query.order('trending_score', { referencedTable: 'legislation_stats', ascending: false, nullsFirst: false })
  } else {
    query = query.order('intro_date', { ascending: false })
  }

  if (filters.q) {
    const { data: matchedLegislators } = await supabase
      .from('legislators')
      .select('id')
      .ilike('full_name', `%${filters.q}%`)

    let sponsoredIds: string[] = []
    if (matchedLegislators && matchedLegislators.length > 0) {
      const { data: sponsorRows } = await supabase
        .from('sponsorships')
        .select('legislation_id')
        .in('legislator_id', matchedLegislators.map((l) => l.id))
      sponsoredIds = (sponsorRows ?? []).map((s) => s.legislation_id)
    }

    const textFilter = `title.ilike.%${filters.q}%,ai_summary.ilike.%${filters.q}%,official_summary.ilike.%${filters.q}%,file_number.ilike.%${filters.q}%`

    query = sponsoredIds.length > 0
      ? query.or(`${textFilter},id.in.(${sponsoredIds.join(',')})`)
      : query.or(textFilter)
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.committee_id) {
    query = query.eq('committee_id', filters.committee_id)
  }

  if (filters.topic) {
    const { data: topicRow } = await supabase.from('topics').select('id').eq('slug', filters.topic).single()
    if (topicRow) {
      const { data: junctionRows } = await supabase
        .from('legislation_topics')
        .select('legislation_id')
        .eq('topic_id', topicRow.id)
      const topicLegislationIds = (junctionRows ?? []).map((r) => r.legislation_id)
      if (topicLegislationIds.length > 0) {
        query = query.in('id', topicLegislationIds)
      } else {
        return { items: [], total: 0 }
      }
    }
  }

  const { data, error, count } = await query

  if (error) {
    console.error('Error fetching legislation:', error.message)
    return { items: [], total: 0 }
  }

  const items = (data ?? []).map((row) => {
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

  return { items, total: count ?? 0 }
}

function buildPageUrl(
  filters: Filters,
  page: number
): string {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.status) params.set('status', filters.status)
  if (filters.committee_id) params.set('committee_id', filters.committee_id)
  if (filters.sort && filters.sort !== 'most_engaged') params.set('sort', filters.sort)
  if (filters.topic) params.set('topic', filters.topic)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `?${qs}` : '/legislation'
}

export default async function LegislationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; committee_id?: string; sort?: string; topic?: string; page?: string }>
}) {
  const params = await searchParams
  const filters: Filters = {
    q: params.q,
    status: params.status,
    committee_id: params.committee_id,
    sort: params.sort,
    topic: params.topic,
  }
  const currentPage = Math.max(1, Number(params.page) || 1)

  const [{ items: legislation, total }, { statuses, committees, topics }] = await Promise.all([
    getLegislation(filters, currentPage),
    getFilterOptions(),
  ])

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <main className="min-h-screen bg-nyc-bg text-white">
      {/* Page header */}
      <div className="border-b border-nyc-border bg-nyc-blue px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <FileText className="text-nyc-orange" size={28} />
            <div>
              <h1 className="text-2xl font-black uppercase tracking-widest text-white">
                NYC Council Legislation
              </h1>
              <p className="mt-0.5 text-sm text-nyc-muted">
                Browse bills introduced in the New York City Council
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-6">
            <Suspense>
              <LegislationFilters statuses={statuses} committees={committees} topics={topics} />
            </Suspense>
          </div>

          {/* Result count */}
          <p className="mt-4 text-xs text-nyc-muted">
            {hasFilters
              ? `${total} result${total === 1 ? '' : 's'} found`
              : `${total} bill${total === 1 ? '' : 's'} total`}
            {totalPages > 1 && ` · page ${currentPage} of ${totalPages}`}
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {legislation.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {legislation.map((item) => (
                <LegislationCard key={item.id} legislation={item} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-3">
                {currentPage > 1 ? (
                  <Link
                    href={buildPageUrl(filters, currentPage - 1)}
                    className="flex items-center gap-1.5 rounded border border-nyc-border-light bg-nyc-card px-4 py-2 text-sm font-bold text-nyc-muted transition-colors hover:border-nyc-orange hover:text-white"
                  >
                    <ChevronLeft size={15} /> Previous
                  </Link>
                ) : (
                  <span className="flex items-center gap-1.5 rounded border border-nyc-border px-4 py-2 text-sm text-nyc-border-light cursor-not-allowed">
                    <ChevronLeft size={15} /> Previous
                  </span>
                )}

                <span className="text-sm font-bold text-nyc-muted">
                  {currentPage} / {totalPages}
                </span>

                {currentPage < totalPages ? (
                  <Link
                    href={buildPageUrl(filters, currentPage + 1)}
                    className="flex items-center gap-1.5 rounded border border-nyc-border-light bg-nyc-card px-4 py-2 text-sm font-bold text-nyc-muted transition-colors hover:border-nyc-orange hover:text-white"
                  >
                    Next <ChevronRight size={15} />
                  </Link>
                ) : (
                  <span className="flex items-center gap-1.5 rounded border border-nyc-border px-4 py-2 text-sm text-nyc-border-light cursor-not-allowed">
                    Next <ChevronRight size={15} />
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <FileText className="mb-4 text-nyc-border" size={48} />
      <h2 className="mb-2 text-lg font-semibold text-nyc-muted-light">
        {hasFilters ? 'No results found' : 'No legislation yet'}
      </h2>
      <p className="max-w-sm text-sm text-nyc-muted">
        {hasFilters
          ? 'Try adjusting your filters or search term.'
          : 'Legislation will appear here once the Legistar sync has run. Check back soon.'}
      </p>
    </div>
  )
}
