import Link from 'next/link'
import type { FeedWidget, WidgetKind } from '@/lib/feed/types'
import { FeedItemCard, FeedItemRow } from './FeedItem'

// Sections are titled by name only (onboarding spec v1.2 §6.1). On web the home
// page adds a small kind label above the title, as in the design export.

const KIND_LABELS: Record<WidgetKind, string> = {
  jurisdiction: 'Jurisdiction',
  neighborhood: 'Neighborhood',
  topic: 'Topic',
  politician: 'Politician',
  tracked: 'Your list',
  friends: 'Your list',
  trending: 'Everyone',
}

const EMPTY_COPY: Partial<Record<WidgetKind, { title: string; body: string }>> = {
  tracked: {
    title: 'Nothing tracked yet',
    body: 'Open any item and follow it or take a stance there. It shows up here, with its next hearing or vote.',
  },
  friends: { title: 'No friend activity yet', body: 'When people you follow weigh in on a bill, you’ll see it here.' },
}
const DEFAULT_EMPTY = { title: 'Nothing here yet', body: 'New items will show up here as they’re introduced.' }

export function ComingSoonPill() {
  return <span className="rounded-full bg-civic-pill px-2 py-0.5 text-[11px] font-bold text-civic-muted">Coming soon</span>
}

function seeAllHref(w: FeedWidget): string | null {
  if (!w.items.length || w.comingSoon) return null
  if (w.kind === 'tracked') return '/following'
  if (w.kind === 'trending' || w.kind === 'friends') return null
  return `/section/${encodeURIComponent(w.key)}`
}

function EmptyPanel({ widget, compact }: { widget: FeedWidget; compact?: boolean }) {
  if (widget.comingSoon) {
    return (
      <div className={`flex flex-col gap-1.5 bg-civic-sunken ${compact ? 'rounded-xl border border-dashed border-civic-dash p-3.5' : 'px-4 py-5'}`}>
        <span className="text-[15px] font-semibold">We don’t cover {widget.comingSoon.place} yet.</span>
        <span className="text-[13px] leading-relaxed text-civic-muted">
          This section fills in automatically once we do. It stays on your page until you remove it.
        </span>
      </div>
    )
  }
  const copy = EMPTY_COPY[widget.kind] ?? DEFAULT_EMPTY
  return (
    <div className={`flex flex-col gap-1.5 ${compact ? 'rounded-xl border border-dashed border-civic-dash bg-civic-surface p-3.5' : 'px-4 py-5'}`}>
      <span className="text-[15px] font-semibold">{copy.title}</span>
      <span className="text-[13px] leading-relaxed text-civic-muted">{copy.body}</span>
    </div>
  )
}

// Home page section: 5 rows + "See all"
export function WidgetSection({ widget, headingLevel = 2 }: { widget: FeedWidget; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const href = seeAllHref(widget)
  return (
    <section className="flex min-w-0 flex-col gap-2.5" aria-label={widget.title}>
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="hidden text-[11px] font-bold uppercase tracking-[0.06em] text-civic-muted sm:block">
            {KIND_LABELS[widget.kind]}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Heading className="m-0 font-display text-lg leading-tight sm:text-xl">{widget.title}</Heading>
            {widget.comingSoon && <ComingSoonPill />}
          </div>
          {widget.nearby && <span className="text-xs text-civic-muted">{widget.nearby}</span>}
        </div>
        {href && (
          <Link href={href} aria-label={`See all ${widget.title}`} className="flex min-h-9 flex-none items-center text-sm font-semibold text-civic-accent hover:text-civic-accent-hover">
            See all
          </Link>
        )}
      </div>
      <div className="flex flex-col overflow-hidden rounded-[14px] border border-civic-border bg-civic-surface">
        {widget.items.length ? widget.items.map((item) => <FeedItemRow key={item.id} item={item} widgetKey={widget.key} />) : <EmptyPanel widget={widget} />}
      </div>
    </section>
  )
}

// Onboarding preview section: 3 read-only cards
export function PreviewSection({ widget, columns }: { widget: FeedWidget; columns: boolean }) {
  return (
    <section className="flex flex-col gap-2.5" aria-label={widget.title}>
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 font-display text-base sm:text-lg">{widget.title}</h3>
          {widget.comingSoon && <ComingSoonPill />}
        </div>
        {widget.nearby && <span className="text-xs text-civic-muted">{widget.nearby}</span>}
      </div>
      {widget.items.length ? (
        <div className={columns ? 'grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5' : 'flex flex-col gap-2'}>
          {widget.items.map((item) => (
            <FeedItemCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyPanel widget={widget} compact />
      )}
    </section>
  )
}
