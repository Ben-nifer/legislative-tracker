import { NextResponse } from 'next/server'
import { fullSync, syncEvents } from '@/lib/legistar/sync'

export const maxDuration = 300 // 5 minutes — Vercel Pro allows up to 300s

export async function GET(request: Request) {
  // Verify this is an authorized cron request
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await fullSync()

    // Upcoming hearings feed next_event_at in the content layer. Best-effort:
    // a Legistar events failure shouldn't fail the whole sync.
    let events: Awaited<ReturnType<typeof syncEvents>> | { error: string }
    try {
      events = await syncEvents()
    } catch (err) {
      console.error('Events sync failed:', err)
      events = { error: err instanceof Error ? err.message : 'Events sync failed' }
    }

    return NextResponse.json({ success: true, ...results, events })
  } catch (error) {
    console.error('Sync failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
