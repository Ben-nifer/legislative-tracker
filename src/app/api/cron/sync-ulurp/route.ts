import { NextResponse } from 'next/server'
import { syncUlurpProposals } from '@/lib/ulurp/sync'

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await syncUlurpProposals()
    return NextResponse.json({ success: true, ...results })
  } catch (error) {
    console.error('ULURP sync failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
