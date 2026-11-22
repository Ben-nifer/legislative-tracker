import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ingestNeighborhoodSources } from '@/lib/ingest'

export const maxDuration = 300

// Weekly: serves the kept DOT/ULURP local_proposals as neighborhood items
// (onboarding-build-planv1.1.md §4.8). Runs before embed-content and
// rank-widgets so new items are embedded and ranked the same morning.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await ingestNeighborhoodSources(createServiceClient())
    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('Neighborhood ingest failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Neighborhood ingest failed' },
      { status: 500 }
    )
  }
}
