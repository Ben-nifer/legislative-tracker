import { createServiceClient } from '@/lib/supabase/server'
import { legistar } from './client'

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function parseLegistarDate(dateStr: string): string | null {
  if (!dateStr || dateStr.startsWith('0001-01-01')) return null
  return dateStr.split('T')[0]
}

function mapType(typeName: string): 'introduction' | 'resolution' | null {
  const lower = typeName.toLowerCase()
  if (lower.includes('introduction')) return 'introduction'
  if (lower.includes('resolution')) return 'resolution'
  return null
}

// Title priority — if someone has multiple office records, use the most specific title
const TITLE_PRIORITY: Record<string, number> = {
  'Speaker': 1,
  'Public Advocate': 2,
  'Majority Leader': 3,
  'Minority Leader': 4,
  'Deputy Speaker': 5,
  'Majority Whip': 6,
  'Minority Whip': 7,
  'Council Member': 8,
}

function bestTitle(titles: string[]): string {
  return titles.sort((a, b) => (TITLE_PRIORITY[a] ?? 99) - (TITLE_PRIORITY[b] ?? 99))[0] ?? 'Council Member'
}

// Step 1: Sync NYC Council members + Public Advocate into the legislators table
export async function syncCouncilMembers(): Promise<number> {
  const supabase = createServiceClient()

  const { data: legislature } = await supabase
    .from('legislatures')
    .select('id')
    .eq('slug', 'nyc-council')
    .single()

  if (!legislature) throw new Error('NYC Council legislature not found in DB')

  const [persons, councilRecords, paRecords] = await Promise.all([
    legistar.getPersons(),
    legistar.getOfficeRecords({ '$filter': "OfficeRecordBodyName eq 'City Council'" }),
    legistar.getOfficeRecords({ '$filter': "OfficeRecordBodyName eq 'Public Advocate'" }),
  ])

  // Build a map of personId → all their titles across relevant bodies
  const personTitles = new Map<number, string[]>()
  for (const record of [...councilRecords, ...paRecords]) {
    const title = record.OfficeRecordTitle || 'Council Member'
    const existing = personTitles.get(record.OfficeRecordPersonId) ?? []
    personTitles.set(record.OfficeRecordPersonId, [...existing, title])
  }

  const relevantPersonIds = new Set(personTitles.keys())
  const relevantPersons = persons.filter(p => relevantPersonIds.has(p.PersonId))

  const rows = relevantPersons.map(person => ({
    legislature_id: legislature.id,
    full_name: person.PersonFullName,
    slug: toSlug(person.PersonFullName),
    email: person.PersonEmail || null,
    is_active: person.PersonActiveFlag === 1,
    title: bestTitle(personTitles.get(person.PersonId) ?? ['Council Member']),
  }))

  const { error } = await supabase
    .from('legislators')
    .upsert(rows, { onConflict: 'slug' })

  if (error) throw new Error(`Legislator sync failed: ${error.message}`)
  return rows.length
}

// Step 2: Sync legislation from Legistar into the legislation table
export async function syncLegislation(since = '2022-01-01'): Promise<number> {
  const supabase = createServiceClient()

  const { data: legislature } = await supabase
    .from('legislatures')
    .select('id')
    .eq('slug', 'nyc-council')
    .single()

  if (!legislature) throw new Error('NYC Council legislature not found in DB')

  const matters = await legistar.getMatters({
    '$filter': `MatterIntroDate ge datetime'${since}'`,
    '$orderby': 'MatterIntroDate desc',
  })

  const rows = matters.map(matter => ({
    legislature_id: legislature.id,
    file_number: matter.MatterFile,
    slug: toSlug(matter.MatterFile),
    title: matter.MatterTitle || matter.MatterName,
    status: matter.MatterStatusName || 'Unknown',
    type: mapType(matter.MatterTypeName),
    intro_date: parseLegistarDate(matter.MatterIntroDate),
    last_action_date: parseLegistarDate(matter.MatterAgendaDate),
    official_summary: matter.MatterText1 || null,
    legistar_url: `https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=${matter.MatterId}`,
  }))

  // Upsert in batches of 200
  const batchSize = 200
  let synced = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await supabase
      .from('legislation')
      .upsert(rows.slice(i, i + batchSize), { onConflict: 'slug' })
    if (error) throw new Error(`Legislation sync failed at batch ${i}: ${error.message}`)
    synced += Math.min(batchSize, rows.length - i)
  }

  return synced
}

// Step 3: Create empty stats rows for any legislation that doesn't have one yet
export async function initializeMissingStats(): Promise<number> {
  const supabase = createServiceClient()

  const { data: legislation } = await supabase
    .from('legislation')
    .select('id')

  if (!legislation?.length) return 0

  const { data: existingStats } = await supabase
    .from('legislation_stats')
    .select('legislation_id')

  const existingIds = new Set((existingStats || []).map(s => s.legislation_id))
  const missing = legislation.filter(l => !existingIds.has(l.id))

  if (!missing.length) return 0

  const statsRows = missing.map(l => ({ legislation_id: l.id }))

  const batchSize = 500
  for (let i = 0; i < statsRows.length; i += batchSize) {
    await supabase
      .from('legislation_stats')
      .upsert(statsRows.slice(i, i + batchSize), { onConflict: 'legislation_id' })
  }

  return missing.length
}

// Run the full initial sync in sequence
export async function fullSync(since = '2022-01-01') {
  console.log('Starting full sync...')

  const legislators = await syncCouncilMembers()
  console.log(`✅ Synced ${legislators} council members`)

  const legislation = await syncLegislation(since)
  console.log(`✅ Synced ${legislation} pieces of legislation`)

  const stats = await initializeMissingStats()
  console.log(`✅ Initialized stats for ${stats} legislation items`)

  return { legislators, legislation, stats }
}
