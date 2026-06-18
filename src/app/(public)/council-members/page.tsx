import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Users, TrendingUp, ThumbsUp, ThumbsDown } from 'lucide-react'
import MemberAvatar from '@/components/council/MemberAvatar'

export const metadata = {
  title: 'Council Members | NYC Legislative Tracker',
  description: 'Browse current New York City Council members.',
}

export const revalidate = 3600

type SortKey = 'most_popular' | 'least_popular' | 'most_engaged'

type Member = {
  id: string
  full_name: string
  slug: string
  title?: string | null
  district?: string | null
  borough?: string | null
  party?: string | null
  email?: string | null
  photo_url?: string | null
}

type MemberStats = {
  support: number
  oppose: number
  neutral: number
  watching: number
  total: number
  popularityRatio: number
}

const SORT_TABS: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: 'most_engaged', label: 'Most Engaged', icon: <TrendingUp size={13} /> },
  { key: 'most_popular', label: 'Most Popular', icon: <ThumbsUp size={13} /> },
  { key: 'least_popular', label: 'Least Popular', icon: <ThumbsDown size={13} /> },
]

function MemberCard({
  m,
  stats,
  sort,
}: {
  m: Member
  stats?: MemberStats
  sort: SortKey
}) {
  return (
    <Link
      href={`/council-members/${m.slug}`}
      className="flex items-start gap-3 rounded border border-nyc-border bg-nyc-card p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card-hover"
    >
      <MemberAvatar name={m.full_name} photoUrl={m.photo_url} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-nyc-blue truncate">{m.full_name}</p>
        <p className="text-xs text-nyc-muted mt-0.5">
          {m.district ? `District ${m.district}` : (m.title ?? 'Council Member')}
          {m.borough ? ` · ${m.borough}` : ''}
        </p>
        {m.party && <p className="text-xs text-nyc-muted/60 mt-0.5">{m.party}</p>}

        {stats && stats.total > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-emerald-600">{stats.support} support</span>
            <span className="text-red-600">{stats.oppose} oppose</span>
            {sort === 'most_engaged' && (
              <span className="text-amber-600">{stats.neutral} neutral</span>
            )}
            <span className="ml-auto text-slate-500">
              {sort === 'most_popular' || sort === 'least_popular'
                ? stats.support + stats.oppose > 0
                  ? `${Math.round((stats.support / (stats.support + stats.oppose)) * 100)}% approval`
                  : '—'
                : `${stats.total.toLocaleString()} total`}
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}

export default async function CouncilMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const { sort: rawSort } = await searchParams
  const sort: SortKey =
    rawSort === 'most_popular' || rawSort === 'least_popular'
      ? rawSort
      : 'most_engaged'

  const supabase = await createServerSupabaseClient()

  const { data: members } = await supabase
    .from('legislators')
    .select('id, full_name, slug, district, borough, party, email, title, photo_url')
    .eq('is_active', true)
    .order('district', { ascending: true })

  const memberList = members ?? []
  const memberIds = memberList.map((m) => m.id)

  // Always fetch stats (no borough view)
  const { data: sponsorships } = await supabase
    .from('sponsorships')
    .select('legislator_id, legislation_id')
    .in('legislator_id', memberIds)

  const legIds = [...new Set((sponsorships ?? []).map((s) => s.legislation_id))]

  const [{ data: stanceRows }, { data: commentRows }] = await Promise.all([
    legIds.length > 0
      ? supabase.from('user_stances').select('legislation_id, stance').in('legislation_id', legIds)
      : Promise.resolve({ data: [] }),
    legIds.length > 0
      ? supabase.from('comments').select('legislation_id').eq('is_hidden', false).in('legislation_id', legIds)
      : Promise.resolve({ data: [] }),
  ])

  type LegStats = { support: number; oppose: number; neutral: number; watching: number; comments: number }
  const byLeg = new Map<string, LegStats>()
  for (const { legislation_id, stance } of stanceRows ?? []) {
    if (!byLeg.has(legislation_id)) byLeg.set(legislation_id, { support: 0, oppose: 0, neutral: 0, watching: 0, comments: 0 })
    const s = byLeg.get(legislation_id)!
    if (stance === 'support') s.support++
    else if (stance === 'oppose') s.oppose++
    else if (stance === 'neutral') s.neutral++
    else if (stance === 'watching') s.watching++
  }
  for (const { legislation_id } of commentRows ?? []) {
    if (!byLeg.has(legislation_id)) byLeg.set(legislation_id, { support: 0, oppose: 0, neutral: 0, watching: 0, comments: 0 })
    byLeg.get(legislation_id)!.comments++
  }

  const statsByMember = new Map<string, MemberStats>()
  for (const { legislator_id, legislation_id } of sponsorships ?? []) {
    const leg = byLeg.get(legislation_id)
    if (!leg) continue

    const current = statsByMember.get(legislator_id) ?? { support: 0, oppose: 0, neutral: 0, watching: 0, total: 0, popularityRatio: 0 }
    const support = current.support + leg.support
    const oppose = current.oppose + leg.oppose
    const neutral = current.neutral + leg.neutral
    const watching = current.watching + leg.watching
    const total = current.total + leg.support + leg.oppose + leg.neutral + leg.watching + leg.comments
    const popularityRatio = (support + oppose) > 0 ? support / (support + oppose) : 0

    statsByMember.set(legislator_id, { support, oppose, neutral, watching, total, popularityRatio })
  }

  const sortedMembers = [...memberList].sort((a, b) => {
    const sa = statsByMember.get(a.id) ?? { support: 0, oppose: 0, neutral: 0, watching: 0, total: 0, popularityRatio: 0 }
    const sb = statsByMember.get(b.id) ?? { support: 0, oppose: 0, neutral: 0, watching: 0, total: 0, popularityRatio: 0 }
    const nameAsc = a.full_name.localeCompare(b.full_name)

    if (sort === 'most_popular') {
      // Pure approval %: higher ratio = higher rank
      // No-data members have ratio=0 and naturally fall to the bottom
      const diff = sb.popularityRatio - sa.popularityRatio
      if (diff !== 0) return diff
      // Tiebreaker: more votes = higher confidence in the rating
      const voteDiff = (sb.support + sb.oppose) - (sa.support + sa.oppose)
      return voteDiff !== 0 ? voteDiff : nameAsc
    }

    if (sort === 'least_popular') {
      const aHasData = sa.support + sa.oppose > 0
      const bHasData = sb.support + sb.oppose > 0
      if (aHasData && !bHasData) return -1
      if (!aHasData && bHasData) return 1
      const diff = sa.popularityRatio - sb.popularityRatio
      if (diff !== 0) return diff
      const opposeDiff = sb.oppose - sa.oppose
      return opposeDiff !== 0 ? opposeDiff : nameAsc
    }

    // most_engaged (default)
    const diff = sb.total - sa.total
    return diff !== 0 ? diff : nameAsc
  })

  return (
    <main className="min-h-screen bg-nyc-bg">
      <div className="border-b border-nyc-border bg-nyc-blue px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <Users className="text-nyc-orange" size={28} />
            <div>
              <h1 className="text-2xl font-black uppercase tracking-widest text-white">Council Members</h1>
              <p className="mt-0.5 text-sm text-blue-200">
                {memberList.length} active members of the New York City Council
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {SORT_TABS.map((tab) => (
              <Link
                key={tab.key}
                href={tab.key === 'most_engaged' ? '/council-members' : `/council-members?sort=${tab.key}`}
                className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-bold uppercase tracking-wide transition-colors ${
                  sort === tab.key
                    ? 'border-nyc-orange bg-nyc-orange/20 text-nyc-orange'
                    : 'border-white/20 text-blue-200 hover:border-white/40 hover:text-white'
                }`}
              >
                {tab.icon}
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedMembers.map((m, i) => (
            <div key={m.id} className="relative">
              <span className="absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-nyc-blue text-xs font-black text-white">
                {i + 1}
              </span>
              <MemberCard m={m} stats={statsByMember.get(m.id)} sort={sort} />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
