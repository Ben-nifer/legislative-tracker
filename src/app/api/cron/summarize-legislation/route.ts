import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateSummaryAndTopics } from '@/lib/ai/summarize'

// Process up to 20 bills per run to stay within the 5-minute Vercel limit
const BATCH_SIZE = 20

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Fetch topics for classification
  const { data: topicsData } = await supabase
    .from('topics')
    .select('name, slug')

  const availableTopics = topicsData ?? []

  // Find bills that need summaries — no ai_summary, has a title, is an introduction
  const { data: bills, error } = await supabase
    .from('legislation')
    .select('id, slug, title, official_summary')
    .eq('type', 'introduction')
    .is('ai_summary', null)
    .not('title', 'is', null)
    .order('intro_date', { ascending: false })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('Failed to fetch unsummarized bills:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!bills || bills.length === 0) {
    return NextResponse.json({ success: true, processed: 0, message: 'All bills already summarized' })
  }

  let succeeded = 0
  let failed = 0

  for (const bill of bills) {
    try {
      const { summary, shortSummary, topicSlugs, error: aiError } = await generateSummaryAndTopics(
        bill.title,
        bill.official_summary,
        availableTopics
      )

      if (aiError || !summary) {
        console.warn(`[summarize] Skipped ${bill.slug}: ${aiError}`)
        failed++
        continue
      }

      // Save ai_summary + short_summary together
      await supabase
        .from('legislation')
        .update({ ai_summary: summary, short_summary: shortSummary ?? null })
        .eq('id', bill.id)

      // Wire up topic associations
      if (topicSlugs.length > 0) {
        const { data: matchedTopics } = await supabase
          .from('topics')
          .select('id')
          .in('slug', topicSlugs)

        if (matchedTopics && matchedTopics.length > 0) {
          await supabase
            .from('legislation_topics')
            .upsert(
              matchedTopics.map((t) => ({ legislation_id: bill.id, topic_id: t.id })),
              { onConflict: 'legislation_id,topic_id' }
            )
        }
      }

      succeeded++
    } catch (err) {
      console.error(`[summarize] Error processing ${bill.slug}:`, err)
      failed++
    }
  }

  return NextResponse.json({
    success: true,
    processed: bills.length,
    succeeded,
    failed,
  })
}
