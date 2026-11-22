import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { eventsRateLimit } from '@/lib/rate-limit'
import { MAX_EVENTS_PER_BATCH, validateEvent } from '@/lib/analytics/events'
import { SESSION_ID_COOKIE, readSessionId } from '@/lib/onboarding/session'

// Batched spec §11 events from track() (onboarding-build-planv1.1.md §4.7).
// Each event must pass its allowlist schema; anything else is dropped, so no
// PII reaches analytics_events.

const MAX_BODY_BYTES = 32_000

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const { success } = await eventsRateLimit.limit(ip)
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  // The middleware sets `sid` on every page, so a request without one isn't from our pages
  const sessionId = readSessionId((await cookies()).get(SESSION_ID_COOKIE)?.value)
  if (!sessionId) return new NextResponse(null, { status: 204 })

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Too large' }, { status: 413 })

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const list = (raw as { events?: unknown })?.events
  if (!Array.isArray(list) || list.length > MAX_EVENTS_PER_BATCH) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const events = list.map(validateEvent).filter((e) => e !== null)
  if (!events.length) return new NextResponse(null, { status: 204 })

  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser()

  const { error } = await createServiceClient()
    .from('analytics_events')
    .insert(events.map((e) => ({ session_id: sessionId, user_id: user?.id ?? null, name: e.name, props: e.props })))
  if (error) {
    console.error('analytics_events insert failed:', error.message)
    return NextResponse.json({ error: 'Could not record events' }, { status: 500 })
  }

  return NextResponse.json({ accepted: events.length, rejected: list.length - events.length })
}
