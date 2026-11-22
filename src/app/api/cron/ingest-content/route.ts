import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ingestAllSources } from '@/lib/ingest'

export const maxDuration = 300

// Runs 15 minutes after sync-legislation, so it sees that run's rows
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await ingestAllSources(createServiceClient())
    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('Content ingest failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Content ingest failed' },
      { status: 500 }
    )
  }
}
