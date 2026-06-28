import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ArrowRight, TrendingUp, Rss, Sparkles, MapPin } from 'lucide-react'
import { format } from 'date-fns'
import MemberAvatar from '@/components/council/MemberAvatar'
import CouncilMemberLookup from '@/components/council/CouncilMemberLookup'

export const revalidate = 300

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return 'bg-red-50 text-red-700 border border-red-200'
  if (s.includes('hearing'))
    return 'bg-blue-50 text-nyc-blue border border-blue-200'
  if (s.includes('committee'))
    return 'bg-orange-50 text-orange-700 border border-orange-200'
  return 'bg-slate-100 text-nyc-muted border border-nyc-border'
}

type LegislationRow = {
  id: string
  slug: string
  file_number: string
  title: string
  short_summary?: string | null
  status: string
  type: string | null
  intro_date: string | null
  ai_summary?: string | null
}

type FeedItem = LegislationRow

async function getForYouLegislation(userId: string, supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  // Step 1 — committee IDs from user's engaged legislation
  const { data: committeeRows } = await supabase
    .from('user_stances')
    .select('legislation!inner(committee_id)')
    .eq('user_id', userId)
    .not('legislation.committee_id', 'is', null)

  const committeeIds = [
    ...new Set(
      (committeeRows ?? []).flatMap((r) => {
        const leg = Array.isArray(r.legislation) ? r.legislation[0] : r.legislation
        return leg?.committee_id ? [leg.committee_id as string] : []
      })
    ),
  ]

  // Step 2 — IDs to exclude (already engaged)
  const [{ data: stanceExclude }, { data: followExclude }] = await Promise.all([
    supabase.from('user_stances').select('legislation_id').eq('user_id', userId),
    supabase.from('legislation_follows').select('legislation_id').eq('user_id', userId),
  ])

  const excludedIds = [
    ...(stanceExclude ?? []).map((r) => r.legislation_id),
    ...(followExclude ?? []).map((r) => r.legislation_id),
  ]

  let candidates: LegislationRow[] = []
  let followedTopicIds: string[] = []

  // Step 3 — fetch from engaged committees
  if (committeeIds.length > 0) {
    const query = supabase
      .from('legislation')
      .select('id, slug, file_number, title, short_summary, status, type, intro_date, legislation_stats!inner(trending_score)')
      .eq('type', 'introduction')
      .in('committee_id', committeeIds)
      .order('legislation_stats(trending_score)', { ascending: false })
      .limit(6)

    if (excludedIds.length > 0) {
      query.not('id', 'in', `(${excludedIds.join(',')})`)
    }

    const { data } = await query
    candidates = (data ?? []) as unknown as LegislationRow[]
  }

  // Step 3b — fill gaps from followed topics
  if (candidates.length < 6) {
    const { data: topicFollowRows } = await supabase
      .from('topic_follows')
      .select('topic_id')
      .eq('user_id', userId)

    followedTopicIds = (topicFollowRows ?? []).map((r) => r.topic_id)

    if (followedTopicIds.length > 0) {
      const needed = 6 - candidates.length
      const existingIds = [...excludedIds, ...candidates.map((c) => c.id)]

      const { data: topicLegIds } = await supabase
        .from('legislation_topics')
        .select('legislation_id')
        .in('topic_id', followedTopicIds)

      const topicLegislationIds = (topicLegIds ?? [])
        .map((r) => r.legislation_id)
        .filter((id) => !existingIds.includes(id))

      if (topicLegislationIds.length > 0) {
        const { data: topicBills } = await supabase
          .from('legislation')
          .select('id, slug, file_number, title, short_summary, status, type, intro_date, legislation_stats!inner(trending_score)')
          .eq('type', 'introduction')
          .in('id', topicLegislationIds)
          .order('legislation_stats(trending_score)', { ascending: false })
          .limit(needed)

        candidates = [...candidates, ...(topicBills ?? []) as unknown as LegislationRow[]]
      }
    }
  }

  // Step 4 — backfill with trending if still fewer than 6
  if (candidates.length < 6) {
    const needed = 6 - candidates.length
    const existingIds = [...excludedIds, ...candidates.map((c) => c.id)]

    const backfillQuery = supabase
      .from('legislation')
      .select('id, slug, file_number, title, short_summary, status, type, intro_date, legislation_stats!inner(trending_score)')
      .eq('type', 'introduction')
      .order('legislation_stats(trending_score)', { ascending: false })
      .limit(needed + existingIds.length)

    const { data: backfill } = await backfillQuery
    const filtered = (backfill ?? []).filter(
      (r) => !existingIds.includes(r.id)
    ).slice(0, needed)

    candidates = [...candidates, ...(filtered as unknown as LegislationRow[])]
  }

  return { candidates, hasEngagement: committeeIds.length > 0 || followedTopicIds.length > 0 }
}

export default async function HomePage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: recent },
    { data: trending },
    { data: profile },
  ] = await Promise.all([
    supabase
      .from('legislation')
      .select('id, slug, file_number, title, short_summary, status, type, intro_date, ai_summary')
      .eq('type', 'introduction')
      .order('intro_date', { ascending: false })
      .limit(5),
    supabase
      .from('legislation_stats')
      .select(`
        support_count, oppose_count, neutral_count, comment_count, trending_score,
        legislation!inner(id, slug, file_number, title, short_summary, status, type)
      `)
      .not('trending_score', 'is', null)
      .order('trending_score', { ascending: false })
      .limit(10),
    user
      ? supabase
          .from('user_profiles')
          .select('display_name, username, community_board, council_member:legislators(id, full_name, slug, district, borough, photo_url)')
          .eq('id', user.id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ])

  // Filter trending to introductions only
  const trendingIntroductions = (trending ?? []).filter((row) => {
    const leg = Array.isArray(row.legislation) ? row.legislation[0] : row.legislation
    return leg?.type === 'introduction'
  }).slice(0, 5)

  // Logged-in data
  let forYouItems: LegislationRow[] = []
  let forYouHasEngagement = false
  let feedItems: FeedItem[] = []
  let hasFollows = false

  if (user) {
    const [
      forYouResult,
      { data: legislatorFollowsData },
      { data: userFollowsData },
    ] = await Promise.all([
      getForYouLegislation(user.id, supabase),
      supabase.from('legislator_follows').select('legislator_id').eq('user_id', user.id),
      supabase.from('user_follows').select('following_id').eq('follower_id', user.id),
    ])

    forYouItems = forYouResult.candidates
    forYouHasEngagement = forYouResult.hasEngagement

    const followedLegislatorIds = (legislatorFollowsData ?? []).map((f) => f.legislator_id)
    const followedUserIds = (userFollowsData ?? []).map((f) => f.following_id)
    hasFollows = followedLegislatorIds.length > 0 || followedUserIds.length > 0

    type SponsorshipRow = { legislator_id: string; legislation: FeedItem | FeedItem[] | null }
    type StanceRow = { legislation: FeedItem | FeedItem[] | null }

    const [sponsorshipsResult, stancesResult] = await Promise.all([
      followedLegislatorIds.length > 0
        ? supabase
            .from('sponsorships')
            .select('legislator_id, legislation:legislation(id, slug, file_number, title, short_summary, status, type, intro_date)')
            .in('legislator_id', followedLegislatorIds)
            .order('legislation(intro_date)', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] as SponsorshipRow[], error: null }),
      followedUserIds.length > 0
        ? supabase
            .from('user_stances')
            .select('legislation:legislation(id, slug, file_number, title, status, type, intro_date)')
            .in('user_id', followedUserIds)
            .order('updated_at', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] as StanceRow[], error: null }),
    ])

    const seen = new Set<string>()
    const legislatorItems: FeedItem[] = ((sponsorshipsResult.data ?? []) as SponsorshipRow[]).flatMap((s) => {
      const leg = Array.isArray(s.legislation) ? s.legislation[0] : s.legislation
      if (!leg || seen.has(leg.id) || leg.type !== 'introduction') return []
      seen.add(leg.id)
      return [leg]
    })
    const stanceItems: FeedItem[] = ((stancesResult.data ?? []) as StanceRow[]).flatMap((s) => {
      const leg = Array.isArray(s.legislation) ? s.legislation[0] : s.legislation
      if (!leg || seen.has(leg.id) || leg.type !== 'introduction') return []
      seen.add(leg.id)
      return [leg]
    })
    feedItems = [...legislatorItems, ...stanceItems].slice(0, 6)
  }

  type CouncilMemberData = { id: string; full_name: string; slug: string; district: number; borough: string | null; photo_url: string | null }
  type ProfileData = { display_name: string | null; username: string | null; community_board: string | null; council_member: CouncilMemberData | CouncilMemberData[] | null }
  const profileData = (profile as { data: ProfileData | null } | null)?.data
  const rawCouncilMember = profileData?.council_member
  const councilMember = rawCouncilMember
    ? (Array.isArray(rawCouncilMember) ? rawCouncilMember[0] : rawCouncilMember) ?? null
    : null
  const firstName = profileData?.display_name
    ? profileData.display_name.trim().split(/\s+/)[0]
    : (profileData?.username ?? 'there')

  return (
    <main className="min-h-screen bg-nyc-bg">

      {user ? (
        /* ── Logged-in greeting ─────────────────────────────────────── */
        <section className="border-b border-nyc-border bg-nyc-blue px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <h1 className="text-xl font-black uppercase tracking-widest text-white">
              Welcome back, {firstName}
            </h1>
          </div>
        </section>
      ) : (
        /* ── Logged-out hero ────────────────────────────────────────── */
        <section className="border-b border-nyc-border bg-nyc-blue px-4 py-20 text-center sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl">
            <h1 className="text-4xl font-black uppercase tracking-tight text-white sm:text-5xl">
              NYC legislation,<br />
              <span className="text-nyc-orange">made accessible</span>
            </h1>
            <p className="mt-4 text-lg text-blue-200">
              Browse, understand, and engage with New York City Council bills and
              resolutions. Track what matters to your neighborhood.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/legislation"
                className="inline-flex items-center gap-2 rounded bg-nyc-orange px-6 py-3 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-nyc-orange-hover"
              >
                Browse Legislation <ArrowRight size={16} />
              </Link>
              <Link
                href="/council-members"
                className="inline-flex items-center gap-2 rounded border border-white/30 bg-white/10 px-6 py-3 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-white/20"
              >
                Council Members
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Council Member — display if saved ───────────────────── */}
      {user && councilMember && (
        <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
          <div className="max-w-xl">
            <div className="rounded border border-nyc-border bg-nyc-card p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-nyc-blue">
                <MapPin size={15} className="text-nyc-orange" />
                Your Council Member
              </h3>
              <div className="flex items-center gap-3">
                <MemberAvatar name={councilMember.full_name} photoUrl={councilMember.photo_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-nyc-blue">{councilMember.full_name}</p>
                  <p className="text-xs text-nyc-muted">
                    District {councilMember.district}
                    {councilMember.borough ? ` · ${councilMember.borough}` : ''}
                    {profileData?.community_board ? ` · ${profileData.community_board}` : ''}
                  </p>
                </div>
                <Link
                  href={`/council-members/${councilMember.slug}`}
                  className="shrink-0 rounded border border-nyc-blue/30 px-3 py-1.5 text-xs font-bold text-nyc-blue transition-colors hover:bg-nyc-blue hover:text-white"
                >
                  View profile →
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {user ? (
        <>
          {/* ── For You ───────────────────────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="mb-4 flex items-center gap-3">
              <Sparkles size={15} className="text-nyc-orange" />
              <h2 className="border-l-4 border-nyc-orange pl-3 text-xs font-black uppercase tracking-widest text-white">For You</h2>
            </div>
            {!forYouHasEngagement && (
              <p className="mb-4 text-sm text-nyc-muted">
                Follow topics or council members to get personalized recommendations.
              </p>
            )}
            {forYouItems.length === 0 ? (
              <div className="rounded border border-dashed border-nyc-border-light bg-nyc-card p-8 text-center">
                <p className="text-sm text-nyc-muted">No recommendations yet — browse legislation to get started.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {forYouItems.map((item) => (
                  <MiniCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>

          {/* ── New from people you follow ─────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
            <div className="mb-4 flex items-center gap-3">
              <Rss size={15} className="text-nyc-orange" />
              <h2 className="border-l-4 border-nyc-orange pl-3 text-xs font-black uppercase tracking-widest text-white">New from people you follow</h2>
            </div>
            {!hasFollows ? (
              <div className="rounded border border-dashed border-nyc-border-light bg-nyc-card p-8 text-center">
                <p className="text-sm text-nyc-muted">Follow council members to see their legislation here.</p>
                <div className="mt-3 flex items-center justify-center gap-4 text-sm">
                  <Link href="/council-members" className="font-bold text-nyc-orange hover:underline">Browse council members</Link>
                  <span className="text-nyc-border-light">·</span>
                  <Link href="/following" className="font-bold text-nyc-orange hover:underline">Manage following</Link>
                </div>
              </div>
            ) : feedItems.length === 0 ? (
              <div className="rounded border border-dashed border-nyc-border-light bg-nyc-card p-8 text-center">
                <p className="text-sm text-nyc-muted">No recent legislation from the people you follow.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {feedItems.map((item) => (
                  <MiniCard key={item.id} item={item} showDate />
                ))}
              </div>
            )}
          </section>

          {/* ── Trending (logged-in) ───────────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TrendingUp size={15} className="text-nyc-orange" />
                <h2 className="border-l-4 border-nyc-orange pl-3 text-xs font-black uppercase tracking-widest text-white">Trending</h2>
              </div>
              <Link href="/trending" className="text-xs font-bold text-nyc-orange hover:underline">
                View all →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {trendingIntroductions.map((row) => {
                const leg = Array.isArray(row.legislation) ? row.legislation[0] : row.legislation
                if (!leg) return null
                const commentCount = row.comment_count ?? 0
                return (
                  <Link
                    key={leg.id}
                    href={`/legislation/${leg.slug}`}
                    className="block rounded border border-nyc-border bg-nyc-card p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card-hover"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${getStatusStyle(leg.status)}`}>
                        {leg.status}
                      </span>
                      <span className="font-mono text-xs text-nyc-muted">{leg.file_number}</span>
                    </div>
                    <p className="line-clamp-2 text-sm font-semibold text-nyc-blue">{leg.short_summary ?? leg.title}</p>
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <span className="font-bold text-emerald-600">{row.support_count ?? 0} for</span>
                      <span className="font-bold text-red-600">{row.oppose_count ?? 0} against</span>
                      {commentCount > 0 && (
                        <span className="ml-auto font-bold text-nyc-orange">
                          {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
                        </span>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        </>
      ) : (
        <>
          {/* ── Find Your Council Member ─────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
            <div className="max-w-xl">
              <CouncilMemberLookup />
            </div>
          </section>

          {/* ── Trending (logged-out) ──────────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TrendingUp size={15} className="text-nyc-orange" />
                <h2 className="border-l-4 border-nyc-orange pl-3 text-xs font-black uppercase tracking-widest text-white">Trending</h2>
              </div>
              <Link href="/trending" className="text-xs font-bold text-nyc-orange hover:underline">
                View all →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {trendingIntroductions.map((row) => {
                const leg = Array.isArray(row.legislation) ? row.legislation[0] : row.legislation
                if (!leg) return null
                const commentCount = row.comment_count ?? 0
                return (
                  <Link
                    key={leg.id}
                    href={`/legislation/${leg.slug}`}
                    className="block rounded border border-nyc-border bg-nyc-card p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card-hover"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${getStatusStyle(leg.status)}`}>
                        {leg.status}
                      </span>
                      <span className="font-mono text-xs text-nyc-muted">{leg.file_number}</span>
                    </div>
                    <p className="line-clamp-2 text-sm font-semibold text-nyc-blue">{leg.short_summary ?? leg.title}</p>
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <span className="font-bold text-emerald-600">{row.support_count ?? 0} for</span>
                      <span className="font-bold text-red-600">{row.oppose_count ?? 0} against</span>
                      {commentCount > 0 && (
                        <span className="ml-auto font-bold text-nyc-orange">
                          {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
                        </span>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>

          {/* ── Sign-in CTA ───────────────────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
            <div className="rounded border-l-4 border-nyc-orange bg-nyc-blue/20 p-8 text-center">
              <p className="text-base font-semibold text-white">
                Join to follow legislation, track your council member, and connect with fellow New Yorkers.
              </p>
              <div className="mt-5 flex items-center justify-center gap-3">
                <Link
                  href="/login?mode=signup"
                  className="inline-flex items-center gap-2 rounded bg-nyc-orange px-5 py-2.5 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-nyc-orange-hover"
                >
                  Sign Up
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:border-white/50 hover:bg-white/20"
                >
                  Sign In
                </Link>
              </div>
            </div>
          </section>

          {/* ── Recently Introduced ───────────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="border-l-4 border-nyc-orange pl-3 text-xs font-black uppercase tracking-widest text-white">Recently Introduced</h2>
              <Link href="/legislation" className="text-xs font-bold text-nyc-orange hover:underline">
                View all →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(recent ?? []).map((item) => (
                <MiniCard key={item.id} item={item} showDate showSummary />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function MiniCard({
  item,
  showDate = false,
  showSummary = false,
}: {
  item: LegislationRow
  showDate?: boolean
  showSummary?: boolean
}) {
  const s = item.status?.toLowerCase() ?? ''
  const statusClass =
    s.includes('enact') || s.includes('adopt') || s.includes('pass')
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      : s.includes('veto') || s.includes('fail') || s.includes('withdrawn')
      ? 'bg-red-50 text-red-700 border border-red-200'
      : s.includes('hearing')
      ? 'bg-blue-50 text-nyc-blue border border-blue-200'
      : s.includes('committee')
      ? 'bg-orange-50 text-orange-700 border border-orange-200'
      : 'bg-slate-100 text-nyc-muted border border-nyc-border'

  return (
    <Link
      href={`/legislation/${item.slug}`}
      className="block rounded border border-nyc-border bg-nyc-card p-4 transition-colors hover:border-nyc-border-light hover:bg-nyc-card-hover"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${statusClass}`}>
          {item.status}
        </span>
        <span className="font-mono text-xs text-nyc-muted">{item.file_number}</span>
        {showDate && item.intro_date && (
          <span className="ml-auto text-xs text-nyc-muted">
            {format(new Date(item.intro_date), 'MMM d')}
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-sm font-semibold text-nyc-blue">{item.short_summary ?? item.title}</p>
      {showSummary && item.ai_summary && (
        <p className="mt-1.5 line-clamp-2 text-xs text-nyc-muted">{item.ai_summary}</p>
      )}
    </Link>
  )
}
