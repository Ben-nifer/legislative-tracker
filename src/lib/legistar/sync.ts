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

  // Pre-fetch existing districts so we can use the district thumbnail if available
  const { data: existingLegislators } = await supabase
    .from('legislators')
    .select('slug, district')

  const districtBySlug = new Map(
    (existingLegislators ?? [])
      .filter(l => l.district != null)
      .map(l => [l.slug, l.district as number])
  )

  const rows = relevantPersons.map(person => {
    const slug = toSlug(person.PersonFullName)
    const district = districtBySlug.get(slug)
    const photo_url = district != null
      ? `https://raw.githubusercontent.com/NewYorkCityCouncil/districts/master/thumbnails/district-${district}.jpg`
      : (person.PersonPhotoFileName
          ? `https://legistar.council.nyc.gov/Photos/${person.PersonPhotoFileName}`
          : null)
    return {
      legislature_id: legislature.id,
      legistar_id: person.PersonId,
      full_name: person.PersonFullName,
      slug,
      email: person.PersonEmail || null,
      is_active: person.PersonActiveFlag === 1,
      title: bestTitle(personTitles.get(person.PersonId) ?? ['Council Member']),
      photo_url,
    }
  })

  const { error } = await supabase
    .from('legislators')
    .upsert(rows, { onConflict: 'slug' })

  if (error) throw new Error(`Legislator sync failed: ${error.message}`)
  return rows.length
}

// Notify followers of legislation that changed status during sync
async function notifyStatusChanges(
  supabase: ReturnType<typeof createServiceClient>,
  batch: { slug: string; status: string; title: string; file_number: string }[],
  prevBySlug: Map<string, { id: string; slug: string; status: string }>
): Promise<void> {
  // Find slugs where status changed (skip newly inserted rows with no prev entry)
  const changedSlugs = batch
    .filter((r) => {
      const prev = prevBySlug.get(r.slug)
      return prev && prev.status !== r.status
    })
    .map((r) => r.slug)

  if (!changedSlugs.length) return

  // Get IDs for changed legislation (needed to look up followers)
  const { data: current } = await supabase
    .from('legislation')
    .select('id, slug, status, title, file_number')
    .in('slug', changedSlugs)

  for (const leg of current ?? []) {
    const { data: followers } = await supabase
      .from('legislation_follows')
      .select('user_id')
      .eq('legislation_id', leg.id)
      .eq('notify_updates', true)

    if (!followers?.length) continue

    await supabase.from('notifications').insert(
      followers.map((f) => ({
        user_id: f.user_id,
        type: 'legislation_update',
        title: `${leg.file_number} status updated`,
        body: leg.status,
        url: `/legislation/${leg.slug}`,
        legislation_id: leg.id,
      }))
    )
  }
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

  // Build committee map: legistar_body_id → UUID
  // Upsert all unique committees from this batch first
  const uniqueCommittees = new Map<number, string>() // bodyId → name
  for (const matter of matters) {
    if (matter.MatterBodyId && matter.MatterBodyName && !uniqueCommittees.has(matter.MatterBodyId)) {
      uniqueCommittees.set(matter.MatterBodyId, matter.MatterBodyName)
    }
  }

  const committeeRows = [...uniqueCommittees.entries()].map(([bodyId, name]) => ({
    name,
    slug: toSlug(name),
    legistar_body_id: bodyId,
    legislature_id: legislature.id,
  }))

  if (committeeRows.length > 0) {
    await supabase
      .from('committees')
      .upsert(committeeRows, { onConflict: 'legistar_body_id' })
  }

  // Fetch committee UUIDs after upsert
  const { data: committeeData } = await supabase
    .from('committees')
    .select('id, legistar_body_id')
    .not('legistar_body_id', 'is', null)

  const committeeIdMap = new Map<number, string>(
    (committeeData ?? []).map((c) => [c.legistar_body_id, c.id])
  )

  const rows = matters.map(matter => ({
    legislature_id: legislature.id,
    file_number: matter.MatterFile,
    slug: toSlug(matter.MatterFile),
    title: matter.MatterTitle || matter.MatterName || matter.MatterFile,
    status: matter.MatterStatusName || 'Unknown',
    type: mapType(matter.MatterTypeName),
    intro_date: parseLegistarDate(matter.MatterIntroDate),
    last_action_date: parseLegistarDate(matter.MatterAgendaDate),
    official_summary: matter.MatterText1 || null,
    legistar_url: `https://legistar.council.nyc.gov/gateway.aspx?m=l&id=${matter.MatterId}`,
    committee_id: matter.MatterBodyId ? (committeeIdMap.get(matter.MatterBodyId) ?? null) : null,
  }))

  // Upsert in batches of 200, detecting status changes for notifications
  const batchSize = 200
  let synced = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const batchSlugs = batch.map((r) => r.slug)

    // Snapshot current status for this batch before overwriting
    const { data: existing } = await supabase
      .from('legislation')
      .select('id, slug, status')
      .in('slug', batchSlugs)

    const prevBySlug = new Map((existing ?? []).map((e) => [e.slug, e]))

    const { error } = await supabase
      .from('legislation')
      .upsert(batch, { onConflict: 'slug' })
    if (error) throw new Error(`Legislation sync failed at batch ${i}: ${error.message}`)
    synced += Math.min(batchSize, rows.length - i)

    // Fire notifications for status changes — best-effort, don't block sync
    notifyStatusChanges(supabase, batch, prevBySlug).catch((err) =>
      console.error('Notification dispatch failed:', err)
    )
  }

  return synced
}

// Step 3: Sync sponsorships — offset-based pagination, 30 bills at a time.
// Returns offset to pass into the next call. Done when done=true.
export async function syncSponsorships(
  offset = 0,
  concurrency = 30
): Promise<{ synced: number; offset: number; total: number; done: boolean; apiFailed: number; unmatched: number; sponsorsFound: number; skipped: number }> {
  const supabase = createServiceClient()

  // Build legislator lookups: slug → id AND normalized name → id
  const { data: legislators } = await supabase
    .from('legislators')
    .select('id, slug, full_name')

  const legislatorBySlug = new Map(
    (legislators ?? []).map((l) => [l.slug, l.id])
  )
  const legislatorByName = new Map(
    (legislators ?? []).map((l) => [l.full_name.toLowerCase().trim(), l.id])
  )

  function findLegislator(sponsorName: string): string | undefined {
    // Try slug match first
    const bySlug = legislatorBySlug.get(toSlug(sponsorName))
    if (bySlug) return bySlug
    // Fall back to normalized name match
    return legislatorByName.get(sponsorName.toLowerCase().trim())
  }

  // Fetch a page of legislation with legistar URLs (oldest first — they reliably have sponsors)
  const { data: batch, count: total } = await supabase
    .from('legislation')
    .select('id, legistar_url', { count: 'exact' })
    .not('legistar_url', 'is', null)
    .not('intro_date', 'is', null)
    .order('intro_date', { ascending: true })
    .range(offset, offset + concurrency - 1)

  if (!batch || batch.length === 0) {
    return { synced: 0, offset, total: total ?? 0, done: true, apiFailed: 0, unmatched: 0, sponsorsFound: 0, skipped: 0 }
  }

  // Skip bills that already have sponsorships
  const batchIds = batch.map((b) => b.id)
  const { data: existingRows } = await supabase
    .from('sponsorships')
    .select('legislation_id')
    .in('legislation_id', batchIds)
  const alreadySynced = new Set((existingRows ?? []).map((e) => e.legislation_id))
  const toFetch = batch.filter((b) => !alreadySynced.has(b.id))
  const skipped = batch.length - toFetch.length

  if (toFetch.length === 0) {
    const nextOffset = offset + concurrency
    return { synced: 0, offset: nextOffset, total: total ?? 0, done: nextOffset >= (total ?? 0), apiFailed: 0, unmatched: 0, sponsorsFound: 0, skipped }
  }

  // Fetch sponsors for each bill concurrently
  const results = await Promise.allSettled(
    toFetch.map(async (item) => {
      const matterId = new URL(item.legistar_url!).searchParams.get('ID')
      if (!matterId) return []
      const sponsors = await legistar.getMatterSponsors(Number(matterId))
      return sponsors.map((s) => ({
        legislation_id: item.id,
        legislator_id: findLegislator(s.MatterSponsorName),
        sponsorName: s.MatterSponsorName,
        is_primary: s.MatterSponsorSequence === 1,
      }))
    })
  )

  // Collect valid rows and track misses
  const rows: { legislation_id: string; legislator_id: string; is_primary: boolean }[] = []
  let apiFailed = 0
  let unmatched = 0
  let sponsorsFound = 0

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      apiFailed++
      continue
    }
    for (const row of result.value) {
      sponsorsFound++
      if (row.legislator_id) {
        rows.push({ legislation_id: row.legislation_id, legislator_id: row.legislator_id, is_primary: row.is_primary })
      } else {
        unmatched++
      }
    }
  }

  if (rows.length > 0) {
    await supabase
      .from('sponsorships')
      .upsert(rows, { onConflict: 'legislation_id,legislator_id' })
  }

  const nextOffset = offset + concurrency
  const done = nextOffset >= (total ?? 0)

  return { synced: rows.length, offset: nextOffset, total: total ?? 0, done, apiFailed, unmatched, sponsorsFound, skipped }
}

// Step 4: Create empty stats rows for any legislation that doesn't have one yet
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

// Sync committee memberships for all active legislators
export async function syncCommitteeMemberships(): Promise<{
  processed: number
  membershipsFound: number
  committeesCreated: number
}> {
  const supabase = createServiceClient()

  const { data: legislators } = await supabase
    .from('legislators')
    .select('id, legistar_id, slug')
    .eq('is_active', true)
    .not('legistar_id', 'is', null)

  if (!legislators?.length) return { processed: 0, membershipsFound: 0, committeesCreated: 0 }

  // Pre-fetch existing committees keyed by legistar_body_id
  const { data: existingCommittees } = await supabase
    .from('committees')
    .select('id, legistar_body_id')
    .not('legistar_body_id', 'is', null)

  const committeeIdMap = new Map<number, string>(
    (existingCommittees ?? []).map(c => [c.legistar_body_id, c.id])
  )

  // Bodies that are NOT committees — exclude these
  const NON_COMMITTEE_BODIES = new Set(['City Council', 'Public Advocate'])

  let processed = 0
  let membershipsFound = 0
  let committeesCreated = 0

  // Process in batches of 10 to avoid overwhelming the API
  const batchSize = 10
  for (let i = 0; i < legislators.length; i += batchSize) {
    const batch = legislators.slice(i, i + batchSize)

    const results = await Promise.allSettled(
      batch.map(leg => legistar.getPersonOfficeRecords(leg.legistar_id!))
    )

    for (let j = 0; j < batch.length; j++) {
      const result = results[j]
      const leg = batch[j]
      if (result.status !== 'fulfilled') continue

      processed++

      const committeeRecords = result.value.filter(
        r => !NON_COMMITTEE_BODIES.has(r.OfficeRecordBodyName)
      )

      for (const record of committeeRecords) {
        membershipsFound++
        const { OfficeRecordBodyId, OfficeRecordBodyName, OfficeRecordTitle, OfficeRecordStartDate, OfficeRecordEndDate } = record

        // Look up or create the committee
        let committeeId = committeeIdMap.get(OfficeRecordBodyId)
        if (!committeeId) {
          const { data: newCommittee } = await supabase
            .from('committees')
            .upsert(
              { name: OfficeRecordBodyName, slug: toSlug(OfficeRecordBodyName), legistar_body_id: OfficeRecordBodyId },
              { onConflict: 'legistar_body_id' }
            )
            .select('id')
            .single()

          if (newCommittee?.id) {
            committeeId = newCommittee.id
            committeeIdMap.set(OfficeRecordBodyId, newCommittee.id)
            committeesCreated++
          }
        }

        if (!committeeId) continue

        await supabase.from('legislator_committee_memberships').upsert(
          {
            legislator_id: leg.id,
            committee_id: committeeId,
            is_chair: OfficeRecordTitle.toLowerCase().includes('chair'),
            start_date: parseLegistarDate(OfficeRecordStartDate),
            end_date: parseLegistarDate(OfficeRecordEndDate),
          },
          { onConflict: 'legislator_id,committee_id' }
        )
      }
    }
  }

  return { processed, membershipsFound, committeesCreated }
}

// Run the full initial sync in sequence
export async function fullSync(since = '2022-01-01') {
  console.log('Starting full sync...')

  const legislators = await syncCouncilMembers()
  console.log(`✅ Synced ${legislators} council members`)

  const legislation = await syncLegislation(since)
  console.log(`✅ Synced ${legislation} pieces of legislation`)

  const { synced: sponsorships } = await syncSponsorships()
  console.log(`✅ Synced ${sponsorships} sponsorships`)

  const stats = await initializeMissingStats()
  console.log(`✅ Initialized stats for ${stats} legislation items`)

  return { legislators, legislation, sponsorships, stats }
}
