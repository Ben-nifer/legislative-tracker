// Loads the kept DOT/ULURP local_proposals into content_items as neighborhood
// items (onboarding-build-planv1.1.md §4.8). Same job as the weekly
// /api/cron/ingest-neighborhood; safe to re-run (unchanged items are skipped).
//
//   npm run backfill:neighborhood
//
// Requires migration 027 and the `nyc-local-proposals` source to be enabled
// (it ships disabled; the runner does nothing for a disabled source).

import { createClient } from '@supabase/supabase-js'
import { createNycLocalProposalsAdapter } from '../src/lib/ingest/adapters/nyc-local-proposals'
import { runIngest } from '../src/lib/ingest/run'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')

  const supabase = createClient(url, key)
  const started = Date.now()

  const { data: source } = await supabase.from('sources').select('id, enabled').eq('slug', 'nyc-local-proposals').single()
  if (!source) throw new Error('Source nyc-local-proposals not found: apply migration 027 first')
  if (!source.enabled) {
    console.warn('⚠️  nyc-local-proposals is disabled; nothing to do. Enable it in `sources` once Q8/Q5 are decided.')
    return
  }

  const result = await runIngest(supabase, createNycLocalProposalsAdapter(supabase))
  console.log(`✅ ${result.source}: ${result.written} written, ${result.unchanged} unchanged, ${result.skipped} skipped of ${result.seen} rows, ${result.removed} removed`)

  const [total, tagged, live] = await Promise.all([
    supabase.from('content_items').select('*', { count: 'exact', head: true }).eq('source_id', source.id),
    supabase
      .from('content_item_places')
      .select('content_item_id, content_items!inner(source_id)', { count: 'exact', head: true })
      .eq('place_type', 'neighborhood')
      .eq('content_items.source_id', source.id),
    supabase.rpc('coverage_levels'),
  ])
  console.log(`Items: ${total.count ?? 0} · neighborhood tags: ${tagged.count ?? 0}`)
  console.table(live.data ?? [])
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
