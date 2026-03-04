import { NextResponse } from 'next/server'
import { fullSync } from '@/lib/legistar/sync'

export const maxDuration = 300 // 5 minutes — Vercel Pro allows up to 300s

export async function GET(request: Request) {
  // Verify this is an authorized cron request
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await fullSync()
    return NextResponse.json({ success: true, ...results })
  } catch (error) {
    console.error('Sync failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
