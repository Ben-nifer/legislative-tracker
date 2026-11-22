'use client'

import { useEffect, useRef } from 'react'
import type { FeedResponse } from '@/lib/feed/types'
import { PreviewSection } from '../WidgetSection'

// Spec §6: two columns at ≥1024 px (this aside), a peek card + sheet below that.

function Sections({ feed, columns }: { feed: FeedResponse | null; columns: boolean }) {
  if (!feed) {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-civic-sunken motion-reduce:animate-none" />
        ))}
      </div>
    )
  }
  return (
    <>
      {feed.widgets.map((w) => (
        <PreviewSection key={w.key} widget={w} columns={columns} />
      ))}
    </>
  )
}

export function PreviewAside({ feed, countLabel, onExplore }: { feed: FeedResponse | null; countLabel: string; onExplore: () => void }) {
  return (
    <aside
      aria-label="Live preview of your feed"
      className="hidden min-w-0 flex-[3_1_480px] flex-col gap-[18px] self-start rounded-[18px] border border-civic-border bg-civic-surface p-[22px] lg:flex"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 font-display text-[22px]">Your feed so far</h2>
        <span aria-live="polite" className="text-sm font-bold text-civic-accent">{countLabel}</span>
      </div>
      <Sections feed={feed} columns />
      <p className="m-0 text-[13px] text-civic-muted">
        The feed is read-only here. Engagement starts on your page.{' '}
        <button type="button" onClick={onExplore} className="font-semibold text-civic-accent underline-offset-2 hover:underline">
          Explore my feed
        </button>
      </p>
    </aside>
  )
}

// Mobile: the peek card (first 2 items + count) that opens the full preview sheet
export function PreviewPeek({ feed, countLabel, onOpen }: { feed: FeedResponse | null; countLabel: string; onOpen: () => void }) {
  const peek = (feed?.widgets ?? []).flatMap((w) => w.items.map((i) => ({ item: i, section: w.title }))).slice(0, 2)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Expand your feed preview"
      className="flex w-full flex-col gap-1.5 rounded-[14px] border border-civic-border bg-civic-surface px-3.5 py-3 text-left text-civic-ink"
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span aria-live="polite" className="text-[13px] font-bold text-civic-accent">{countLabel || 'Your feed so far'}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-civic-muted">
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </span>
      {peek.map(({ item, section }) => (
        <span key={`${section}|${item.id}`} className="flex w-full flex-col gap-px">
          <span className="truncate text-sm font-semibold">{item.title}</span>
          <span className={`text-xs ${item.isNew ? 'text-civic-accent' : 'text-civic-muted'}`}>
            {item.isNew ? 'New · ' : ''}
            {section}
          </span>
        </span>
      ))}
    </button>
  )
}

export function PreviewSheet({
  open,
  feed,
  countLabel,
  onClose,
  onExplore,
}: {
  open: boolean
  feed: FeedResponse | null
  countLabel: string
  onClose: () => void
  onExplore: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="preview-sheet-title"
      className="theme-civic m-0 mt-auto h-[90dvh] w-full max-w-none rounded-t-[22px] bg-civic-bg p-0 text-civic-ink backdrop:bg-[rgba(21,23,28,0.35)] lg:hidden"
    >
      <div className="flex h-full flex-col">
        <div className="flex justify-center pt-2.5" aria-hidden="true">
          <div className="h-[5px] w-10 rounded-full bg-civic-dash" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pt-2.5 pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="preview-sheet-title" className="m-0 font-display text-[22px]">Your feed so far</h2>
            <span className="text-[13px] text-civic-muted">{countLabel}</span>
          </div>
          <button type="button" onClick={onClose} className="min-h-10 flex-none rounded-full border-[1.5px] border-civic-accent bg-civic-surface px-3.5 text-sm font-semibold text-civic-accent">
            Keep building
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-4 pt-1 pb-4">
          <Sections feed={feed} columns={false} />
        </div>
        <div className="border-t border-civic-rule px-4 pt-3 pb-7">
          <button type="button" onClick={onExplore} className="h-[52px] w-full rounded-[14px] bg-civic-accent text-base font-semibold text-white">
            Explore my feed
          </button>
        </div>
      </div>
    </dialog>
  )
}
