'use client'

import { useEffect, useState } from 'react'
import { searchNeighborhoods } from '@/app/actions/onboarding'
import type { NeighborhoodMatch } from '@/lib/onboarding/data/neighborhoods'
import type { Coverage } from '@/lib/onboarding/data/coverage'
import ToggleCard from './ToggleCard'

// S2 (spec §S2 v1.2, design export). Each pick adds a section. Nothing starts
// selected; "Select all of mine" picks live levels only.

const BOROUGHS: Record<string, string> = { MN: 'Manhattan', BX: 'Bronx', BK: 'Brooklyn', QN: 'Queens', SI: 'Staten Island' }

export interface JurisdictionsProps {
  coverage: Coverage
  districts: { council: string | null; senate: string | null; assembly: string | null; congressional: string | null; nta: string | null }
  placeNames: Record<string, string>
  isSelected: (type: string, id: string) => boolean
  toggle: (type: string, id: string, source: 'suggested' | 'search') => void
  selectAllMine: () => void
  extraNeighborhoods: string[] // NTA codes picked via search
  onNeighborhoodFound: (m: NeighborhoodMatch) => void
}

export default function StepJurisdictions(p: JurisdictionsProps) {
  const resolved = !!p.districts.council
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NeighborhoodMatch[]>([])

  useEffect(() => {
    if (query.trim().length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const found = await searchNeighborhoods(query).catch(() => [])
      if (!cancelled) setResults(found)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const { council, senate, assembly, congressional, nta } = p.districts
  const ownHood = nta ? p.placeNames[nta] ?? null : null

  return (
    <div className="flex flex-col gap-3.5 lg:gap-4">
      <h1 tabIndex={-1} data-step-heading className="m-0 font-display text-[28px] leading-[1.15] outline-none lg:text-4xl lg:leading-[1.1]">
        What do you want to keep up with?
      </h1>
      <p className="m-0 text-[15px] text-civic-muted lg:text-base">
        Pick any. Each one adds a section to your feed.
        {resolved && (
          <button type="button" onClick={p.selectAllMine} className="ml-1.5 min-h-11 font-semibold text-civic-accent lg:min-h-0">
            Select all of mine
          </button>
        )}
      </p>

      <ToggleCard
        label="Federal"
        sub={resolved ? `U.S. Congress · ${congressional ? `NY-${congressional} and ` : ''}both U.S. Senators` : 'U.S. Congress'}
        yours={resolved}
        selected={p.isSelected('federal', 'us')}
        comingSoon={!p.coverage.federal}
        onToggle={() => p.toggle('federal', 'us', 'suggested')}
      />
      <ToggleCard
        label="New York State"
        sub={resolved && (senate || assembly) ? [senate && `Senate District ${senate}`, assembly && `Assembly District ${assembly}`].filter(Boolean).join(' · ') : 'NY State Legislature'}
        yours={resolved}
        selected={p.isSelected('state', 'NY')}
        comingSoon={!p.coverage.state}
        onToggle={() => p.toggle('state', 'NY', 'suggested')}
      />
      <ToggleCard
        label="New York City"
        sub={resolved ? `Council District ${council} · Mayor` : 'NYC Council and Mayor'}
        yours={resolved}
        selected={p.isSelected('city', 'nyc')}
        comingSoon={!p.coverage.city}
        onToggle={() => p.toggle('city', 'nyc', 'suggested')}
      />
      {nta && ownHood && (
        <ToggleCard
          label={ownHood}
          sub="Projects, agency notices, budget items"
          yours
          selected={p.isSelected('neighborhood', nta)}
          comingSoon={!p.coverage.neighborhood}
          onToggle={() => p.toggle('neighborhood', nta, 'suggested')}
        />
      )}
      {p.extraNeighborhoods
        .filter((code) => code !== nta)
        .map((code) => (
          <ToggleCard
            key={code}
            label={p.placeNames[code] ?? code}
            sub={`${BOROUGHS[code.slice(0, 2)] ?? ''} · Projects, agency notices, budget items`}
            yours={false}
            selected={p.isSelected('neighborhood', code)}
            comingSoon={!p.coverage.neighborhood}
            onToggle={() => p.toggle('neighborhood', code, 'search')}
          />
        ))}

      {p.coverage.neighborhood &&
        (searching ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="onb-hood" className="text-sm font-semibold">Add another neighborhood</label>
            <input
              id="onb-hood"
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. DUMBO, Astoria"
              className="h-12 rounded-xl border border-civic-dash bg-civic-surface px-3.5 text-base"
            />
            {query.trim().length >= 2 && results.length > 0 && (
              <ul className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-civic-border bg-civic-surface p-0">
                {results.map((r) => (
                  <li key={r.ntaCode}>
                    <button
                      type="button"
                      onClick={() => {
                        p.onNeighborhoodFound(r)
                        if (!p.isSelected('neighborhood', r.ntaCode)) p.toggle('neighborhood', r.ntaCode, 'search')
                        setQuery('')
                        setSearching(false)
                      }}
                      className="flex w-full flex-col items-start gap-0.5 border-b border-civic-divider px-3.5 py-3 text-left last:border-b-0 hover:bg-civic-bg"
                    >
                      <span className="text-[15px] font-semibold">{r.name}</span>
                      <span className="text-xs text-civic-muted">
                        {BOROUGHS[r.borough] ?? r.borough}
                        {r.matched ? ` · matches “${r.matched}”` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="flex min-h-12 items-center gap-2.5 self-start rounded-xl border border-dashed border-[#A9A59A] px-3.5 text-[15px] font-medium text-civic-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            Add another neighborhood
          </button>
        ))}
    </div>
  )
}
