import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getSection } from '@/lib/feed/getFeed'
import { FeedItemRow } from '@/components/onboarding/FeedItem'
import { civicFontClasses } from '@/components/onboarding/fonts'

// "See all" for a home-page section (recommendations plan §7.2): the shared
// widget's full cached list, in the civic theme.
export default async function SectionPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const section = await getSection(createServiceClient(), decodeURIComponent(key))
  if (!section) notFound()

  return (
    <div className={`theme-civic min-h-dvh ${civicFontClasses}`}>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-8 pb-12 sm:px-8">
        <Link href="/" className="text-sm font-semibold text-civic-accent no-underline">← Your page</Link>
        <h1 className="m-0 font-display text-3xl leading-tight">{section.title}</h1>
        {section.nearby && <p className="m-0 text-sm text-civic-muted">{section.nearby}</p>}
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-civic-border bg-civic-surface">
          {section.items.length ? (
            section.items.map((item) => <FeedItemRow key={item.id} item={item} />)
          ) : (
            <p className="m-0 px-4 py-5 text-[15px] text-civic-muted">Nothing here yet. New items will show up here as they’re introduced.</p>
          )}
        </div>
      </main>
    </div>
  )
}
