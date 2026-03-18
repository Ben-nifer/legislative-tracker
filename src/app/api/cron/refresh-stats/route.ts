import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60 // 60s is enough for the stats refresh

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()
    const { error } = await supabase.rpc('refresh_legislation_stats')

    if (error) throw error

    return NextResponse.json({
      success: true,
      refreshed_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Stats refresh failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Refresh failed' },
      { status: 500 }
    )
  }
}
