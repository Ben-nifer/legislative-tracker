'use client'

import AppMark from '../AppMark'

// S0 (spec §S0, design export): value line, "Takes about a minute", two CTAs,
// and a footer sign-in link for returning users.
export default function StepWelcome({
  onStart,
  onPopular,
  onSignIn,
  signedIn,
}: {
  onStart: () => void
  onPopular: () => void
  onSignIn: () => void
  signedIn: boolean
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-7 pt-[72px] pb-8 lg:max-w-xl lg:justify-center lg:pt-8">
      <AppMark size={52} showName={false} />
      <h1 tabIndex={-1} data-step-heading className="m-0 mt-6 font-display text-4xl leading-[1.1] font-bold tracking-[-0.01em] outline-none">
        Follow the decisions that shape your block.
      </h1>
      <p className="m-0 text-[17px] leading-normal text-civic-muted">
        Bills, projects and budget items from Congress to your neighborhood, in one feed you control.
      </p>
      <p className="m-0 text-[15px] text-civic-muted">Takes about a minute.</p>
      <div className="flex-1 lg:hidden" />
      <button type="button" onClick={onStart} className="h-14 rounded-[14px] bg-civic-accent text-[17px] font-semibold text-white hover:bg-civic-accent-hover lg:mt-6">
        Build my feed
      </button>
      <button type="button" onClick={onPopular} className="h-[52px] rounded-[14px] border border-civic-dash bg-civic-surface text-base font-semibold text-civic-ink hover:bg-civic-bg">
        Just show me what&apos;s popular
      </button>
      {!signedIn && (
        <p className="m-0 mt-1 text-center text-sm text-civic-muted">
          Already have an account?{' '}
          <button type="button" onClick={onSignIn} className="px-1 py-2 text-sm font-semibold text-civic-accent">
            Sign in
          </button>
        </p>
      )}
    </main>
  )
}
