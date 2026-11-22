'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { resolveAddress } from '@/app/actions/onboarding'
import type { AddressResolution } from '@/lib/onboarding/data/address'
import { track } from '@/lib/analytics/track'

// S1 (spec §S1, build plan §4.1). Type-ahead from NYC GeoSearch; on pick or
// submit, resolveAddress → district IDs. The address is cleared from state as
// soon as it resolves: only IDs are kept. GeoSearch only knows NYC, so users can
// always submit exactly what they typed instead of a suggestion.

const STREETEASY_URL = 'https://streeteasy.com/'

type Problem = 'not_found' | 'unavailable' | 'rate_limited' | null

export default function StepAddress({
  resolvedLabel,
  resolvedSub,
  onResolved,
  onEdit,
  onSkip,
}: {
  resolvedLabel: string | null
  resolvedSub: string | null
  onResolved: (result: Extract<AddressResolution, { status: 'ok' }>) => void
  onEdit: () => void
  onSkip: () => void
}) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem>(null)
  const listId = useId()
  const visible = text.trim().length < 3 ? [] : suggestions
  const skipSuggest = useRef(false)

  // Debounced GeoSearch autocomplete
  useEffect(() => {
    if (skipSuggest.current) {
      skipSuggest.current = false
      return
    }
    const q = text.trim()
    if (q.length < 3) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://geosearch.planninglabs.nyc/v2/autocomplete?text=${encodeURIComponent(q)}`, { signal: controller.signal })
        const json = await res.json()
        const labels: string[] = (json.features ?? []).map((f: { properties?: { label?: string } }) => f.properties?.label).filter(Boolean)
        setSuggestions([...new Set(labels)].slice(0, 5))
        setActive(-1)
      } catch {
        // Autocomplete is a convenience; typing and submitting still works
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [text])

  async function submit(value: string) {
    const address = value.trim()
    if (!address || busy) return
    setBusy(true)
    setProblem(null)
    setSuggestions([])
    const result = await resolveAddress(address).catch(() => ({ status: 'unavailable' as const }))
    setBusy(false)
    if (result.status === 'ok') {
      setText('') // discard the address
      track('onb_address_result', { result: 'success' })
      onResolved(result)
      return
    }
    if (result.status === 'rate_limited') {
      setProblem('rate_limited')
      return
    }
    track('onb_address_result', { result: result.status === 'not_found' ? 'failed' : 'unavailable' })
    setProblem(result.status)
  }

  function pick(label: string) {
    skipSuggest.current = true
    setText(label)
    submit(label)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, visible.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, -1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(visible[active])
    } else if (e.key === 'Escape') {
      setSuggestions([])
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <h1 tabIndex={-1} data-step-heading className="m-0 font-display text-[28px] leading-[1.15] outline-none lg:text-4xl lg:leading-[1.1]">
        Where do you live?
      </h1>
      <p className="m-0 text-[15px] leading-normal text-civic-muted lg:text-base">
        We use this to find your representatives and neighborhood, then we discard it. We only keep your districts.
      </p>

      {resolvedLabel ? (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-civic-accent bg-civic-accent-soft p-3.5" role="status">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-civic-accent">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{resolvedLabel}</span>
              {resolvedSub && <span className="text-[13px] text-civic-muted">{resolvedSub}</span>}
            </div>
            <button type="button" onClick={onEdit} className="min-h-11 px-1 text-sm font-semibold text-civic-accent">
              Edit
            </button>
          </div>
          <p className="m-0 text-[13px] text-civic-muted">Address discarded. Only your districts are kept.</p>
        </>
      ) : (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            submit(text)
          }}
        >
          <label htmlFor="onb-address" className="text-sm font-semibold">Street address</label>
          <div className="relative">
            <input
              id="onb-address"
              type="text"
              autoComplete="street-address"
              placeholder="e.g. 123 Main St, Brooklyn"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setProblem(null)
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={visible.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              aria-busy={busy}
              className="h-[52px] w-full rounded-xl border border-civic-dash bg-civic-surface px-3.5 pr-10 text-base text-civic-ink"
            />
            {busy && (
              <span className="absolute top-1/2 right-3.5 h-5 w-5 -translate-y-1/2 animate-spin rounded-full border-2 border-civic-dash border-t-civic-accent motion-reduce:animate-none" aria-hidden="true" />
            )}
            {visible.length > 0 && (
              <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-10 m-0 mt-1 list-none overflow-hidden rounded-xl border border-civic-border bg-civic-surface p-0 shadow-lg">
                {visible.map((s, i) => (
                  <li
                    key={s}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(s)
                    }}
                    className={`cursor-pointer px-3.5 py-3 text-[15px] ${i === active ? 'bg-civic-accent-soft' : 'hover:bg-civic-bg'}`}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" disabled={busy || !text.trim()} className="h-12 rounded-xl bg-civic-ink text-[15px] font-semibold text-white disabled:opacity-60">
            {busy ? 'Finding your districts…' : 'Find my districts'}
          </button>
        </form>
      )}

      {problem === 'not_found' && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-civic-border bg-civic-surface p-3.5 text-[15px]">
          <span className="font-semibold">We couldn’t place that address.</span>
          <span className="text-civic-muted">
            Local coverage is NYC-only for now. Thinking about moving?{' '}
            <a href={STREETEASY_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('onb_streeteasy_click', {})} className="font-semibold text-civic-accent">
              Find a place on StreetEasy ↗
            </a>
          </span>
          <span className="flex gap-4">
            <button type="button" onClick={() => setProblem(null)} className="min-h-11 font-semibold text-civic-accent">Try again</button>
            <button type="button" onClick={onSkip} className="min-h-11 font-semibold">Skip</button>
          </span>
        </div>
      )}
      {problem === 'unavailable' && (
        <p role="alert" className="m-0 rounded-xl bg-civic-sunken p-3.5 text-[15px]">
          Address lookup isn’t working right now. You can skip this step and add it later.
        </p>
      )}
      {problem === 'rate_limited' && (
        <p role="alert" className="m-0 rounded-xl bg-civic-sunken p-3.5 text-[15px]">
          Too many tries for now. Skip this step, or try again in a little while.
        </p>
      )}
    </div>
  )
}
