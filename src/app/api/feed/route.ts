import { NextResponse, after } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server'
import { feedRateLimit } from '@/lib/rate-limit'
import { getFeed } from '@/lib/feed/getFeed'
import { contextFromGuest, loadUserContext } from '@/lib/feed/context'
import { GUEST_CONTEXT_COOKIE, guestContextSchema, parseGuestContext } from '@/lib/onboarding/guest'

// POST /api/feed (recommendations-planv1.2.md §7.3): the onboarding preview and
// client refreshes. `context` is the onboarding selection in progress (guest
// cookie shape, IDs only: no address data is accepted). Without it, signed-in
// users get their saved follows and guests their onb_ctx cookie.

export const maxDuration = 30 // headroom for an uncached typed interest

const bodySchema = z.object({
  context: guestContextSchema.optional(),
  size: z.number().int().min(1).max(10).default(3),
  lists: z.boolean().default(false),
  previous: z
    .object({
      widgets: z.array(z.string().max(200)).max(100),
      pairs: z.array(z.string().max(250)).max(500),
    })
    .optional(),
})

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const { success } = await feedRateLimit.limit(ip)
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }
  const { context, size, lists, previous } = parsed.data

  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser()
  const service = createServiceClient()

  const ctx = context
    ? contextFromGuest(context, user?.id ?? null)
    : user
      ? await loadUserContext(service, user.id)
      : contextFromGuest(parseGuestContext((await cookies()).get(GUEST_CONTEXT_COOKIE)?.value))

  try {
    return NextResponse.json(await getFeed(service, ctx, { size, lists, previous, schedule: after }))
  } catch (error) {
    console.error('Feed failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not load the feed right now' }, { status: 502 })
  }
}
