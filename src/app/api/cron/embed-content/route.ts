import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { embedAll } from '@/lib/embeddings/embed-content'

export const maxDuration = 300

// Leave headroom under maxDuration for the last batch to finish
const TIME_BUDGET_MS = 240_000

// Runs 15 minutes after ingest-content (30 after sync-legislation), so new and
// re-summarized items from that run get vectors (recommendations-plan.md §5.1)
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await embedAll(createServiceClient(), { timeBudgetMs: TIME_BUDGET_MS })
  if (result.error) {
    console.error('Content embedding failed:', result.error)
    return NextResponse.json({ success: false, ...result }, { status: 500 })
  }
  return NextResponse.json({ success: true, ...result })
}
