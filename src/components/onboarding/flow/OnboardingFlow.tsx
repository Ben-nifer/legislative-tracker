'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getRepresentatives, saveSelections } from '@/app/actions/onboarding'
import { track } from '@/lib/analytics/track'
import { writeGuestContext } from '@/lib/onboarding/client-cookies'
import { addressLabel } from '@/lib/onboarding/address-label'
import type { AddressResolution } from '@/lib/onboarding/data/address'
import type { RepresentativeCard } from '@/lib/onboarding/data/representatives'
import AppMark from '../AppMark'
import SignInSheet from '../SignInSheet'
import { PreviewAside, PreviewPeek, PreviewSheet } from './LivePreview'
import StepAddress from './StepAddress'
import StepInterests from './StepInterests'
import StepJurisdictions from './StepJurisdictions'
import StepPoliticians from './StepPoliticians'
import StepWelcome from './StepWelcome'
import type { FlowData, PoliticianInfo, Selection } from './types'
import { useFeedPreview } from './useFeedPreview'

// Onboarding S0–S4 (onboarding spec v1.2, build plan §5, design export). One
// client route; the step lives in the URL (?step=2) so Back works. Guests'
// choices go to the onb_ctx cookie on every change; signed-in users' are saved
// when they leave for their page.

type StepId = 'address' | 'jurisdictions' | 'politicians' | 'interests'
type ExitPath = 'survey' | 'explore_exit' | 'popular'

const placeId = (sel: Selection, type: string) => sel.places.find((p) => p.type === type)?.id ?? null

export default function OnboardingFlow({ data }: { data: FlowData }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const steps: StepId[] = useMemo(
    () => ['address', 'jurisdictions', ...(data.steps.politicians ? ['politicians' as const] : []), ...(data.steps.interests ? ['interests' as const] : [])],
    [data.steps]
  )
  const stepNumber = Math.min(Math.max(Number(searchParams.get('step') ?? 0) || 0, 0), steps.length)
  const step = stepNumber === 0 ? null : steps[stepNumber - 1]

  const [sel, setSel] = useState<Selection>(data.initial)
  const [reps, setReps] = useState<RepresentativeCard[]>(data.reps)
  const [placeNames, setPlaceNames] = useState(data.placeNames)
  const [politicians, setPoliticians] = useState(data.politicians)
  const [topicNames, setTopicNames] = useState(data.topicNames)
  const [extraHoods, setExtraHoods] = useState<string[]>(() =>
    data.initial.jurisdictions.filter((j) => j.type === 'neighborhood' && j.id !== placeId(data.initial, 'neighborhood')).map((j) => j.id)
  )
  const [limitHit, setLimitHit] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [signIn, setSignIn] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { feed, countLabel } = useFeedPreview(sel)

  // Guests: every change goes to the session cookie (build plan §3.3)
  const update = useCallback(
    (fn: (s: Selection) => Selection) => {
      setSel((cur) => {
        const next = fn(cur)
        if (!data.signedIn && !writeGuestContext(next)) {
          setLimitHit(true)
          return cur
        }
        setLimitHit(false)
        return next
      })
    },
    [data.signedIn]
  )

  // Step changes: analytics, and focus moves to the step's heading (spec §10)
  const firstRender = useRef(true)
  useEffect(() => {
    track('onb_view', { step: stepNumber })
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    document.querySelector<HTMLElement>('[data-step-heading]')?.focus()
  }, [stepNumber])

  // Client-side step change (Next syncs useSearchParams with history.pushState),
  // so moving between steps doesn't refetch the page
  const goTo = (n: number) => {
    setSheet(false)
    window.history.pushState(null, '', n === 0 ? '/welcome' : `/welcome?step=${n}`)
    window.scrollTo({ top: 0 })
  }

  async function finish(path: ExitPath) {
    if (leaving) return
    setLeaving(true)
    track('onb_complete', { path })
    if (data.signedIn) {
      const { error } = await saveSelections(data.initial, sel)
      if (error) {
        setSaveError(error)
        setLeaving(false)
        return
      }
    }
    router.push('/')
  }

  const next = () => (stepNumber >= steps.length ? finish('survey') : goTo(stepNumber + 1))
  const skip = () => {
    track('onb_skip', { step: stepNumber })
    next()
  }
  const explore = () => {
    track('onb_explore_exit', { step: Math.max(stepNumber, 1) })
    finish('explore_exit')
  }

  // ── Selections ──────────────────────────────────────────────────────────────
  const isSelected = (type: string, id: string) => sel.jurisdictions.some((j) => j.type === type && j.id === id)
  const toggleJurisdiction = (type: string, id: string, source: 'suggested' | 'search') => {
    const on = !isSelected(type, id)
    if (on) track('onb_select', { type: type === 'neighborhood' ? 'neighborhood' : 'jurisdiction', id: `${type}:${id}`, source })
    update((s) => ({
      ...s,
      jurisdictions: on
        ? [...s.jurisdictions, { type: type as Selection['jurisdictions'][number]['type'], id }]
        : s.jurisdictions.filter((j) => !(j.type === type && j.id === id)),
    }))
  }
  const selectAllMine = () => {
    const mine: [string, string, boolean][] = [
      ['federal', 'us', data.coverage.federal],
      ['state', 'NY', data.coverage.state],
      ['city', 'nyc', data.coverage.city],
    ]
    const nta = placeId(sel, 'neighborhood')
    if (nta) mine.push(['neighborhood', nta, data.coverage.neighborhood])
    for (const [type, id, live] of mine) if (live && !isSelected(type, id)) toggleJurisdiction(type, id, 'suggested')
  }

  const isFollowed = (id: string) => sel.legislatorIds.includes(id)
  const rememberPolitician = (info: PoliticianInfo) => setPoliticians((p) => ({ ...p, [info.id]: info }))
  const togglePolitician = (info: PoliticianInfo, source: 'suggested' | 'search') => {
    rememberPolitician(info)
    const on = !isFollowed(info.id)
    if (on) track('onb_select', { type: 'politician', id: info.id, source })
    update((s) => ({ ...s, legislatorIds: on ? [...s.legislatorIds, info.id] : s.legislatorIds.filter((x) => x !== info.id) }))
  }

  const toggleTopic = (id: string, name: string, source: 'suggested' | 'freetext') => {
    setTopicNames((t) => ({ ...t, [id]: name }))
    const on = !sel.topicIds.includes(id)
    if (on) track('onb_select', { type: 'topic', id, source })
    update((s) => ({ ...s, topicIds: on ? [...s.topicIds, id] : s.topicIds.filter((x) => x !== id) }))
  }
  const addInterest = (phrase: string, display: string) =>
    update((s) => (s.interests.some((i) => i.phrase === phrase) ? s : { ...s, interests: [...s.interests, { phrase, display }] }))
  const removeInterest = (phrase: string) => update((s) => ({ ...s, interests: s.interests.filter((i) => i.phrase !== phrase) }))

  async function onResolved(result: Extract<AddressResolution, { status: 'ok' }>) {
    if (result.neighborhood) setPlaceNames((n) => ({ ...n, [result.neighborhood!.ntaCode]: result.neighborhood!.name }))
    update((s) => ({ ...s, places: result.places }))
    setReps(await getRepresentatives(result.places).catch(() => []))
  }
  const onEditAddress = () => {
    update((s) => ({ ...s, places: [] }))
    setReps([])
  }

  // ── Derived display ─────────────────────────────────────────────────────────
  const council = placeId(sel, 'council_district')
  const nta = placeId(sel, 'neighborhood')
  const districts = {
    council,
    senate: placeId(sel, 'state_senate'),
    assembly: placeId(sel, 'assembly'),
    congressional: placeId(sel, 'congressional'),
    nta,
  }
  const resolvedLabel = council ? addressLabel(council, nta ? placeNames[nta] ?? null : null) : null
  const resolvedSub = council
    ? [districts.congressional && `NY-${districts.congressional}`, districts.senate && `Senate District ${districts.senate}`, districts.assembly && `Assembly District ${districts.assembly}`]
        .filter(Boolean)
        .join(' · ')
    : null

  const signInSheet = (
    <SignInSheet open={signIn} mode="signin" next="/" onClose={() => setSignIn(false)} />
  )

  // ── S0 ──────────────────────────────────────────────────────────────────────
  if (!step) {
    return (
      <>
        <StepWelcome
          signedIn={data.signedIn}
          onStart={() => goTo(1)}
          onPopular={() => finish('popular')}
          onSignIn={() => {
            track('auth_prompt', { trigger: 'header' })
            setSignIn(true)
          }}
        />
        {signInSheet}
      </>
    )
  }

  const isLast = stepNumber === steps.length
  const nextLabel = isLast ? 'See my page' : 'Continue'
  const progress = (
    <div className="grid max-w-[360px] gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-hidden="true">
      {steps.map((s, i) => (
        <div key={s} className={`h-1 rounded-sm ${i < stepNumber ? 'bg-civic-accent' : 'bg-civic-border'}`} />
      ))}
    </div>
  )

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar: mobile = Back · Step n of N · Skip; desktop = mark · Step n of N · Skip */}
      <header className="flex items-center justify-between gap-3 border-civic-rule bg-civic-bg px-4 pt-3 pb-2 lg:border-b lg:bg-civic-surface lg:px-8 lg:py-[18px]">
        <button type="button" aria-label="Back" onClick={() => goTo(stepNumber - 1)} className="flex h-11 w-11 items-center justify-center rounded-full lg:hidden">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="hidden lg:block"><AppMark /></span>
        <div className="flex items-center gap-5 text-sm">
          <span className="font-semibold text-civic-muted">Step {stepNumber} of {steps.length}</span>
          <button type="button" onClick={skip} className="hidden min-h-11 font-semibold text-civic-accent lg:block">Skip</button>
        </div>
        <button type="button" onClick={skip} className="min-h-11 min-w-11 text-[15px] font-semibold text-civic-accent lg:hidden">Skip</button>
      </header>
      <div className="px-5 pb-3 lg:hidden">{progress}</div>

      <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-wrap gap-8 px-5 pb-48 lg:p-8">
        <main className="flex min-w-0 flex-[2_1_380px] flex-col gap-4">
          <div className="hidden lg:block">{progress}</div>
          {step === 'address' && (
            <StepAddress resolvedLabel={resolvedLabel} resolvedSub={resolvedSub} onResolved={onResolved} onEdit={onEditAddress} onSkip={skip} />
          )}
          {step === 'jurisdictions' && (
            <StepJurisdictions
              coverage={data.coverage}
              districts={districts}
              placeNames={placeNames}
              isSelected={isSelected}
              toggle={toggleJurisdiction}
              selectAllMine={selectAllMine}
              extraNeighborhoods={extraHoods}
              onNeighborhoodFound={(m) => {
                setPlaceNames((n) => ({ ...n, [m.ntaCode]: m.name }))
                setExtraHoods((h) => (h.includes(m.ntaCode) ? h : [...h, m.ntaCode]))
              }}
            />
          )}
          {step === 'politicians' && (
            <StepPoliticians
              reps={reps}
              jurisdictionKeys={sel.jurisdictions.map((j) => `${j.type}:${j.id}`)}
              followedIds={sel.legislatorIds}
              known={politicians}
              isFollowed={isFollowed}
              toggle={togglePolitician}
              remember={rememberPolitician}
            />
          )}
          {step === 'interests' && (
            <StepInterests
              chips={data.chips}
              topicNames={topicNames}
              selectedTopicIds={sel.topicIds}
              interests={sel.interests}
              toggleTopic={toggleTopic}
              addInterest={addInterest}
              removeInterest={removeInterest}
            />
          )}

          {limitHit && (
            <p role="alert" className="m-0 rounded-xl bg-civic-sunken p-3.5 text-[15px]">
              That’s the most we can hold before you sign in. Remove something, or sign in on your page to keep going.
            </p>
          )}
          {saveError && <p role="alert" className="m-0 text-[15px] text-red-700">{saveError}</p>}

          <div className="mt-3 hidden flex-wrap items-center gap-4 lg:flex">
            <button type="button" onClick={next} disabled={leaving} className="h-[52px] rounded-[14px] bg-civic-accent px-8 text-base font-semibold text-white hover:bg-civic-accent-hover disabled:opacity-60">
              {nextLabel}
            </button>
            <button type="button" onClick={() => goTo(stepNumber - 1)} className="text-[15px] font-semibold text-civic-ink underline-offset-2 hover:underline">
              Back
            </button>
          </div>
        </main>

        <PreviewAside feed={feed} countLabel={countLabel} onExplore={explore} />
      </div>

      {/* Mobile bottom bar: peek card, Continue, Explore my feed */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2.5 border-t border-civic-rule bg-civic-bg px-4 pt-2.5 pb-7 lg:hidden">
        <PreviewPeek
          feed={feed}
          countLabel={countLabel}
          onOpen={() => {
            track('onb_preview_expand', {})
            setSheet(true)
          }}
        />
        <button type="button" onClick={next} disabled={leaving} className="h-[54px] rounded-[14px] bg-civic-accent text-[17px] font-semibold text-white disabled:opacity-60">
          {nextLabel}
        </button>
        <button type="button" onClick={explore} className="min-h-9 text-sm font-semibold text-civic-ink underline">
          Explore my feed
        </button>
      </div>

      <PreviewSheet open={sheet} feed={feed} countLabel={countLabel} onClose={() => setSheet(false)} onExplore={explore} />
      {signInSheet}
    </div>
  )
}
