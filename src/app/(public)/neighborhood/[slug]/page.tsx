import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { MapPin } from 'lucide-react'
import NeighborhoodMap, { type MapProposal } from '@/components/neighborhood/NeighborhoodMap'
import ProposalCard, { type ProposalCardData } from '@/components/neighborhood/ProposalCard'
import ProposalFilters from '@/components/neighborhood/ProposalFilters'

export const revalidate = 0

type Filters = {
  status?: string
  family?: string
  sort?: string
}

async function getDistrict(slug: string) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('community_districts')
    .select('id, slug, name, borough, geometry, bbox')
    .eq('slug', slug)
    .maybeSingle()
  return data
}

async function getProposals(districtSlug: string, filters: Filters) {
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
    .contains('community_districts', [districtSlug])

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.family) query = query.eq('proposal_family', filters.family)

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

export default async function NeighborhoodPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string; family?: string; sort?: string }>
}) {
  const { slug } = await params
  const filters = await searchParams

  const district = await getDistrict(slug)
  if (!district) notFound()

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const rows = await getProposals(slug, filters)

  let followedIds = new Set<string>()
  if (user && rows.length > 0) {
    const { data: followRows } = await supabase
      .from('proposal_follows')
      .select('local_proposal_id')
      .eq('user_id', user.id)
      .in('local_proposal_id', rows.map((r) => r.id))
    followedIds = new Set((followRows ?? []).map((f) => f.local_proposal_id))
  }

  const statuses = [...new Set(rows.map((r) => r.status))].sort()

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

  const cardData: ProposalCardData[] = rows.map((r) => ({
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
        <div className="flex items-center gap-3">
          <MapPin className="text-nyc-orange" size={24} />
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest text-white">
              {district.name}
            </h1>
            <p className="text-xs text-nyc-muted">
              {rows.length} local proposal{rows.length === 1 ? '' : 's'} · ULURP housing/rezoning & DOT street/capital projects
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Map — left */}
        <div className="h-[50vh] w-full lg:h-full lg:w-3/5">
          <NeighborhoodMap
            proposals={mapProposals}
            districtGeometry={district.geometry as GeoJSON.Geometry}
            districtBbox={district.bbox as [number, number, number, number]}
            isLoggedIn={!!user}
          />
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
                No local proposals found for this district yet.
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
          </div>
        </div>
      </div>
    </main>
  )
}
