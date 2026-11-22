'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { track } from '@/lib/analytics/track'
import SignInSheet from './SignInSheet'

// Per-viewer prompts on the widget home page. Dismissals are UI conveniences,
// so browser storage is enough (and failing storage just shows them again).

type Store = 'local' | 'session'

function readFlag(storage: Store, key: string): boolean {
  try {
    return (storage === 'local' ? localStorage : sessionStorage).getItem(key) === '1'
  } catch {
    return false
  }
}
function writeFlag(storage: Store, key: string) {
  try {
    ;(storage === 'local' ? localStorage : sessionStorage).setItem(key, '1')
  } catch {}
}

const noSubscribe = () => () => {}

// True once the flag is set; on the server (and before hydration) prompts stay hidden
function useStoredFlag(storage: Store, key: string): boolean {
  return useSyncExternalStore(noSubscribe, () => readFlag(storage, key), () => true)
}

// Guests: the "Save your feed" sheet once per session (spec §8), plus a banner
export function SaveFeedPrompt() {
  // Decided once per mount on the client; the sheet opens from an effect, so the
  // server render (no storage) never disagrees with the markup
  const [autoOpen] = useState(() => typeof window !== 'undefined' && !readFlag('session', 'onb_save_prompt'))
  const [state, setState] = useState<'auto' | 'open' | 'closed'>('auto')
  const open = state === 'open' || (state === 'auto' && autoOpen)

  useEffect(() => {
    if (state === 'auto' && autoOpen) {
      writeFlag('session', 'onb_save_prompt')
      track('auth_prompt', { trigger: 's6_sheet' })
    }
  }, [state, autoOpen])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-civic-border bg-civic-surface px-4 py-3.5">
        <span className="text-[15px]">
          <span className="font-semibold">Save your feed.</span>{' '}
          <span className="text-civic-muted">Your choices won’t be saved if you leave.</span>
        </span>
        <button
          type="button"
          onClick={() => {
            track('auth_prompt', { trigger: 's6_sheet' })
            setState('open')
          }}
          className="min-h-10 rounded-full bg-civic-accent px-4 text-sm font-semibold text-white"
        >
          Save
        </button>
      </div>
      <SignInSheet open={open} mode="save" next="/" onClose={() => setState('closed')} />
    </>
  )
}

function Dismissible({ storageKey, children }: { storageKey: string; children: (dismiss: () => void) => React.ReactNode }) {
  const stored = useStoredFlag('local', storageKey)
  const [dismissed, setDismissed] = useState(false)
  if (stored || dismissed) return null
  return (
    <>
      {children(() => {
        writeFlag('local', storageKey)
        setDismissed(true)
      })}
    </>
  )
}

// Existing accounts with no sections yet: one-time "Build your feed" banner (B8)
export function BuildFeedBanner() {
  return (
    <Dismissible storageKey="onb_build_banner">
      {(dismiss) => (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-civic-accent bg-civic-accent-soft px-4 py-3.5">
          <span className="text-[15px]">
            <span className="font-semibold">Build your feed.</span>{' '}
            <span className="text-civic-muted">Pick your neighborhood, representatives and issues in about a minute.</span>
          </span>
          <span className="flex items-center gap-3">
            <Link href="/welcome?step=1" className="flex min-h-10 items-center rounded-full bg-civic-accent px-4 text-sm font-semibold text-white no-underline">
              Start
            </Link>
            <button type="button" onClick={dismiss} className="min-h-10 text-sm font-semibold text-civic-muted">
              Dismiss
            </button>
          </span>
        </div>
      )}
    </Dismissible>
  )
}

// Coach mark pointing at Customize (spec §S6), dismissible
export function CustomizeHint() {
  return (
    <Dismissible storageKey="onb_customize_hint">
      {(dismiss) => (
        <div role="note" className="rounded-xl bg-civic-ink px-3.5 py-2.5 text-sm text-white">
          Add or remove sections anytime here.
          <button type="button" onClick={dismiss} className="ml-3 font-semibold underline">
            Got it
          </button>
        </div>
      )}
    </Dismissible>
  )
}
