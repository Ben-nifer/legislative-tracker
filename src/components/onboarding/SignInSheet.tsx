'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { setPendingAction } from '@/lib/onboarding/client-cookies'
import type { PendingAction } from '@/lib/onboarding/session'

// Deferred sign-in (onboarding spec §8, build plan §4.3): Google or an email
// magic link (B7), with "Not now" always available. A gated action is stored in
// onb_pending and completed by the auth callback.

export const SHEET_COPY = {
  save: { title: 'Save your feed', body: "Your choices won't be saved if you leave." },
  stance: { title: 'Sign in to take a stance on this bill', body: 'Your feed and your stance will be saved to your account.' },
  follow: { title: 'Sign in to follow this', body: 'Your feed and what you follow will be saved to your account.' },
  signin: { title: 'Welcome back', body: 'Sign in to load your saved feed.' },
} as const

export default function SignInSheet({
  open,
  mode,
  next,
  pending,
  onClose,
}: {
  open: boolean
  mode: keyof typeof SHEET_COPY
  next: string // where the callback returns the user
  pending?: PendingAction
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  async function google() {
    if (pending) setPendingAction(pending)
    await createClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } })
  }

  async function magicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    if (pending) setPendingAction(pending)
    setState('sending')
    const { error } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo() } })
    setState(error ? 'error' : 'sent')
  }

  const copy = SHEET_COPY[mode]

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-labelledby="signin-title"
      className="theme-civic m-0 mt-auto w-full max-w-none rounded-t-[22px] bg-civic-surface p-0 text-civic-ink backdrop:bg-[rgba(21,23,28,0.45)] sm:m-auto sm:max-w-md sm:rounded-[22px]"
    >
      <div className="flex flex-col gap-3 px-5 pt-3 pb-8">
        <div className="flex justify-center sm:hidden" aria-hidden="true">
          <div className="h-[5px] w-10 rounded-full bg-civic-dash" />
        </div>
        <h2 id="signin-title" className="m-0 mt-2 font-display text-2xl leading-tight">{copy.title}</h2>
        <p className="m-0 mb-1.5 text-[15px] leading-relaxed text-civic-muted">{copy.body}</p>

        <button type="button" onClick={google} className="h-[52px] rounded-xl border border-civic-dash bg-civic-surface text-base font-semibold hover:bg-civic-bg">
          Continue with Google
        </button>

        {state === 'sent' ? (
          <p role="status" className="m-0 rounded-xl bg-civic-accent-soft p-3.5 text-[15px]">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form onSubmit={magicLink} className="flex flex-col gap-2">
            <label htmlFor="signin-email" className="text-sm font-semibold">Or use your email</label>
            <div className="flex gap-2">
              <input
                id="signin-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 min-w-0 flex-1 rounded-xl border border-civic-dash bg-civic-surface px-3.5 text-base"
              />
              <button type="submit" disabled={state === 'sending'} className="h-12 rounded-xl bg-civic-ink px-4 text-[15px] font-semibold text-white disabled:opacity-60">
                {state === 'sending' ? 'Sending…' : 'Email me a link'}
              </button>
            </div>
            {state === 'error' && <p role="alert" className="m-0 text-sm text-red-700">Couldn’t send the link. Try again.</p>}
          </form>
        )}

        <button type="button" onClick={onClose} className="h-12 text-base font-semibold">
          Not now
        </button>
      </div>
    </dialog>
  )
}
