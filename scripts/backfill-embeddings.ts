// One-time backfill of content and topic embeddings (recommendations-plan.md §5.1).
// Safe to re-run: only items with no vector, or whose text changed, are embedded.
//
//   npm run backfill:embeddings
//
// Requires migration 022 and NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// and VOYAGE_API_KEY in .env.local.

import { createClient } from '@supabase/supabase-js'
import { embedAll } from '../src/lib/embeddings/embed-content'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')

  const supabase = createClient(url, key)
  const started = Date.now()

  const result = await embedAll(supabase, {
    onBatch: (embedded) => process.stdout.write(`\r  ${embedded} items embedded…`),
  })
  process.stdout.write('\n')

  if (result.error) throw new Error(result.error)
  console.log(`✅ ${result.model}: ${result.itemsEmbedded} items, ${result.topicsEmbedded} topics, ${result.tokens} tokens`)

  const [items, embeddings] = await Promise.all([
    supabase.from('content_items').select('*', { count: 'exact', head: true }),
    supabase.from('content_embeddings').select('*', { count: 'exact', head: true }).eq('model', result.model),
  ])
  console.log(`Coverage: ${embeddings.count ?? 0} / ${items.count ?? 0} items`)
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
