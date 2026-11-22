import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateProposalSummary } from '@/lib/ai/summarize-proposal'

// Process up to 25 proposals per run to stay within the 5-minute Vercel limit
const BATCH_SIZE = 25

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const { data: proposals, error } = await supabase
    .from('local_proposals')
    .select('id, title, description, proposal_family')
    .is('ai_summary', null)
    .order('last_action_date', { ascending: false })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('Failed to fetch unsummarized proposals:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!proposals || proposals.length === 0) {
    return NextResponse.json({ success: true, processed: 0, message: 'All proposals already summarized' })
  }

  let succeeded = 0
  let failed = 0

  for (const proposal of proposals) {
    try {
      const { summary, error: aiError } = await generateProposalSummary(
        proposal.title,
        proposal.description,
        proposal.proposal_family as 'ulurp' | 'dot'
      )

      if (aiError || !summary) {
        console.warn(`[summarize-proposals] Skipped ${proposal.id}: ${aiError}`)
        failed++
        continue
      }

      await supabase.from('local_proposals').update({ ai_summary: summary }).eq('id', proposal.id)
      succeeded++
    } catch (err) {
      console.error(`[summarize-proposals] Error processing ${proposal.id}:`, err)
      failed++
    }
  }

  return NextResponse.json({
    success: true,
    processed: proposals.length,
    succeeded,
    failed,
  })
}
