'use client'

import { useState } from 'react'
import { track } from '@/lib/analytics/track'
import { MAX_PHRASE_LENGTH } from '@/lib/embeddings/normalize'
import type { TopicChip } from '@/lib/onboarding/data/topics'
import { ComingSoonPill } from '../WidgetSection'

// S4 (spec §S4 v1.2, design export). Each chip or typed interest adds its own
// section. Related topics are tap-to-add, never auto-added (D18).

interface Match {
  title: string // "bike lanes · Park Slope"
  text: string
  comingSoon: boolean
  related: { id: string; name: string }[]
}

interface ResolveResponse {
  normalizedPhrase: string
  displayPhrase: string
  topicText: string
  place: { name: string; covered: boolean } | null
  comingSoon: boolean
  cached: boolean
  matchCount: number
  relatedTopics: { id: string; name: string }[]
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const MATCH_LIMIT = 50 // the resolve endpoint's maximum; more reads as "50+"

export default function StepInterests({
  chips,
  topicNames,
  selectedTopicIds,
  interests,
  toggleTopic,
  addInterest,
  removeInterest,
}: {
  chips: TopicChip[]
  topicNames: Record<string, string>
  selectedTopicIds: string[]
  interests: { phrase: string; display: string }[]
  toggleTopic: (id: string, name: string, source: 'suggested' | 'freetext') => void
  addInterest: (phrase: string, display: string) => void
  removeInterest: (phrase: string) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [match, setMatch] = useState<(Match & { phrase: string }) | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const phrase = text.trim()
    if (!phrase || busy) return
    setBusy(true)
    setError(null)
    const started = performance.now()
    try {
      const res = await fetch('/api/interests/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase, excludeTopicIds: selectedTopicIds, limit: MATCH_LIMIT }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const r = (await res.json()) as ResolveResponse
      track('onb_freetext_match', {
        cache_hit: r.cached,
        latency_ms: Math.round(performance.now() - started),
        topics_count: r.relatedTopics.length,
      })
      track('onb_select', { type: 'interest', source: 'freetext' })
      addInterest(r.normalizedPhrase, r.displayPhrase)
      const title = r.place ? `${r.topicText} · ${r.place.name}` : r.displayPhrase
      setMatch({
        phrase: r.normalizedPhrase,
        title,
        comingSoon: r.comingSoon,
        text: r.comingSoon
          ? `We don’t cover ${r.place?.name} yet. We added the section; it fills in once we do.`
          : r.matchCount > 0
            ? `Matched ${r.matchCount >= MATCH_LIMIT ? `${MATCH_LIMIT}+ items` : plural(r.matchCount, 'item')}. Added as its own section.`
            : 'No matches yet. We added the section; it fills in as items arrive.',
        related: r.relatedTopics.map((t) => ({ id: t.id, name: t.name })),
      })
      setText('')
    } catch {
      setError('We couldn’t add that right now. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  // Followed topics outside the suggested chips still show, so they can be removed
  const chipIds = new Set(chips.map((c) => c.id))
  const extraChips = selectedTopicIds.filter((id) => !chipIds.has(id)).map((id) => ({ id, name: topicNames[id] ?? 'Topic' }))
  const allChips = [...chips.map((c) => ({ id: c.id, name: c.name })), ...extraChips]
  const related = (match?.related ?? []).filter((r) => !selectedTopicIds.includes(r.id))

  const chipClass = (on: boolean) =>
    `min-h-10 rounded-full border-[1.5px] px-3.5 text-sm font-semibold ${
      on ? 'border-civic-accent bg-civic-accent text-white' : 'border-civic-dash bg-civic-surface text-civic-ink hover:border-civic-muted'
    }`

  return (
    <div className="flex flex-col gap-3.5">
      <h1 tabIndex={-1} data-step-heading className="m-0 font-display text-[28px] leading-[1.15] outline-none lg:text-4xl lg:leading-[1.1]">
        What issues do you care about?
      </h1>
      <p className="m-0 text-[15px] text-civic-muted lg:text-base">Each topic adds its own section to your feed.</p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Topics">
        {allChips.map((c) => {
          const on = selectedTopicIds.includes(c.id)
          return (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => toggleTopic(c.id, c.name, 'suggested')} className={chipClass(on)}>
              {c.name}
            </button>
          )
        })}
        {interests.map((i) => (
          <button key={i.phrase} type="button" aria-label={`Remove ${i.display}`} onClick={() => removeInterest(i.phrase)} className={chipClass(true)}>
            {i.display} <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>

      <form onSubmit={add} className="mt-1.5 flex flex-col gap-2">
        <label htmlFor="onb-topic" className="text-sm font-semibold">Add your own</label>
        <span id="onb-topic-hint" className="-mt-1 text-[13px] text-civic-muted">
          Add a place to narrow it, e.g. “housing legislation in California”.
        </span>
        <div className="flex gap-2">
          <input
            id="onb-topic"
            type="text"
            value={text}
            maxLength={MAX_PHRASE_LENGTH}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. bike lanes in Park Slope"
            aria-describedby="onb-topic-hint"
            className="h-12 min-w-0 flex-1 rounded-xl border border-civic-dash bg-civic-surface px-3.5 text-base"
          />
          <button type="submit" disabled={busy || !text.trim()} className="h-12 rounded-xl bg-civic-ink px-[18px] text-[15px] font-semibold text-white disabled:opacity-60">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && <p role="alert" className="m-0 text-sm text-red-700">{error}</p>}
      </form>

      {match && interests.some((i) => i.phrase === match.phrase) && (
        <div className="flex flex-col gap-2 rounded-xl border border-civic-border bg-civic-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">{match.title}</span>
            {match.comingSoon && <ComingSoonPill />}
          </div>
          <span aria-live="polite" className="text-sm text-civic-muted">{match.text}</span>
          {related.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-civic-muted">Related:</span>
              {related.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-label={`Add ${r.name} as a topic`}
                  onClick={() => toggleTopic(r.id, r.name, 'freetext')}
                  className="min-h-9 rounded-full border-[1.5px] border-dashed border-civic-accent bg-civic-surface px-3 text-[13px] font-semibold text-civic-accent"
                >
                  + {r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
