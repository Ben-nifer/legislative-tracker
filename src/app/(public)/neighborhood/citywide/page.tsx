import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import Link from 'next/link'
import { Map as MapIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import NeighborhoodMap, { type MapProposal } from '@/components/neighborhood/NeighborhoodMap'
import ProposalCard, { type ProposalCardData } from '@/components/neighborhood/ProposalCard'
import ProposalFilters from '@/components/neighborhood/ProposalFilters'
import { COMPLETED_STATUSES_FILTER } from '@/lib/proposals/status'

export const revalidate = 0

const PAGE_SIZE = 50

type Filters = {
  status?: string
  family?: string
  sort?: string
  pending?: string
}

async function getAllProposals(filters: Filters) {
  const supabase = await createServerSupabaseClient()

  let query = supabase
    .from('local_proposals')
    .select(`
      id,
      slug,
      title,
      description,
      ai_summary,
      status,
      proposal_family,
      geometry_type,
      geometry,
      last_action_date,
      stats:proposal_stats(
        support_count,
        oppose_count,
        neutral_count,
        watching_count,
        comment_count,
        bookmark_count,
        trending_score
      )
    `)

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.family) query = query.eq('proposal_family', filters.family)
  if (filters.pending === '1') query = query.not('status', 'in', COMPLETED_STATUSES_FILTER)

  if (!filters.sort || filters.sort === 'most_engaged') {
    query = query.order('trending_score', { referencedTable: 'proposal_stats', ascending: false, nullsFirst: false })
  } else {
    query = query.order('last_action_date', { ascending: false })
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching proposals:', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    ...row,
    stats: Array.isArray(row.stats) ? row.stats[0] ?? null : row.stats,
  }))
}

function buildPageUrl(filters: Filters, page: number): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.family) params.set('family', filters.family)
  if (filters.sort && filters.sort !== 'most_engaged') params.set('sort', filters.sort)
  if (filters.pending === '1') params.set('pending', '1')
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `?${qs}` : '/neighborhood/citywide'
}

export default async function CitywideNeighborhoodPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; family?: string; sort?: string; pending?: string; page?: string }>
}) {
  const params = await searchParams
  const filters: Filters = { status: params.status, family: params.family, sort: params.sort, pending: params.pending }
  const currentPage = Math.max(1, Number(params.page) || 1)

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const rows = await getAllProposals(filters)

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  let followedIds = new Set<string>()
  if (user && pageRows.length > 0) {
    const { data: followRows } = await supabase
      .from('proposal_follows')
      .select('local_proposal_id')
      .eq('user_id', user.id)
      .in('local_proposal_id', pageRows.map((r) => r.id))
    followedIds = new Set((followRows ?? []).map((f) => f.local_proposal_id))
  }

  const statuses = [...new Set(rows.map((r) => r.status))].sort()

  // Map shows everything matching the current filters, not just this list page.
  const mapProposals: MapProposal[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    ai_summary: r.ai_summary,
    description: r.description,
    status: r.status,
    proposal_family: r.proposal_family as 'ulurp' | 'dot',
    geometry_type: r.geometry_type as 'point' | 'line' | 'polygon',
    geometry: r.geometry as GeoJSON.Geometry,
  }))

  const cardData: ProposalCardData[] = pageRows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    ai_summary: r.ai_summary,
    status: r.status,
    proposal_family: r.proposal_family as 'ulurp' | 'dot',
    geometry_type: r.geometry_type as 'point' | 'line' | 'polygon',
    last_action_date: r.last_action_date,
    stats: r.stats,
  }))

  return (
    <main className="flex h-screen flex-col bg-nyc-bg">
      <div className="border-b border-nyc-border bg-nyc-blue px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <MapIcon className="text-nyc-orange" size={24} />
            <div>
              <h1 className="text-lg font-black uppercase tracking-widest text-white">
                All NYC Local Proposals
              </h1>
              <p className="text-xs text-nyc-muted">
                {rows.length} local proposal{rows.length === 1 ? '' : 's'} citywide · ULURP housing/rezoning & DOT street/capital projects
              </p>
            </div>
          </div>
          <Link
            href="/neighborhood"
            className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/10"
          >
            Search by address
          </Link>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Map — left */}
        <div className="h-[50vh] w-full lg:h-full lg:w-3/5">
          <NeighborhoodMap proposals={mapProposals} isLoggedIn={!!user} />
        </div>

        {/* List — right */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-nyc-border lg:border-l lg:border-t-0 lg:w-2/5">
          <div className="border-b border-nyc-border p-4">
            <Suspense>
              <ProposalFilters statuses={statuses} />
            </Suspense>
          </div>

          <div className="flex-1 space-y-3 p-4">
            {cardData.length === 0 ? (
              <p className="py-12 text-center text-sm text-nyc-muted">
                No local proposals found.
              </p>
            ) : (
              cardData.map((item) => (
                <ProposalCard
                  key={item.id}
                  proposal={item}
                  initialFollowing={followedIds.has(item.id)}
                />
              ))
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-4">
                {currentPage > 1 ? (
                  <Link
                    href={buildPageUrl(filters, currentPage - 1)}
                    className="flex items-center gap-1 rounded border border-nyc-border bg-nyc-card px-3 py-1.5 text-xs font-bold text-nyc-muted transition-colors hover:border-nyc-orange hover:text-nyc-blue"
                  >
                    <ChevronLeft size={13} /> Prev
                  </Link>
                ) : (
                  <span className="flex items-center gap-1 rounded border border-nyc-border/50 px-3 py-1.5 text-xs text-nyc-muted/40">
                    <ChevronLeft size={13} /> Prev
                  </span>
                )}
                <span className="text-xs font-bold text-nyc-muted">
                  {currentPage} / {totalPages}
                </span>
                {currentPage < totalPages ? (
                  <Link
                    href={buildPageUrl(filters, currentPage + 1)}
                    className="flex items-center gap-1 rounded border border-nyc-border bg-nyc-card px-3 py-1.5 text-xs font-bold text-nyc-muted transition-colors hover:border-nyc-orange hover:text-nyc-blue"
                  >
                    Next <ChevronRight size={13} />
                  </Link>
                ) : (
                  <span className="flex items-center gap-1 rounded border border-nyc-border/50 px-3 py-1.5 text-xs text-nyc-muted/40">
                    Next <ChevronRight size={13} />
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
