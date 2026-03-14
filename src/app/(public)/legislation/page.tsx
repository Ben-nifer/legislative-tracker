import { createServerSupabaseClient } from '@/lib/supabase/server'
import LegislationCard, {
  type LegislationCardData,
} from '@/components/legislation/LegislationCard'
import { FileText } from 'lucide-react'

export const metadata = {
  title: 'Browse Legislation | NYC Legislative Tracker',
  description: 'Browse and search New York City Council legislation.',
}

// Revalidate every 5 minutes — legislation data changes infrequently
export const revalidate = 300

async function getLegislation(): Promise<LegislationCardData[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('legislation')
    .select(
      `
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
        legislator:legislators(full_name, slug)
      )
    `
    )
    .order('intro_date', { ascending: false })
    .limit(60)

  if (error) {
    console.error('Error fetching legislation:', error.message)
    return []
  }

  // Shape raw rows into LegislationCardData
  return (data ?? []).map((row) => {
    const primarySponsorship = (row.sponsorships ?? []).find((s) => s.is_primary)
    const primaryLegislator = primarySponsorship
      ? Array.isArray(primarySponsorship.legislator)
        ? primarySponsorship.legislator[0]
        : primarySponsorship.legislator
      : null

    // legislation_stats is a 1-to-1 relation returned as an array by Supabase
    const statsRow = Array.isArray(row.stats) ? row.stats[0] : row.stats

    return {
      id: row.id,
      file_number: row.file_number,
      slug: row.slug,
      title: row.title,
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

export default async function LegislationPage() {
  const legislation = await getLegislation()

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
                Browse bills and resolutions introduced in the New York City
                Council
              </p>
            </div>
          </div>

          {/* Result count */}
          {legislation.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Showing {legislation.length} most recently introduced items
            </p>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {legislation.length === 0 ? (
          <EmptyState />
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <FileText className="mb-4 text-slate-700" size={48} />
      <h2 className="mb-2 text-lg font-semibold text-slate-400">
        No legislation yet
      </h2>
      <p className="max-w-sm text-sm text-slate-600">
        Legislation will appear here once the Legistar sync has run. Check back
        soon.
      </p>
    </div>
  )
}
