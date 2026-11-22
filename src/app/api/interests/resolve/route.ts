import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { interestRateLimit } from '@/lib/rate-limit'
import { MAX_PHRASE_LENGTH, normalizePhrase, resolveInterest } from '@/lib/embeddings/interests'

// Onboarding S4: typed phrase → parsed topic + place (with coverage), the
// interest widget's first items, and tap-to-add topic suggestions
// (recommendations-planv1.2.md §5.3, §7.3). Open to guests; no address data accepted.
// When parsePending is true, a Haiku place parse runs after this response;
// calling again a few seconds later returns the re-ranked widget.

// Headroom for the background Haiku parse (and a Voyage call if its topic changed)
export const maxDuration = 30

const bodySchema = z.object({
  phrase: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PHRASE_LENGTH)
    .refine((p) => normalizePhrase(p).length > 0, 'Phrase has no words'),
  levels: z.array(z.enum(['federal', 'state', 'city', 'neighborhood'])).max(4).optional(),
  excludeTopicIds: z.array(z.uuid()).max(50).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const { success } = await interestRateLimit.limit(ip)
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const { phrase, levels, excludeTopicIds, limit } = parsed.data
  try {
    const result = await resolveInterest(createServiceClient(), phrase, {
      levels,
      excludeTopicIds,
      itemCount: limit,
      schedule: after,
    })
    return NextResponse.json({ ...result, matchCount: result.items.length })
  } catch (error) {
    console.error('Interest resolve failed:', error)
    return NextResponse.json({ error: 'Could not match that interest right now' }, { status: 502 })
  }
}
