'use client'

import { useEffect, useState } from 'react'
import { searchPoliticians } from '@/app/actions/onboarding'
import type { RepresentativeCard } from '@/lib/onboarding/data/representatives'
import { ComingSoonPill } from '../WidgetSection'
import type { PoliticianInfo } from './types'
import { officeLine } from './format'

// S3 (spec §S3 v1.2, design export). Following someone adds their own section.
// Order is by level, never by party; party is a text label only.

interface ActiveRow {
  legislatorId: string
  fullName: string
  district: string | null
  title?: string | null
  photoUrl: string | null
  reason: string | null
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-11 w-11 flex-none rounded-full bg-[#E7E5DF] object-cover" />
  }
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('')
  return (
    <span aria-hidden="true" className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[#E7E5DF] text-xs font-semibold text-civic-muted">
      {initials}
    </span>
  )
}

function PersonCard({ info, followed, onToggle }: { info: PoliticianInfo; followed: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-civic-border bg-civic-surface p-3">
      <Avatar src={info.photoUrl} name={info.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{info.name}</span>
        <span className="text-[13px] text-civic-muted">{[info.office, info.party].filter(Boolean).join(' · ')}</span>
        {info.reason && <span className="text-xs font-semibold text-civic-badge-ink">{info.reason}</span>}
      </div>
      <button
        type="button"
        aria-pressed={followed}
        aria-label={`${followed ? 'Unfollow' : 'Follow'} ${info.name}`}
        onClick={onToggle}
        className={`h-10 min-w-[92px] flex-none rounded-full border-[1.5px] border-civic-accent text-sm font-semibold ${
          followed ? 'bg-civic-accent text-white' : 'bg-civic-surface text-civic-accent'
        }`}
      >
        {followed ? 'Following' : 'Follow'}
      </button>
    </div>
  )
}

const groupHeading = 'm-0 mt-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-civic-muted'

export default function StepPoliticians({
  reps,
  jurisdictionKeys,
  followedIds,
  known,
  isFollowed,
  toggle,
  remember,
}: {
  reps: RepresentativeCard[]
  jurisdictionKeys: string[]
  followedIds: string[]
  known: Record<string, PoliticianInfo>
  isFollowed: (id: string) => boolean
  toggle: (info: PoliticianInfo, source: 'suggested' | 'search') => void
  remember: (info: PoliticianInfo) => void
}) {
  const [active, setActive] = useState<ActiveRow[]>([])
  const [heading, setHeading] = useState('Active in New York City')
  const [hasMore, setHasMore] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PoliticianInfo[]>([])

  const repIds = reps.flatMap((r) => (r.legislator ? [r.legislator.id] : []))
  const jurParam = jurisdictionKeys.join(',')
  const excludeParam = repIds.join(',')

  // "Active in your jurisdictions" (recommendations plan §6.7), own reps excluded
  useEffect(() => {
    const params = new URLSearchParams()
    if (jurParam) params.set('jurisdictions', jurParam)
    if (excludeParam) params.set('exclude', excludeParam)
    if (expanded) params.set('limit', '24')
    let cancelled = false
    fetch(`/api/politicians/active?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return
        setActive(json.politicians ?? [])
        setHeading(json.heading ?? 'Active in New York City')
        setHasMore(!!json.hasMore)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [jurParam, excludeParam, expanded])

  useEffect(() => {
    if (query.trim().length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const found = await searchPoliticians(query).catch(() => [])
      if (!cancelled) {
        setResults(found.map((f) => ({ id: f.id, name: f.fullName, office: officeLine(f.title, f.district), party: f.party, photoUrl: f.photoUrl })))
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const activeInfos: PoliticianInfo[] = active.map((a) => ({
    id: a.legislatorId,
    name: a.fullName,
    office: officeLine(a.title, a.district),
    party: null,
    photoUrl: a.photoUrl,
    reason: a.reason,
  }))
  const shown = new Set([...repIds, ...activeInfos.map((a) => a.id)])
  // Follows that aren't in either list (picked via search, or saved earlier)
  const otherFollows = followedIds.filter((id) => !shown.has(id) && known[id]).map((id) => known[id])

  const liveReps = reps.filter((r) => !r.comingSoon && r.legislator)
  const soonReps = reps.filter((r) => r.comingSoon)

  return (
    <div className="flex flex-col gap-3.5">
      <h1 tabIndex={-1} data-step-heading className="m-0 font-display text-[28px] leading-[1.15] outline-none lg:text-4xl lg:leading-[1.1]">
        Who do you want to follow?
      </h1>
      <p className="m-0 text-[15px] text-civic-muted lg:text-base">Each person you follow adds their own section to your feed.</p>

      {reps.length > 0 && (
        <>
          <h2 className={groupHeading}>Your representatives</h2>
          {liveReps.map((r) => {
            const info: PoliticianInfo = {
              id: r.legislator!.id,
              name: r.legislator!.fullName,
              office: `${r.office} · ${r.districtLabel ?? ''}`.replace(/ · $/, ''),
              party: r.legislator!.party,
              photoUrl: r.legislator!.photoUrl,
            }
            return <PersonCard key={info.id} info={info} followed={isFollowed(info.id)} onToggle={() => toggle(info, 'suggested')} />
          })}
          {soonReps.map((r, i) => (
            <div key={`${r.office}-${i}`} className="flex items-center gap-3 rounded-[14px] border border-dashed border-civic-dash bg-civic-sunken p-3">
              <span aria-hidden="true" className="h-11 w-11 flex-none rounded-full bg-[#E7E5DF]" />
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-civic-muted">{r.office}</span>
                {r.districtLabel && <span className="text-[13px] text-civic-muted">{r.districtLabel}</span>}
              </div>
              <span className="flex-none"><ComingSoonPill /></span>
            </div>
          ))}
        </>
      )}

      {otherFollows.length > 0 && (
        <>
          <h2 className={groupHeading}>You follow</h2>
          {otherFollows.map((info) => (
            <PersonCard key={info.id} info={info} followed={isFollowed(info.id)} onToggle={() => toggle(info, 'search')} />
          ))}
        </>
      )}

      <h2 className={groupHeading}>{heading}</h2>
      {activeInfos.map((info) => (
        <PersonCard key={info.id} info={info} followed={isFollowed(info.id)} onToggle={() => toggle(info, 'suggested')} />
      ))}
      {hasMore && !expanded && (
        <button type="button" onClick={() => setExpanded(true)} className="min-h-11 self-start font-semibold text-civic-accent">
          See more
        </button>
      )}

      {searching ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="onb-pol" className="text-sm font-semibold">Find someone else</label>
          <input
            id="onb-pol"
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="h-12 rounded-xl border border-civic-dash bg-civic-surface px-3.5 text-base"
          />
          {(query.trim().length < 2 ? [] : results).map((info) => (
            <PersonCard
              key={info.id}
              info={info}
              followed={isFollowed(info.id)}
              onToggle={() => {
                remember(info)
                toggle(info, 'search')
              }}
            />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="flex min-h-12 items-center gap-2.5 self-start rounded-xl border border-dashed border-[#A9A59A] px-3.5 text-[15px] font-medium"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          Find someone else
        </button>
      )}
    </div>
  )
}
