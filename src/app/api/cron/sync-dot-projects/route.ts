import { NextResponse } from 'next/server'
import { syncDotCapitalProjects } from '@/lib/dot-projects/sync'

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await syncDotCapitalProjects()
    return NextResponse.json({ success: true, ...results })
  } catch (error) {
    console.error('DOT capital projects sync failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
