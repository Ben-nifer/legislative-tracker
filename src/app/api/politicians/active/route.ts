import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { ACTIVE_POLITICIANS_KEY } from '@/lib/ranking/precompute'
import { type ActivePolitician, interleaveBodies } from '@/lib/ranking/politicians'

// Onboarding S3 "Active in your jurisdictions" (recommendations-planv1.2.md §6.7).
// Reads the list the 15-minute precompute caches. Open to guests.
//
//   GET /api/politicians/active?jurisdictions=city:nyc,neighborhood:BK0602&exclude=<uuid>,<uuid>
//
// jurisdictions: the user's selected place keys; none → all covered jurisdictions.
// exclude: the user's own representatives, already shown under "Your representatives".

const LIMIT = 8

// Which body covers a selected place. NYC Council is the only one with data today;
// NY State and Congress join here once their adapters exist.
const NYC_PLACE_TYPES = new Set(['city', 'borough', 'council_district', 'neighborhood', 'area'])
const BODY_FOR_PLACE: { matches: (type: string, id: string) => boolean; legislatureSlug: string }[] = [
  { matches: (type, id) => NYC_PLACE_TYPES.has(type) && (type !== 'city' || id === 'nyc'), legislatureSlug: 'nyc-council' },
]

const listParam = (max: number, item: z.ZodType<string, string>) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(item).max(max))

const querySchema = z.object({
  jurisdictions: listParam(50, z.string().regex(/^[a-z_]+:[A-Za-z0-9:_-]+$/)),
  exclude: listParam(50, z.uuid()),
})

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = querySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }
  const { jurisdictions, exclude } = parsed.data

  const supabase = createServiceClient()
  const [{ data: cached, error }, { data: legislatures }] = await Promise.all([
    supabase.from('widget_cache').select('items, config_version, computed_at').eq('widget_key', ACTIVE_POLITICIANS_KEY).maybeSingle(),
    supabase.from('legislatures').select('id, slug'),
  ])
  if (error) {
    console.error('Active politicians read failed:', error)
    return NextResponse.json({ error: 'Could not load politicians right now' }, { status: 502 })
  }

  const idBySlug = new Map((legislatures ?? []).map((l) => [l.slug as string, l.id as string]))
  let bodies: Set<string> | null = null // null = every covered body
  if (jurisdictions.length) {
    bodies = new Set()
    for (const key of jurisdictions) {
      const [type, ...rest] = key.split(':')
      for (const rule of BODY_FOR_PLACE) {
        const id = idBySlug.get(rule.legislatureSlug)
        if (id && rule.matches(type, rest.join(':'))) bodies.add(id)
      }
    }
  }

  const excluded = new Set(exclude)
  const candidates = ((cached?.items ?? []) as ActivePolitician[]).filter(
    (p) => !excluded.has(p.legislatorId) && (!bodies || bodies.has(p.legislatureId))
  )
  const politicians = interleaveBodies(candidates, LIMIT)

  return NextResponse.json(
    {
      heading: jurisdictions.length ? 'Active in your jurisdictions' : 'Active in New York',
      politicians,
      hasMore: candidates.length > politicians.length,
      configVersion: cached?.config_version ?? null,
      computedAt: cached?.computed_at ?? null,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
  )
}
