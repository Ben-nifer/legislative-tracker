import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, FileText, Clock } from 'lucide-react'
import { format } from 'date-fns'
import ProposalCommentThread from '@/components/neighborhood/comments/ProposalCommentThread'
import ProposalEngagementSection from '@/components/neighborhood/ProposalEngagementSection'
import type { ProposalStance } from '@/app/actions/proposal-engagement'

export const dynamic = 'force-dynamic'

type HistoryItem = {
  id: string
  milestone_date: string | null
  milestone_text: string | null
}

type ProposalDetail = {
  id: string
  slug: string
  title: string
  description: string | null
  ai_summary: string | null
  status: string
  proposal_family: 'ulurp' | 'dot'
  geometry_type: 'point' | 'line' | 'polygon'
  borough: string | null
  lead_agency: string | null
  source_url: string | null
  filed_date: string | null
  last_action_date: string | null
  history: HistoryItem[]
  stats: {
    support_count: number
    oppose_count: number
    neutral_count: number
    watching_count: number
    comment_count: number
    bookmark_count: number
  }
}

async function getProposal(slug: string): Promise<ProposalDetail | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
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
      borough,
      lead_agency,
      source_url,
      filed_date,
      last_action_date,
      stats:proposal_stats(
        support_count,
        oppose_count,
        neutral_count,
        watching_count,
        comment_count,
        bookmark_count
      )
    `)
    .eq('slug', slug)
    .single()

  if (error || !data) return null

  const { data: historyRows } = await supabase
    .from('local_proposal_history')
    .select('id, milestone_date, milestone_text')
    .eq('local_proposal_id', data.id)
    .order('created_at', { ascending: false })

  const statsRow = Array.isArray(data.stats) ? data.stats[0] : data.stats

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    description: data.description,
    ai_summary: data.ai_summary,
    status: data.status,
    proposal_family: data.proposal_family as 'ulurp' | 'dot',
    geometry_type: data.geometry_type as 'point' | 'line' | 'polygon',
    borough: data.borough,
    lead_agency: data.lead_agency,
    source_url: data.source_url,
    filed_date: data.filed_date,
    last_action_date: data.last_action_date,
    history: historyRows ?? [],
    stats: {
      support_count: statsRow?.support_count ?? 0,
      oppose_count: statsRow?.oppose_count ?? 0,
      neutral_count: statsRow?.neutral_count ?? 0,
      watching_count: statsRow?.watching_count ?? 0,
      comment_count: statsRow?.comment_count ?? 0,
      bookmark_count: statsRow?.bookmark_count ?? 0,
    },
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const proposal = await getProposal(slug)
  if (!proposal) return { title: 'Not Found' }
  return {
    title: `${proposal.title} | NYC Legislative Tracker`,
    description: proposal.ai_summary ?? proposal.description ?? proposal.title,
  }
}

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('approv') || s.includes('complet') || s.includes('adopt'))
    return { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border border-emerald-200' }
  if (s.includes('withdraw') || s.includes('disapprov') || s.includes('fail'))
    return { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', border: 'border border-red-200' }
  if (s.includes('certif') || s.includes('review') || s.includes('hearing'))
    return { bg: 'bg-blue-50', text: 'text-nyc-blue', dot: 'bg-blue-500', border: 'border border-blue-200' }
  if (s.includes('filed') || s.includes('design') || s.includes('construction'))
    return { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', border: 'border border-orange-200' }
  return { bg: 'bg-slate-50', text: 'text-nyc-muted', dot: 'bg-nyc-muted', border: 'border border-nyc-border' }
}

function fmt(dateStr: string | null) {
  if (!dateStr) return null
  return format(new Date(dateStr), 'MMM d, yyyy')
}

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const proposal = await getProposal(slug)
  if (!proposal) notFound()

  let userStance: ProposalStance | null = null
  let isFollowing = false

  if (user) {
    const [stanceResult, followResult] = await Promise.all([
      supabase
        .from('proposal_stances')
        .select('stance')
        .match({ user_id: user.id, local_proposal_id: proposal.id })
        .maybeSingle(),
      supabase
        .from('proposal_follows')
        .select('local_proposal_id')
        .match({ user_id: user.id, local_proposal_id: proposal.id })
        .maybeSingle(),
    ])
    userStance = (stanceResult.data?.stance as ProposalStance) ?? null
    isFollowing = !!followResult.data
  }

  const statusStyle = getStatusStyle(proposal.status)
  const summary = proposal.ai_summary?.trim() || proposal.description?.trim() || null

  return (
    <main className="min-h-screen bg-nyc-bg">
      <div className="border-b border-white/10 bg-nyc-blue px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/neighborhood"
            className="inline-flex items-center gap-1.5 text-sm text-blue-200 transition-colors hover:text-white"
          >
            <ArrowLeft size={14} /> Back to Neighborhood Map
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-4">
          {/* Header */}
          <section className="rounded border border-nyc-border bg-nyc-card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                {proposal.status}
              </span>
              <span className="rounded border border-nyc-border px-2.5 py-0.5 text-xs uppercase text-nyc-muted">
                {proposal.proposal_family === 'ulurp' ? 'ULURP' : 'DOT'}
              </span>
              {proposal.borough && (
                <span className="text-sm text-nyc-muted">{proposal.borough}</span>
              )}
            </div>

            <h1 className="text-2xl font-bold leading-snug text-nyc-blue sm:text-3xl">
              {proposal.title}
            </h1>

            {proposal.filed_date && (
              <p className="mt-2 text-sm text-nyc-muted">
                Filed {fmt(proposal.filed_date)}
                {proposal.lead_agency && <> · {proposal.lead_agency}</>}
              </p>
            )}
          </section>

          {/* Summary */}
          <section className="rounded border border-nyc-border bg-nyc-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
              <FileText size={14} /> Summary
            </h2>
            {summary ? (
              <>
                <p className="leading-relaxed text-nyc-blue">{summary}</p>
                {proposal.ai_summary && (
                  <p className="mt-2 text-xs text-nyc-muted/60">
                    AI-generated summary &mdash; may not reflect official language
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm italic text-nyc-muted">No summary available yet.</p>
            )}

            {proposal.source_url && (
              <div className="mt-4">
                <a
                  href={proposal.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded border border-nyc-border px-3 py-1.5 text-xs text-nyc-muted transition-colors hover:border-nyc-border-light hover:text-nyc-blue"
                >
                  <ExternalLink size={12} /> View Source
                </a>
              </div>
            )}
          </section>

          {/* History / next steps */}
          <section className="rounded border border-nyc-border bg-nyc-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
              <Clock size={14} /> History &amp; Next Steps
            </h2>
            {proposal.history.length === 0 ? (
              <p className="text-sm italic text-nyc-muted">No milestones recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {proposal.history.map((h) => (
                  <li key={h.id} className="flex gap-3 text-sm">
                    <span className="w-24 shrink-0 text-nyc-muted">{fmt(h.milestone_date) ?? '—'}</span>
                    <span className="text-nyc-blue">{h.milestone_text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Engagement */}
          <section className="rounded border border-nyc-border bg-nyc-card p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
              Public Engagement
            </h2>
            <ProposalEngagementSection
              proposalId={proposal.id}
              initialStats={proposal.stats}
              initialUserStance={userStance}
              initialWatching={isFollowing}
              isLoggedIn={!!user}
            />
          </section>

          {/* Comments */}
          <div className="rounded border border-nyc-border bg-nyc-card p-5">
            <ProposalCommentThread proposalId={proposal.id} />
          </div>
        </div>
      </div>
    </main>
  )
}
