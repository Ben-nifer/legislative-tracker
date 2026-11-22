import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { eventsRateLimit } from '@/lib/rate-limit'
import { recordClick } from '@/lib/feed/impressions'
import { SESSION_ID_COOKIE, readSessionId } from '@/lib/onboarding/session'

// POST /api/feed/click (recommendations-planv1.2.md §3.5): a feed card was
// opened. Sent as a beacon; attached to this session's latest impression of
// that item in that widget.

const bodySchema = z.object({
  surface: z.enum(['home', 'onboarding_preview']),
  widget: z.string().min(1).max(200),
  itemId: z.uuid(),
  action: z.enum(['open', 'stance', 'bookmark', 'follow']).default('open'),
})

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const { success } = await eventsRateLimit.limit(ip)
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  // Impressions are keyed by `sid`; without it there's nothing to attach to
  const sessionId = readSessionId((await cookies()).get(SESSION_ID_COOKIE)?.value)
  if (!sessionId) return new NextResponse(null, { status: 204 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const recorded = await recordClick(createServiceClient(), { sessionId, ...parsed.data })
    return NextResponse.json({ recorded })
  } catch (error) {
    console.error('Feed click failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not record the click' }, { status: 500 })
  }
}
