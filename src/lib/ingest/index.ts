import type { SupabaseClient } from '@supabase/supabase-js'
import { createNycLegistarAdapter } from './adapters/nyc-legistar'
import { createNycLocalProposalsAdapter } from './adapters/nyc-local-proposals'
import { runIngest } from './run'
import { resolveLandUseLocations } from './land-use-locations'
import type { IngestResult, SourceAdapter } from './types'

// Every registered source, by the cron that runs it. Adding a source = one
// adapter file + one line here + a row in the sources table.
type AdapterFactory = (supabase: SupabaseClient) => SourceAdapter<unknown>

// /api/cron/ingest-content (daily, after the Legistar and ZAP/DOT syncs). Legistar
// runs first so Land Use items carry their linked ZAP proposals before the
// proposals adapter folds them away.
const DAILY: AdapterFactory[] = [
  (s) => createNycLegistarAdapter(s) as SourceAdapter<unknown>,
  (s) => createNycLocalProposalsAdapter(s) as SourceAdapter<unknown>,
]

async function runAll(supabase: SupabaseClient, factories: AdapterFactory[]): Promise<IngestResult[]> {
  const results: IngestResult[] = []
  for (const factory of factories) {
    results.push(await runIngest(supabase, factory(supabase)))
  }
  return results
}

// New Land Use items get their location first (land-use-locations.ts). A failed
// lookup leaves them on council districts for a day rather than blocking ingest.
export async function ingestAllSources(supabase: SupabaseClient): Promise<IngestResult[]> {
  try {
    await resolveLandUseLocations(supabase, { limit: 200 })
  } catch (err) {
    console.error('Land Use locations failed:', err instanceof Error ? err.message : err)
  }
  return runAll(supabase, DAILY)
}
