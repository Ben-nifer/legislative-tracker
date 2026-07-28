'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { User, Clock, ChevronDown } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

type Sponsor = {
  full_name: string
  slug: string
  district: number | null
  is_primary: boolean
}

type HistoryItem = {
  id: string
  action_date: string | null
  action_text: string | null
  action_body_name: string | null
  passed_flag: boolean | null
}

type Hearing = {
  id: string
  event_date: string | null
  event_type: string | null
  location: string | null
  video_url: string | null
}

interface Props {
  sponsors: Sponsor[]
  upcomingHearings: Hearing[]
  history: HistoryItem[]
}

const COLLAPSED_PX = 220

function fmt(dateStr: string | null) {
  if (!dateStr) return null
  return format(new Date(dateStr), 'MMM d, yyyy')
}

export default function SponsorActivityPanel({ sponsors, upcomingHearings, history }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [contentHeight, setContentHeight] = useState(COLLAPSED_PX)

  const sponsorsBodyRef = useRef<HTMLDivElement>(null)
  const activityBodyRef = useRef<HTMLDivElement>(null)

  const hasActivity = upcomingHearings.length > 0 || history.length > 0

  // Heuristic: sponsors list overflows if >5 items; activity overflows if >3 (items are taller)
  const sponsorsOverflows = sponsors.length > 5
  const activityOverflows = upcomingHearings.length + history.length > 3

  function handleToggle(panel: 'sponsors' | 'activity') {
    if (expanded) {
      setExpanded(false)
      setContentHeight(COLLAPSED_PX)
    } else {
      const ref = panel === 'sponsors' ? sponsorsBodyRef : activityBodyRef
      const natural = ref.current?.scrollHeight ?? COLLAPSED_PX
      setContentHeight(Math.max(natural, COLLAPSED_PX))
      setExpanded(true)
    }
  }

  const primarySponsor = sponsors.find((s) => s.is_primary)
  const coSponsors = sponsors.filter((s) => !s.is_primary)

  const showSponsorChevron = sponsorsOverflows || expanded
  const showActivityChevron = activityOverflows || expanded

  return (
    <div className="grid gap-4 sm:grid-cols-2">

      {/* ── Sponsors ── */}
      <section className="rounded border border-nyc-border bg-nyc-card p-5">
        <button
          onClick={() => handleToggle('sponsors')}
          className="mb-3 flex w-full items-center justify-between text-left"
          type="button"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
            <User size={14} /> Sponsors
            {sponsors.length > 0 && (
              <span className="font-normal normal-case text-nyc-muted/50">({sponsors.length})</span>
            )}
          </h2>
          {showSponsorChevron && (
            <ChevronDown
              size={14}
              className={`shrink-0 text-nyc-muted transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
            />
          )}
        </button>

        <div
          ref={sponsorsBodyRef}
          style={{ height: contentHeight, transition: 'height 0.3s ease' }}
          className="overflow-hidden"
        >
          {sponsors.length === 0 ? (
            <p className="text-sm italic text-nyc-muted">No sponsors listed.</p>
          ) : (
            <ul className="space-y-2">
              {primarySponsor && (
                <li className="flex items-center justify-between gap-2">
                  <Link
                    href={`/council-members/${primarySponsor.slug}`}
                    className="text-sm font-medium text-nyc-orange hover:underline"
                  >
                    {primarySponsor.full_name}
                  </Link>
                  <span className="shrink-0 rounded border border-nyc-orange/30 bg-nyc-orange/10 px-2 py-0.5 text-xs text-nyc-orange">
                    Primary
                  </span>
                </li>
              )}
              {coSponsors.map((s) => (
                <li key={s.slug} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/council-members/${s.slug}`}
                    className="text-sm text-nyc-blue hover:text-nyc-orange hover:underline"
                  >
                    {s.full_name}
                  </Link>
                  {s.district && (
                    <span className="shrink-0 text-xs text-nyc-muted">Dist. {s.district}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Activity ── */}
      <section className="rounded border border-nyc-border bg-nyc-card p-5">
        <button
          onClick={() => handleToggle('activity')}
          className="mb-4 flex w-full items-center justify-between text-left"
          type="button"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-nyc-muted">
            <Clock size={14} /> Activity
          </h2>
          {showActivityChevron && (
            <ChevronDown
              size={14}
              className={`shrink-0 text-nyc-muted transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
            />
          )}
        </button>

        <div
          ref={activityBodyRef}
          style={{ height: contentHeight, transition: 'height 0.3s ease' }}
          className="overflow-hidden"
        >
          {!hasActivity ? (
            <p className="text-sm italic text-nyc-muted">No activity recorded.</p>
          ) : (
            <ol className="relative border-l border-nyc-border pl-5 space-y-4">
              {upcomingHearings.map((hearing) => (
                <li key={hearing.id} className="relative">
                  <span className="absolute -left-[21px] h-3 w-3 rounded-full border-2 border-nyc-card bg-blue-500" />
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-xs font-medium text-blue-600">
                      Upcoming
                    </span>
                    <p className="text-sm font-medium text-nyc-blue">
                      {hearing.event_type ?? 'Hearing'}
                    </p>
                  </div>
                  {hearing.event_date && (
                    <p className="mt-0.5 text-xs text-nyc-muted">
                      {format(new Date(hearing.event_date), 'EEEE, MMM d, yyyy · h:mm a')}
                      <span className="ml-1.5 text-nyc-muted/60">
                        · {formatDistanceToNow(new Date(hearing.event_date), { addSuffix: true })}
                      </span>
                    </p>
                  )}
                  {hearing.location && (
                    <p className="mt-0.5 text-xs text-nyc-muted">{hearing.location}</p>
                  )}
                </li>
              ))}
              {history.map((item, i) => {
                const dotColor =
                  item.passed_flag === true
                    ? 'bg-emerald-500'
                    : item.passed_flag === false
                    ? 'bg-red-500'
                    : i === 0 && upcomingHearings.length === 0
                    ? 'bg-nyc-orange'
                    : 'bg-nyc-muted/40'
                return (
                  <li key={item.id} className="relative">
                    <span
                      className={`absolute -left-[21px] h-3 w-3 rounded-full border-2 border-nyc-card ${dotColor}`}
                    />
                    <p className="text-sm text-nyc-blue">
                      {item.action_text ?? 'Action recorded'}
                    </p>
                    {item.action_body_name && (
                      <p className="mt-0.5 text-xs text-nyc-muted">{item.action_body_name}</p>
                    )}
                    {item.action_date && (
                      <p className="mt-0.5 text-xs text-nyc-muted/60">
                        {fmt(item.action_date)}
                        <span className="ml-1.5">
                          · {formatDistanceToNow(new Date(item.action_date), { addSuffix: true })}
                        </span>
                      </p>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </section>

    </div>
  )
}
