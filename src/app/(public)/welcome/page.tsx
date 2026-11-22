import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { flags } from '@/lib/flags'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { GUEST_CONTEXT_COOKIE, emptyGuestContext, parseGuestContext } from '@/lib/onboarding/guest'
import { getCoverage } from '@/lib/onboarding/data/coverage'
import { getTopicChips } from '@/lib/onboarding/data/topics'
import { getRepresentatives } from '@/lib/onboarding/data/representatives'
import { loadUserSelections } from '@/lib/onboarding/data/selections'
import OnboardingFlow from '@/components/onboarding/flow/OnboardingFlow'
import { officeLine } from '@/components/onboarding/flow/format'
import type { FlowData, PoliticianInfo } from '@/components/onboarding/flow/types'

export const metadata: Metadata = {
  title: 'Build your feed — NYC Legislative Tracker',
  description: 'Pick what you want to keep up with: your city, your neighborhood, the people who represent you and the issues you care about.',
}

// Onboarding S0–S4 (build plan §3.1). Guests start from their session cookie;
// signed-in users from their saved follows (B8 "Build your feed").
export default async function WelcomePage() {
  if (!flags.newOnboarding) notFound()

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const service = createServiceClient()

  const initial = user
    ? await loadUserSelections(service, user.id)
    : parseGuestContext((await cookies()).get(GUEST_CONTEXT_COOKIE)?.value) ?? emptyGuestContext()

  const ntaCodes = [
    ...initial.places.filter((p) => p.type === 'neighborhood').map((p) => p.id),
    ...initial.jurisdictions.filter((j) => j.type === 'neighborhood').map((j) => j.id),
  ]
  const [coverage, chips, reps, places, legislators, topics] = await Promise.all([
    getCoverage(service),
    getTopicChips(service).catch(() => []),
    getRepresentatives(service, initial.places).catch(() => []),
    ntaCodes.length
      ? service.from('places').select('place_id, name').eq('place_type', 'neighborhood').in('place_id', ntaCodes)
      : Promise.resolve({ data: [] }),
    initial.legislatorIds.length
      ? service.from('legislators').select('id, full_name, title, district, photo_url, party').in('id', initial.legislatorIds)
      : Promise.resolve({ data: [] }),
    initial.topicIds.length ? service.from('topics').select('id, name').in('id', initial.topicIds) : Promise.resolve({ data: [] }),
  ])

  const data: FlowData = {
    initial,
    signedIn: !!user,
    coverage,
    chips,
    reps,
    placeNames: Object.fromEntries((places.data ?? []).map((p: { place_id: string; name: string }) => [p.place_id, p.name])),
    politicians: Object.fromEntries(
      (legislators.data ?? []).map((l: { id: string; full_name: string; title: string | null; district: string | null; photo_url: string | null; party: string | null }) => [
        l.id,
        { id: l.id, name: l.full_name, office: officeLine(l.title, l.district), party: l.party, photoUrl: l.photo_url } satisfies PoliticianInfo,
      ])
    ),
    topicNames: Object.fromEntries((topics.data ?? []).map((t: { id: string; name: string }) => [t.id, t.name])),
    steps: { politicians: flags.stepPoliticians, interests: flags.stepInterests },
  }

  return (
    <Suspense>
      <OnboardingFlow data={data} />
    </Suspense>
  )
}
