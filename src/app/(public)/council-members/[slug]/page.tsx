import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Mail, MapPin, FileText, Users, Newspaper, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import FollowButton from '@/components/council/FollowButton'
import MemberAvatar from '@/components/council/MemberAvatar'

export const revalidate = 3600

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return 'bg-red-50 text-red-700 border border-red-200'
  if (s.includes('hearing'))
    return 'bg-blue-50 text-nyc-blue border border-blue-200'
  return 'bg-orange-50 text-orange-700 border border-orange-200'
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('legislators')
    .select('full_name, title')
    .eq('slug', slug)
    .maybeSingle()
  if (!data) return { title: 'Not Found' }
  return { title: `${data.full_name} | NYC Legislative Tracker` }
}

// ---------------------------------------------------------------------------
// Google News RSS fetch
// ---------------------------------------------------------------------------

type NewsItem = { title: string; link: string; pubDate: string; source: string }

async function fetchNewsItems(memberName: string): Promise<NewsItem[]> {
  try {
    const q = encodeURIComponent(`"${memberName}" NYC Council`)
    const res = await fetch(
      `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
      { next: { revalidate: 3600 } }
    )
    if (!res.ok) return []
    const xml = await res.text()
    const items: NewsItem[] = []
    const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
    for (const m of matches) {
      const block = m[1]
      const title = (
        block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ??
        block.match(/<title>([\s\S]*?)<\/title>/)
      )?.[1]?.trim() ?? ''
      const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? ''
      const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? ''
      const source = (
        block.match(/<source[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/source>/) ??
        block.match(/<source[^>]*>([\s\S]*?)<\/source>/)
      )?.[1]?.trim() ?? ''
      if (title && link) {
        items.push({ title, link, pubDate, source })
        if (items.length >= 5) break
      }
    }
    return items
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Bill = {
  id: string
  slug: string
  file_number: string
  title: string
  status: string
  intro_date: string | null
  trending_score?: number
  engagement_7d?: number
}

// ---------------------------------------------------------------------------
// Compact bill card
// ---------------------------------------------------------------------------

function BillCard({ bill }: { bill: Bill }) {
  return (
    <Link
      href={`/legislation/${bill.slug}`}
      className="block rounded border border-nyc-border bg-nyc-card-hover p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card"
    >
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${getStatusStyle(bill.status)}`}>
          {bill.status}
        </span>
        <span className="font-mono text-xs text-nyc-muted">{bill.file_number}</span>
        {bill.intro_date && (
          <span className="ml-auto text-xs text-nyc-muted">
            {format(new Date(bill.intro_date), 'MMM d, yyyy')}
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-sm text-nyc-blue">{bill.title}</p>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CouncilMemberPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: member } = await supabase
    .from('legislators')
    .select(`
      id, full_name, slug, district, borough, party, email, title, is_active, photo_url,
      website_url, neighborhoods, community_boards, caucuses,
      legislator_committee_memberships(is_chair, committee:committees(name, slug))
    `)
    .eq('slug', slug)
    .maybeSingle()

  if (!member) notFound()

  // Parallel data fetching
  const [
    followResult,
    followerCountResult,
    sponsorshipsResult,
    allMembersResult,
  ] = await Promise.all([
    // Is current user following this member?
    user
      ? supabase
          .from('legislator_follows')
          .select('legislator_id')
          .match({ user_id: user.id, legislator_id: member.id })
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // Follower count
    supabase
      .from('legislator_follows')
      .select('*', { count: 'exact', head: true })
      .eq('legislator_id', member.id),

    // This member's sponsored legislation (with stats for most-engaged calc)
    supabase
      .from('sponsorships')
      .select(`
        is_primary,
        legislation(
          id, slug, file_number, title, status, type, intro_date,
          legislation_stats(trending_score, engagement_7d)
        )
      `)
      .eq('legislator_id', member.id)
      .order('legislation(intro_date)', { ascending: false })
      .limit(60),

    // All active member IDs (for popularity rank)
    supabase
      .from('legislators')
      .select('id')
      .eq('is_active', true),
  ])

  const isFollowing = !!followResult.data
  const followerCount = followerCountResult.count ?? 0
  const allMemberIds = (allMembersResult.data ?? []).map((m) => m.id)

  // Build bill lists
  const primaryBills: Bill[] = (sponsorshipsResult.data ?? [])
    .filter((s) => s.is_primary)
    .flatMap((s) => {
      const leg = Array.isArray(s.legislation) ? s.legislation[0] : s.legislation
      if (!leg) return []
      const stats = Array.isArray(leg.legislation_stats) ? leg.legislation_stats[0] : leg.legislation_stats
      return [{
        id: leg.id,
        slug: leg.slug,
        file_number: leg.file_number,
        title: leg.title,
        status: leg.status,
        intro_date: leg.intro_date,
        trending_score: stats?.trending_score ?? 0,
        engagement_7d: stats?.engagement_7d ?? 0,
      }]
    })

  const recentPrimaryBills = primaryBills.slice(0, 3)

  const mostEngagedBills = [...primaryBills]
    .sort((a, b) => (b.trending_score ?? 0) - (a.trending_score ?? 0))
    .slice(0, 3)

  // Popularity rank computation
  let popularityRank: number | null = null
  let totalRankedMembers = 0
  let memberApproval: number | null = null
  let memberSupportCount = 0
  let memberOpposeCount = 0

  if (allMemberIds.length > 0) {
    const { data: allSponsorships } = await supabase
      .from('sponsorships')
      .select('legislator_id, legislation_id')
      .in('legislator_id', allMemberIds)

    const allLegIds = [...new Set((allSponsorships ?? []).map((s) => s.legislation_id))]

    if (allLegIds.length > 0) {
      const [{ data: stanceRows }, { data: commentRows }] = await Promise.all([
        supabase.from('user_stances').select('legislation_id, stance').in('legislation_id', allLegIds),
        supabase.from('comments').select('legislation_id').eq('is_hidden', false).in('legislation_id', allLegIds),
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

      const statsByMember = new Map<string, { support: number; oppose: number; popularityRatio: number }>()
      for (const { legislator_id, legislation_id } of allSponsorships ?? []) {
        const leg = byLeg.get(legislation_id)
        if (!leg) continue
        const current = statsByMember.get(legislator_id) ?? { support: 0, oppose: 0, popularityRatio: 0 }
        const support = current.support + leg.support
        const oppose = current.oppose + leg.oppose
        const popularityRatio = (support + oppose) > 0 ? support / (support + oppose) : 0
        statsByMember.set(legislator_id, { support, oppose, popularityRatio })
      }

      const memberStats = statsByMember.get(member.id)
      if (memberStats) {
        memberSupportCount = memberStats.support
        memberOpposeCount = memberStats.oppose
        const memberRatio = memberStats.popularityRatio
        if (memberStats.support + memberStats.oppose > 0) {
          memberApproval = Math.round(memberRatio * 100)
          const membersWithData = [...statsByMember.values()].filter(s => s.support + s.oppose > 0)
          totalRankedMembers = membersWithData.length
          popularityRank = membersWithData.filter(s => s.popularityRatio > memberRatio).length + 1
        }
      }
    }
  }

  // Google News RSS
  const newsItems = await fetchNewsItems(member.full_name)

  // Committee memberships
  const memberships = (member.legislator_committee_memberships ?? []) as unknown as {
    is_chair: boolean
    committee: { name: string; slug: string } | null
  }[]
  const committees = memberships
    .filter((m) => m.committee)
    .sort((a, b) => Number(b.is_chair) - Number(a.is_chair))

  const hasDistrictInfo =
    member.borough || member.party || member.neighborhoods?.length ||
    member.community_boards?.length || member.website_url ||
    committees.length > 0 || member.caucuses?.length

  return (
    <main className="min-h-screen bg-nyc-bg">
      {/* Back nav */}
      <div className="border-b border-white/10 bg-nyc-blue px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/council-members"
            className="inline-flex items-center gap-1.5 text-sm text-blue-200 transition-colors hover:text-white"
          >
            <ArrowLeft size={14} /> All Council Members
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-4">

        {/* ── Profile header ───────────────────────────────────── */}
        <section className="rounded border border-nyc-border bg-nyc-card p-5">
          <div className="flex items-start gap-5">
            <MemberAvatar name={member.full_name} photoUrl={member.photo_url} size="lg" />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-nyc-blue">{member.full_name}</h1>
                {!member.is_active && (
                  <span className="rounded border border-nyc-border px-2 py-0.5 text-xs text-nyc-muted">
                    Former Member
                  </span>
                )}
              </div>
              <p className="mt-1 text-nyc-muted">
                {member.title ?? 'Council Member'}
                {member.district ? ` · District ${member.district}` : ''}
                {member.borough ? ` · ${member.borough}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                {member.party && (
                  <span className="flex items-center gap-1.5 text-nyc-muted">
                    <MapPin size={13} /> {member.party}
                  </span>
                )}
                {member.email && (
                  <a
                    href={`mailto:${member.email}`}
                    className="flex items-center gap-1.5 text-nyc-orange hover:underline"
                  >
                    <Mail size={13} /> {member.email}
                  </a>
                )}
              </div>
              <div className="mt-3">
                <FollowButton
                  legislatorId={member.id}
                  initialFollowing={isFollowing}
                  isLoggedIn={!!user}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── District Info ────────────────────────────────────── */}
        {hasDistrictInfo && (
          <section className="rounded border border-nyc-border bg-nyc-card p-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-nyc-muted">
              District Info
            </h2>
            <dl className="space-y-2.5 text-sm">
              {member.borough && (
                <div className="flex gap-2">
                  <dt className="w-36 shrink-0 text-nyc-muted">Borough</dt>
                  <dd className="text-nyc-blue">{member.borough}</dd>
                </div>
              )}
              {member.party && (
                <div className="flex gap-2">
                  <dt className="w-36 shrink-0 text-nyc-muted">Party</dt>
                  <dd className="text-nyc-blue">{member.party}</dd>
                </div>
              )}
              {member.neighborhoods?.length > 0 && (
                <div className="flex gap-2">
                  <dt className="w-36 shrink-0 text-nyc-muted">Neighborhoods</dt>
                  <dd className="text-nyc-blue">{member.neighborhoods.join(', ')}</dd>
                </div>
              )}
              {member.community_boards?.length > 0 && (
                <div className="flex gap-2">
                  <dt className="w-36 shrink-0 text-nyc-muted">Community Boards</dt>
                  <dd className="text-nyc-blue">{member.community_boards.join(', ')}</dd>
                </div>
              )}
              {member.website_url && (
                <div className="flex gap-2">
                  <dt className="w-36 shrink-0 text-nyc-muted">Website</dt>
                  <dd>
                    <a
                      href={member.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-nyc-orange hover:underline"
                    >
                      Official Website →
                    </a>
                  </dd>
                </div>
              )}
              {committees.length > 0 && (
                <div className="flex gap-2">
                  <dt className="w-36 shrink-0 text-nyc-muted">Committees</dt>
                  <dd className="space-y-1">
                    {committees.map((m) => (
                      <div key={m.committee!.slug} className="flex items-center gap-2">
                        <span className="text-nyc-blue">{m.committee!.name}</span>
                        {m.is_chair && (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                            Chair
                          </span>
                        )}
                      </div>
                    ))}
                  </dd>
                </div>
              )}
              {member.caucuses?.length > 0 && (
                <div className="flex gap-2">
                  <dt className="w-36 shrink-0 text-nyc-muted">Caucuses</dt>
                  <dd className="text-nyc-blue">{member.caucuses.join(', ')}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* ── Popularity & Followers ───────────────────────────── */}
        <section className="rounded border border-nyc-border bg-nyc-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
            Community Standing
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Popularity rank */}
            <div className="rounded border border-nyc-border bg-nyc-card-hover p-3 text-center">
              <div className="text-2xl font-black text-nyc-orange">
                {popularityRank != null ? `#${popularityRank}` : '—'}
              </div>
              <div className="text-xs text-nyc-muted mt-0.5">
                {popularityRank != null ? `of ${totalRankedMembers} ranked` : 'Not enough data'}
              </div>
              <div className="text-xs font-semibold text-nyc-blue mt-1">Popularity Rank</div>
            </div>

            {/* Approval % */}
            <div className="rounded border border-nyc-border bg-nyc-card-hover p-3 text-center">
              <div className="text-2xl font-black text-emerald-600">
                {memberApproval != null ? `${memberApproval}%` : '—'}
              </div>
              <div className="text-xs text-nyc-muted mt-0.5">
                {memberSupportCount > 0 ? `${memberSupportCount} support · ${memberOpposeCount} oppose` : 'No stance data'}
              </div>
              <div className="text-xs font-semibold text-nyc-blue mt-1">Approval Rating</div>
            </div>

            {/* Followers */}
            <div className="rounded border border-nyc-border bg-nyc-card-hover p-3 text-center">
              <div className="text-2xl font-black text-nyc-blue">
                {followerCount.toLocaleString()}
              </div>
              <div className="text-xs text-nyc-muted mt-0.5">on this platform</div>
              <div className="text-xs font-semibold text-nyc-blue mt-1">
                <span className="flex items-center justify-center gap-1"><Users size={11} /> Followers</span>
              </div>
            </div>

            {/* Bills sponsored */}
            <div className="rounded border border-nyc-border bg-nyc-card-hover p-3 text-center">
              <div className="text-2xl font-black text-nyc-blue">
                {primaryBills.length}
              </div>
              <div className="text-xs text-nyc-muted mt-0.5">as primary sponsor</div>
              <div className="text-xs font-semibold text-nyc-blue mt-1">Bills Sponsored</div>
            </div>
          </div>
        </section>

        {/* ── In the News ─────────────────────────────────────── */}
        <section className="rounded border border-nyc-border bg-nyc-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
            <Newspaper size={14} /> In the News
          </h2>
          {newsItems.length === 0 ? (
            <p className="text-sm italic text-nyc-muted">No recent news found.</p>
          ) : (
            <ul className="space-y-3">
              {newsItems.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-xs font-bold tabular-nums text-nyc-orange">{i + 1}</span>
                  <div className="min-w-0">
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-nyc-blue hover:text-nyc-orange hover:underline transition-colors line-clamp-2"
                    >
                      {item.title}
                    </a>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-nyc-muted">
                      {item.source && <span>{item.source}</span>}
                      {item.source && item.pubDate && <span>·</span>}
                      {item.pubDate && (
                        <span>{new Date(item.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Recent Sponsored Bills ───────────────────────────── */}
        <section className="rounded border border-nyc-border bg-nyc-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
            <FileText size={14} /> Recent Sponsored Bills
          </h2>
          {recentPrimaryBills.length === 0 ? (
            <p className="text-sm italic text-nyc-muted">No sponsored bills found.</p>
          ) : (
            <div className="space-y-3">
              {recentPrimaryBills.map((bill) => (
                <BillCard key={bill.id} bill={bill} />
              ))}
            </div>
          )}
        </section>

        {/* ── Most Engaged Bills ───────────────────────────────── */}
        <section className="rounded border border-nyc-border bg-nyc-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
            <TrendingUp size={14} /> Most Engaged Bills
          </h2>
          {mostEngagedBills.length === 0 ? (
            <p className="text-sm italic text-nyc-muted">No bills with engagement data yet.</p>
          ) : (
            <div className="space-y-3">
              {mostEngagedBills.map((bill, i) => (
                <div key={bill.id} className="relative">
                  <span className="absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-nyc-orange text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <BillCard bill={bill} />
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </main>
  )
}
