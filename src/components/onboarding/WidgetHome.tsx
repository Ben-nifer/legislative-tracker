import Link from 'next/link'
import { cookies } from 'next/headers'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { getFeed } from '@/lib/feed/getFeed'
import { contextFromGuest, loadUserContext } from '@/lib/feed/context'
import { GUEST_CONTEXT_COOKIE, parseGuestContext } from '@/lib/onboarding/guest'
import { getCoverage } from '@/lib/onboarding/data/coverage'
import CivicHeader from './CivicHeader'
import { ComingSoonPill, WidgetSection } from './WidgetSection'
import { BuildFeedBanner, CustomizeHint, SaveFeedPrompt } from './HomePrompts'
import { civicFontClasses } from './fonts'

// S6 / the widget home page (build plan §6, design export "Here's your page"):
// the user's sections at 5 items, then Tracked → Trending → Friend activity.
// Everyone sees it: signed-in users from their follows, guests from onb_ctx,
// and an empty context as "Popular right now".
export default async function WidgetHome() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const service = createServiceClient()

  const [ctx, profile, coverage] = await Promise.all([
    user
      ? loadUserContext(service, user.id)
      : Promise.resolve(contextFromGuest(parseGuestContext((await cookies()).get(GUEST_CONTEXT_COOKIE)?.value))),
    user
      ? service.from('user_profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    getCoverage(service),
  ])
  const feed = await getFeed(service, ctx, { size: 5, lists: true })

  const popular = feed.popular
  return (
    <div className={`theme-civic min-h-dvh ${civicFontClasses}`}>
      <CivicHeader signedIn={!!user} avatarUrl={profile?.avatar_url ?? null} name={profile?.display_name ?? null} />

      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pt-7 pb-12 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 font-display text-[28px] leading-[1.1] sm:text-4xl">{popular ? 'Popular right now' : 'Here’s your page'}</h1>
            <p className="m-0 text-[15px] text-civic-muted sm:text-base">
              {popular ? 'Personalize it in about a minute.' : 'You can customize it anytime.'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Link
              href={popular ? '/welcome?step=1' : '/welcome?step=2'}
              className="flex min-h-11 items-center rounded-full border-[1.5px] border-civic-accent bg-civic-surface px-[18px] text-[15px] font-semibold text-civic-accent no-underline hover:bg-civic-accent-soft"
            >
              {popular ? 'Personalize' : 'Customize'}
            </Link>
            {!popular && <CustomizeHint />}
          </div>
        </div>

        {user && popular && <BuildFeedBanner />}
        {!user && !popular && <SaveFeedPrompt />}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] items-start gap-5">
          {feed.widgets.map((w) => (
            <WidgetSection key={w.key} widget={w} />
          ))}
        </div>

        {(!coverage.federal || !coverage.state) && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-dashed border-civic-dash bg-civic-sunken px-4 py-3.5">
            <ComingSoonPill />
            <span className="text-sm text-civic-muted">
              {!coverage.federal && !coverage.state
                ? 'Federal and New York State sections join your page automatically once we cover them.'
                : `${!coverage.federal ? 'Federal' : 'New York State'} sections join your page automatically once we cover them.`}
            </span>
          </div>
        )}
      </main>
    </div>
  )
}
