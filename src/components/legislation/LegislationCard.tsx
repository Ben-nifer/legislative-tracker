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

function isValidSummary(text: string | null | undefined): boolean {
  if (!text || text.trim().length < 20) return false
  if (/^\d+$/.test(text.trim())) return false
  return true
}

function getCardTitle(item: LegislationCardData): string {
  if (item.short_summary && isValidSummary(item.short_summary)) return item.short_summary
  if (isValidSummary(item.ai_summary)) {
    const words = item.ai_summary!.trim().split(/\s+/)
    return words.slice(0, 10).join(' ') + (words.length > 10 ? '...' : '')
  }
  return item.title
}

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
  const summary = isValidSummary(legislation.ai_summary)
    ? legislation.ai_summary
    : isValidSummary(legislation.official_summary)
    ? legislation.official_summary
    : null

  return (
    <Link
      href={`/legislation/${legislation.slug}`}
      className="group block rounded-xl border border-nyc-border bg-nyc-card backdrop-blur transition-all hover:border-nyc-border-light hover:bg-nyc-card-hover p-4"
    >
      {/* Orange left accent bar — tabloid rule line */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${statusStyle}`}>
            {legislation.status}
          </span>
          <span className="font-mono text-xs text-nyc-muted">
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

      {/* Title */}
      <h3 className="mb-1.5 text-sm font-bold leading-snug text-nyc-blue group-hover:text-nyc-orange transition-colors">
        {cardTitle}
      </h3>

      {/* Summary */}
      {summary ? (
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-nyc-muted">
          {summary}
        </p>
      ) : (
        <p className="mb-3 text-xs italic text-nyc-muted/50">No summary available</p>
      )}

      {/* Divider */}
      <div className="mb-3 border-t border-nyc-border" />

      {/* Engagement stats */}
      <div className="flex flex-wrap items-center gap-3">
        <StatPill icon={<ThumbsUp size={12} />} count={stats.support_count} color="text-emerald-600" label="Support" />
        <StatPill icon={<ThumbsDown size={12} />} count={stats.oppose_count} color="text-red-600" label="Oppose" />
        <StatPill icon={<Minus size={12} />} count={stats.neutral_count} color="text-amber-600" label="Neutral" />
        <StatPill icon={<MessageSquare size={12} />} count={stats.comment_count} color="text-nyc-muted" label="Comments" />
      </div>
    </Link>
  )
}
