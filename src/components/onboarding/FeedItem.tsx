import Link from 'next/link'
import type { FeedItem as Item } from '@/lib/feed/types'

// Item cards (onboarding spec v1.2 §6.1): type · status, title, context label.
// No stance controls; on the home page the whole row links to the item's page.

function Label({ item, isNew }: { item: Item; isNew: boolean }) {
  const text = [isNew ? 'New' : null, item.label].filter(Boolean).join(' · ')
  if (!text) return null
  const color = isNew || item.personal ? 'text-civic-accent' : 'text-civic-badge-ink'
  return <span className={`text-xs font-semibold ${color}`}>{text}</span>
}

function Meta({ item }: { item: Item }) {
  return (
    <div className="text-xs text-civic-muted">
      <span className="font-bold text-civic-ink">{item.typeLabel}</span> · {item.statusLabel}
    </div>
  )
}

const external = (href: string) => /^https?:\/\//.test(href)

// Home page / See all: a full-width row inside the section's card. The data
// attributes let FeedClickLogger attribute a home-page click to its impression.
export function FeedItemRow({ item, widgetKey }: { item: Item; widgetKey?: string }) {
  const data = widgetKey ? { 'data-feed-widget': widgetKey, 'data-feed-item': item.id } : {}
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Meta item={item} />
        <p className="m-0 text-[15px] font-semibold leading-snug">{item.title}</p>
        <Label item={item} isNew={false} />
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-civic-muted">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </>
  )
  const className =
    'flex items-center gap-3 border-b border-civic-divider px-4 py-[13px] text-civic-ink no-underline last:border-b-0 hover:bg-civic-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-civic-accent'
  return external(item.href) ? (
    <a href={item.href} className={className} aria-label={`Open ${item.title}`} target="_blank" rel="noopener noreferrer" {...data}>
      {body}
    </a>
  ) : (
    <Link href={item.href} className={className} aria-label={`Open ${item.title}`} {...data}>
      {body}
    </Link>
  )
}

// Onboarding preview: read-only (spec §6), new items outlined and marked "New ·"
export function FeedItemCard({ item }: { item: Item }) {
  return (
    <article
      className={`flex flex-col gap-1.5 rounded-xl p-3.5 ${
        item.isNew ? 'civic-enter border-[1.5px] border-civic-accent bg-civic-accent-soft' : 'border border-civic-border bg-civic-bg'
      }`}
    >
      <Meta item={item} />
      <p className="m-0 text-[15px] font-semibold leading-snug">{item.title}</p>
      <Label item={item} isNew={item.isNew} />
    </article>
  )
}
