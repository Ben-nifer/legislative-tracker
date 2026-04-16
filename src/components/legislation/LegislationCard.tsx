'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ThumbsUp, ThumbsDown, Minus, MessageSquare, Bell } from 'lucide-react'
import { followLegislation, unfollowLegislation } from '@/app/actions/social'

export type LegislationCardData = {
  id: string
  file_number: string
  slug: string
  title: string
  short_summary: string | null
  status: string
  type: 'resolution' | 'introduction' | string
  intro_date: string | null
  last_action_date: string | null
  last_action_text?: string | null
  ai_summary: string | null
  official_summary: string | null
  committee_name?: string | null
  stats: {
    support_count: number
    oppose_count: number
    neutral_count: number
    watching_count: number
    comment_count: number
    bookmark_count: number
  } | null
  primary_sponsor?: string | null
  primary_sponsor_slug?: string | null
}

function getCardTitle(item: LegislationCardData): string {
  if (item.short_summary) return item.short_summary
  if (item.ai_summary) {
    const words = item.ai_summary.trim().split(/\s+/)
    return words.slice(0, 10).join(' ') + (words.length > 10 ? '...' : '')
  }
  return item.title
}

function getStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return { bg: 'bg-emerald-500/20', text: 'text-emerald-300' }
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return { bg: 'bg-red-500/20', text: 'text-red-300' }
  if (s.includes('hearing'))
    return { bg: 'bg-blue-500/20', text: 'text-blue-300' }
  if (s.includes('committee'))
    return { bg: 'bg-amber-500/20', text: 'text-amber-300' }
  return { bg: 'bg-slate-500/20', text: 'text-slate-300' }
}

function StatPill({ icon, count, color, label }: {
  icon: React.ReactNode
  count: number
  color: string
  label: string
}) {
  return (
    <span className={`flex items-center gap-1 text-sm ${color}`} title={label}>
      {icon}
      <span className="tabular-nums">{count.toLocaleString()}</span>
    </span>
  )
}

export default function LegislationCard({
  legislation,
  initialFollowing = false,
}: {
  legislation: LegislationCardData
  initialFollowing?: boolean
}) {
  const [isFollowing, setIsFollowing] = useState(initialFollowing)

  const statusStyle = getStatusStyle(legislation.status)
  const stats = legislation.stats ?? {
    support_count: 0,
    oppose_count: 0,
    neutral_count: 0,
    watching_count: 0,
    comment_count: 0,
    bookmark_count: 0,
  }
  const cardTitle = getCardTitle(legislation)
  const summary = legislation.ai_summary ?? legislation.official_summary

  return (
    <Link
      href={`/legislation/${legislation.slug}`}
      className="group block rounded-xl border border-slate-700/60 bg-slate-800/80 backdrop-blur transition-colors hover:border-slate-600/80 p-4"
    >
      {/* Top row: status badge, file number, follow button */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
            {legislation.status}
          </span>
          <span className="font-mono text-xs text-slate-400">
            {legislation.file_number}
          </span>
        </div>
        <button
          onClick={async (e) => {
            e.stopPropagation()
            e.preventDefault()
            const prev = isFollowing
            setIsFollowing(!prev)
            const result = prev
              ? await unfollowLegislation(legislation.id)
              : await followLegislation(legislation.id)
            if (result.error) setIsFollowing(prev)
          }}
          aria-label={isFollowing ? 'Unfollow' : 'Follow'}
          className={[
            'group/btn shrink-0 flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-150',
            isFollowing
              ? 'border-blue-500/60 bg-blue-500/20 text-blue-300'
              : 'border-slate-600/60 text-slate-400 hover:border-slate-500 hover:bg-slate-700/40 hover:text-slate-300',
          ].join(' ')}
        >
          <Bell size={12} />
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

      {/* Title (short summary) */}
      <h3 className="mb-1.5 text-sm font-semibold leading-snug text-slate-100">
        {cardTitle}
      </h3>

      {/* Summary — clamped to 2 lines */}
      {summary ? (
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-slate-400">
          {summary}
        </p>
      ) : (
        <p className="mb-3 text-xs italic text-slate-600">No summary available</p>
      )}

      {/* Engagement stats */}
      <div className="flex flex-wrap items-center gap-3">
        <StatPill icon={<ThumbsUp size={13} />} count={stats.support_count} color="text-emerald-400" label="Support" />
        <StatPill icon={<ThumbsDown size={13} />} count={stats.oppose_count} color="text-red-400" label="Oppose" />
        <StatPill icon={<Minus size={13} />} count={stats.neutral_count} color="text-amber-400" label="Neutral" />
        <StatPill icon={<MessageSquare size={13} />} count={stats.comment_count} color="text-slate-400" label="Comments" />
      </div>
    </Link>
  )
}
