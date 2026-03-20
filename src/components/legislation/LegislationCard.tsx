'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ThumbsUp,
  ThumbsDown,
  Minus,
  MessageSquare,
  Bookmark,
  ChevronDown,
  ExternalLink,
  Calendar,
  Building2,
  User,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toggleBookmark } from '@/app/actions/engagement'

export type LegislationCardData = {
  id: string
  file_number: string
  slug: string
  title: string
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

type StatusStyle = { bg: string; text: string; label: string }

function getStatusStyle(status: string): StatusStyle {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return { bg: 'bg-emerald-500/20', text: 'text-emerald-300', label: status }
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return { bg: 'bg-red-500/20', text: 'text-red-300', label: status }
  if (s.includes('hearing'))
    return { bg: 'bg-blue-500/20', text: 'text-blue-300', label: status }
  if (s.includes('committee'))
    return { bg: 'bg-amber-500/20', text: 'text-amber-300', label: status }
  return { bg: 'bg-slate-500/20', text: 'text-slate-300', label: status }
}

function StatPill({
  icon,
  count,
  color,
  label,
}: {
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
  initialBookmarked = false,
}: {
  legislation: LegislationCardData
  initialBookmarked?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [bookmarked, setBookmarked] = useState(initialBookmarked)

  const statusStyle = getStatusStyle(legislation.status)
  const stats = legislation.stats ?? {
    support_count: 0,
    oppose_count: 0,
    neutral_count: 0,
    watching_count: 0,
    comment_count: 0,
    bookmark_count: 0,
  }
  const summary = legislation.ai_summary ?? legislation.official_summary

  const introDate = legislation.intro_date
    ? new Date(legislation.intro_date)
    : null
  const lastActionDate = legislation.last_action_date
    ? new Date(legislation.last_action_date)
    : null

  return (
    <div
      className="group rounded-xl border border-slate-700/60 bg-slate-800/80 backdrop-blur transition-colors hover:border-slate-600/80"
    >
      {/* Card body — clickable to expand */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((e) => !e)}
        onKeyDown={(e) => e.key === 'Enter' && setIsExpanded((v) => !v)}
        className="cursor-pointer p-4 select-none"
      >
        {/* Top row: status badge, file number, chevron + bookmark */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
            >
              {statusStyle.label}
            </span>
            <span className="font-mono text-xs text-slate-400">
              {legislation.file_number}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ChevronDown
              size={15}
              className={`text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
            />
            <button
              onClick={async (e) => {
                e.stopPropagation()
                setBookmarked((b) => !b)
                await toggleBookmark(legislation.id)
              }}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
              className={`rounded-md p-1.5 transition-colors ${
                bookmarked
                  ? 'text-indigo-400 hover:text-indigo-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Bookmark
                size={16}
                className={bookmarked ? 'fill-indigo-400' : ''}
              />
            </button>
          </div>
        </div>

        {/* Title */}
        <h3
          className="mb-2 line-clamp-2 text-sm font-semibold leading-snug text-slate-100"
          title={legislation.title}
        >
          {legislation.title}
        </h3>

        {/* Summary */}
        {summary ? (
          <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-slate-400">
            {summary}
          </p>
        ) : (
          <p className="mb-3 text-xs italic text-slate-600">
            No summary available
          </p>
        )}

        {/* Engagement stats */}
        <div className="flex flex-wrap items-center gap-3">
          <StatPill
            icon={<ThumbsUp size={13} />}
            count={stats.support_count}
            color="text-emerald-400"
            label="Support"
          />
          <StatPill
            icon={<ThumbsDown size={13} />}
            count={stats.oppose_count}
            color="text-red-400"
            label="Oppose"
          />
          <StatPill
            icon={<Minus size={13} />}
            count={stats.neutral_count}
            color="text-amber-400"
            label="Neutral"
          />
          <StatPill
            icon={<MessageSquare size={13} />}
            count={stats.comment_count}
            color="text-slate-400"
            label="Comments"
          />
          <StatPill
            icon={<Bookmark size={13} />}
            count={stats.bookmark_count}
            color="text-slate-400"
            label="Saves"
          />
        </div>
      </div>

      {/* Level 2 — animated expand using CSS grid trick */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-700/60 px-4 py-3">
            <dl className="space-y-2 text-xs">
              {legislation.committee_name && (
                <div className="flex items-start gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1 text-slate-500">
                    <Building2 size={12} /> Committee
                  </dt>
                  <dd className="text-slate-300">{legislation.committee_name}</dd>
                </div>
              )}
              {legislation.primary_sponsor && (
                <div className="flex items-start gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1 text-slate-500">
                    <User size={12} /> Sponsor
                  </dt>
                  <dd>
                    {legislation.primary_sponsor_slug ? (
                      <Link
                        href={`/council-members/${legislation.primary_sponsor_slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-indigo-400 hover:underline"
                      >
                        {legislation.primary_sponsor}
                      </Link>
                    ) : (
                      <span className="text-slate-300">
                        {legislation.primary_sponsor}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {introDate && (
                <div className="flex items-start gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1 text-slate-500">
                    <Calendar size={12} /> Introduced
                  </dt>
                  <dd className="text-slate-300">
                    {introDate.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </dd>
                </div>
              )}
              {lastActionDate && (
                <div className="flex items-start gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1 text-slate-500">
                    <Calendar size={12} /> Last Action
                  </dt>
                  <dd className="text-slate-300">
                    {lastActionDate.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    {legislation.last_action_text && (
                      <span className="ml-1 text-slate-500">
                        &mdash; {legislation.last_action_text}
                      </span>
                    )}
                    <span className="ml-1 text-slate-600">
                      ({formatDistanceToNow(lastActionDate, { addSuffix: true })})
                    </span>
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-3 flex justify-end">
              <Link
                href={`/legislation/${legislation.slug}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-md bg-indigo-600/80 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
              >
                View Details <ExternalLink size={12} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
