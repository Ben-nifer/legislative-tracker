import type { SupabaseClient } from '@supabase/supabase-js'
import { createNycLegistarAdapter } from './adapters/nyc-legistar'
import { runIngest } from './run'
import type { IngestResult } from './types'

// Every registered source. Adding a source = one adapter file + one line here
// + a row in the sources table.
export async function ingestAllSources(supabase: SupabaseClient): Promise<IngestResult[]> {
  const adapters = [createNycLegistarAdapter(supabase)]

  const results: IngestResult[] = []
  for (const adapter of adapters) {
    results.push(await runIngest(supabase, adapter))
  }
  return results
}
