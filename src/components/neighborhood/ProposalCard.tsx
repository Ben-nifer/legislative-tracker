'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ThumbsUp, ThumbsDown, Minus, MessageSquare, Bell, MapPin, Route, Hexagon } from 'lucide-react'
import { followProposal, unfollowProposal } from '@/app/actions/proposal-engagement'

export type ProposalCardData = {
  id: string
  slug: string
  title: string
  description: string | null
  ai_summary: string | null
  status: string
  proposal_family: 'ulurp' | 'dot'
  geometry_type: 'point' | 'line' | 'polygon'
  last_action_date: string | null
  stats: {
    support_count: number
    oppose_count: number
    neutral_count: number
    watching_count: number
    comment_count: number
    bookmark_count: number
  } | null
}

const GEOMETRY_ICON = {
  point: <MapPin size={11} />,
  line: <Route size={11} />,
  polygon: <Hexagon size={11} />,
}

const FAMILY_LABEL = {
  ulurp: 'ULURP',
  dot: 'DOT',
}

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('approv') || s.includes('complet') || s.includes('adopt'))
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  if (s.includes('withdraw') || s.includes('disapprov') || s.includes('fail'))
    return 'bg-red-50 text-red-700 border border-red-200'
  if (s.includes('certif') || s.includes('review') || s.includes('hearing'))
    return 'bg-blue-50 text-nyc-blue border border-blue-200'
  if (s.includes('filed') || s.includes('design') || s.includes('construction'))
    return 'bg-orange-50 text-orange-700 border border-orange-200'
  return 'bg-slate-100 text-nyc-muted border border-nyc-border'
}

function StatPill({ icon, count, color, label }: {
  icon: React.ReactNode
  count: number
  color: string
  label: string
}) {
  return (
    <span className={`flex items-center gap-1 text-sm font-bold tabular-nums ${color}`} title={label}>
      {icon}
      {count.toLocaleString()}
    </span>
  )
}

export default function ProposalCard({
  proposal,
  initialFollowing = false,
}: {
  proposal: ProposalCardData
  initialFollowing?: boolean
}) {
  const [isFollowing, setIsFollowing] = useState(initialFollowing)

  const statusStyle = getStatusStyle(proposal.status)
  const stats = proposal.stats ?? {
    support_count: 0,
    oppose_count: 0,
    neutral_count: 0,
    watching_count: 0,
    comment_count: 0,
    bookmark_count: 0,
  }
  const summary = proposal.ai_summary?.trim() || proposal.description?.trim() || null

  return (
    <Link
      href={`/proposals/${proposal.slug}`}
      className="group block rounded-xl border border-nyc-border bg-nyc-card backdrop-blur transition-all hover:border-nyc-border-light hover:bg-nyc-card-hover p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${statusStyle}`}>
            {proposal.status}
          </span>
          <span className="flex items-center gap-1 rounded border border-nyc-border px-1.5 py-0.5 text-xs font-mono text-nyc-muted">
            {GEOMETRY_ICON[proposal.geometry_type]}
            {FAMILY_LABEL[proposal.proposal_family]}
          </span>
        </div>
        <button
          onClick={async (e) => {
            e.stopPropagation()
            e.preventDefault()
            const prev = isFollowing
            setIsFollowing(!prev)
            const result = prev
              ? await unfollowProposal(proposal.id)
              : await followProposal(proposal.id)
            if (result.error) setIsFollowing(prev)
          }}
          aria-label={isFollowing ? 'Unfollow' : 'Follow'}
          className={[
            'group/btn shrink-0 flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-bold uppercase tracking-wide transition-all duration-150',
            isFollowing
              ? 'border-nyc-orange/60 bg-nyc-orange/15 text-nyc-orange'
              : 'border-nyc-border-light text-nyc-muted hover:border-nyc-orange/40 hover:text-nyc-orange',
          ].join(' ')}
        >
          <Bell size={11} />
          {isFollowing ? (
            <>
              <span className="group-hover/btn:hidden">Following</span>
              <span className="hidden group-hover/btn:inline">Unfollow</span>
            </>
          ) : (
            <span>Follow</span>
          )}
        </button>
      </div>

      <h3 className="mb-1.5 text-sm font-bold leading-snug text-nyc-blue group-hover:text-nyc-orange transition-colors">
        {proposal.title}
      </h3>

      {summary ? (
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-nyc-muted">
          {summary}
        </p>
      ) : (
        <p className="mb-3 text-xs italic text-nyc-muted/50">No summary available</p>
      )}

      <div className="mb-3 border-t border-nyc-border" />

      <div className="flex flex-wrap items-center gap-3">
        <StatPill icon={<ThumbsUp size={12} />} count={stats.support_count} color="text-emerald-600" label="Support" />
        <StatPill icon={<ThumbsDown size={12} />} count={stats.oppose_count} color="text-red-600" label="Oppose" />
        <StatPill icon={<Minus size={12} />} count={stats.neutral_count} color="text-amber-600" label="Neutral" />
        <StatPill icon={<MessageSquare size={12} />} count={stats.comment_count} color="text-nyc-muted" label="Comments" />
      </div>
    </Link>
  )
}
