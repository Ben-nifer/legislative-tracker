// One-time backfill of content_items from the synced legislation table
// (recommendations-plan.md §4.2). Safe to re-run: unchanged items are skipped.
//
//   npm run backfill:content
//
// Requires migration 020 to be applied and NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY in .env.local.

import { createClient } from '@supabase/supabase-js'
import { createNycLegistarAdapter } from '../src/lib/ingest/adapters/nyc-legistar'
import { runIngest } from '../src/lib/ingest/run'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')

  const supabase = createClient(url, key)
  const started = Date.now()

  const result = await runIngest(supabase, createNycLegistarAdapter(supabase))
  console.log(`✅ ${result.source}: ${result.written} written, ${result.unchanged} unchanged, ${result.skipped} skipped of ${result.seen} rows, ${result.removed} removed`)
  if (result.unresolvedPeople) console.warn(`⚠️  ${result.unresolvedPeople} sponsors had no legislator_external_ids match`)
  if (result.unresolvedTopics) console.warn(`⚠️  ${result.unresolvedTopics} topic slugs had no topics match`)

  // Breakdown so the result can be sanity-checked against legislation counts
  const breakdown: Record<string, { total: number; live: number }> = {}
  for (const itemType of ['bill', 'resolution', 'project', 'hearing']) {
    const [total, live] = await Promise.all([
      supabase.from('content_items').select('*', { count: 'exact', head: true }).eq('item_type', itemType),
      supabase.from('content_items').select('*', { count: 'exact', head: true }).eq('item_type', itemType).eq('is_dead', false),
    ])
    breakdown[itemType] = { total: total.count ?? 0, live: live.count ?? 0 }
  }
  console.table(breakdown)

  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
