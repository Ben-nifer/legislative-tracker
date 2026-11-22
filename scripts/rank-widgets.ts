// Runs the widget precompute once (recommendations-planv1.2.md §6.1), the same
// job as /api/cron/rank-widgets. Safe to re-run.
//
//   npm run rank:widgets
//
// Requires migrations 023–025 and NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local.

import { createClient } from '@supabase/supabase-js'
import { runPrecompute } from '../src/lib/ranking/precompute'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')

  const result = await runPrecompute(createClient(url, key))
  console.log(
    `✅ config v${result.configVersion}: ${result.items} items scored, ${result.widgets} widgets written, ` +
      `${result.removed} stale removed, ${(result.ms / 1000).toFixed(1)}s`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
