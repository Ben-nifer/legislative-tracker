import { NextResponse } from 'next/server'
import { redis } from '@/lib/rate-limit'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await redis.set('cron:keepalive', new Date().toISOString())

    return NextResponse.json({
      success: true,
      pinged_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Keepalive ping failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Keepalive failed' },
      { status: 500 }
    )
  }
}
