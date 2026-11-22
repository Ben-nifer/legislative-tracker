import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runPrecompute } from '@/lib/ranking/precompute'

export const maxDuration = 300

// Every 15 minutes (recommendations-planv1.2.md §6.1): importance for every
// live item, then every shared widget into widget_cache
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runPrecompute(createServiceClient())
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Widget precompute failed:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
