import type { SupabaseClient } from '@supabase/supabase-js'
import { createNycLegistarAdapter } from './adapters/nyc-legistar'
import { createNycLocalProposalsAdapter } from './adapters/nyc-local-proposals'
import { runIngest } from './run'
import type { IngestResult, SourceAdapter } from './types'

// Every registered source, by the cron that runs it. Adding a source = one
// adapter file + one line here + a row in the sources table.
type AdapterFactory = (supabase: SupabaseClient) => SourceAdapter<unknown>

// /api/cron/ingest-content (daily, after the Legistar sync)
const DAILY: AdapterFactory[] = [(s) => createNycLegistarAdapter(s) as SourceAdapter<unknown>]

// /api/cron/ingest-neighborhood (weekly: the DOT/ULURP data changes slowly, build plan §4.8)
const WEEKLY: AdapterFactory[] = [(s) => createNycLocalProposalsAdapter(s) as SourceAdapter<unknown>]

async function runAll(supabase: SupabaseClient, factories: AdapterFactory[]): Promise<IngestResult[]> {
  const results: IngestResult[] = []
  for (const factory of factories) {
    results.push(await runIngest(supabase, factory(supabase)))
  }
  return results
}

export function ingestAllSources(supabase: SupabaseClient): Promise<IngestResult[]> {
  return runAll(supabase, DAILY)
}

export function ingestNeighborhoodSources(supabase: SupabaseClient): Promise<IngestResult[]> {
  return runAll(supabase, WEEKLY)
}
