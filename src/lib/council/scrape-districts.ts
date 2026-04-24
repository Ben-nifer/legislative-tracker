import { createServiceClient } from '@/lib/supabase/server'

// ── Name normalization ──────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents (Cabán → caban)
    .replace(/['.,-]/g, '')           // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

// "First [Middle] Last" → "first last" (drops middle names/initials)
function firstLastKey(name: string): string {
  const parts = normalizeName(name)
    .split(' ')
    .filter(p => p.length > 1) // drop single-char middle initials
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1]}`
}

function lastNameKey(name: string): string {
  const parts = normalizeName(name).split(' ')
  return parts[parts.length - 1] ?? ''
}

// ── HTML parsing ────────────────────────────────────────────────────────────

function parseMemberName(html: string): string | null {
  // Standard format: <title>District N - Firstname Lastname</title>
  const match1 = html.match(/<title>District \d+\s*[-–]\s*([^<]+)<\/title>/)
  if (match1) return match1[1].trim()

  // Speaker/redirect format: <title>Home - Firstname Lastname</title>
  const match2 = html.match(/<title>Home\s*[-–]\s*([^<]+)<\/title>/)
  if (match2) return match2[1].trim()

  return null
}

function parseNeighborhoods(html: string): string[] {
  const match = html.match(
    /class="image-overlay-text district-neighborhoods[^"]*"[^>]*>([^<]+)</
  )
  if (!match) return []
  return match[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function parseCommunityBoards(html: string): string[] {
  const boards = new Set<string>()
  const re = /Community Board\s+(\d+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    boards.add(`Community Board ${m[1]}`)
  }
  return [...boards]
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function scrapeAndSyncDistrictData(): Promise<{
  processed: number
  failed: number
  errors: string[]
}> {
  const supabase = createServiceClient()

  // Pre-fetch all legislators so we can match by name, not just slug
  const { data: allLegislators } = await supabase
    .from('legislators')
    .select('id, full_name, slug')
    .eq('is_active', true)

  const legislators = allLegislators ?? []

  // Build lookup maps
  const bySlug = new Map<string, string>()           // slug → id
  const byFirstLast = new Map<string, string>()       // "first last" → id
  const byLastName = new Map<string, string[]>()      // "last" → [ids]

  for (const leg of legislators) {
    bySlug.set(leg.slug, leg.id)

    const fl = firstLastKey(leg.full_name)
    if (fl) byFirstLast.set(fl, leg.id)

    const ln = lastNameKey(leg.full_name)
    if (ln) {
      const existing = byLastName.get(ln) ?? []
      byLastName.set(ln, [...existing, leg.id])
    }
  }

  function findLegislatorId(scrapedName: string): string | null {
    // 1. Exact slug match (scraped name → slug)
    const scrapedSlug = normalizeName(scrapedName).replace(/\s+/g, '-')
    if (bySlug.has(scrapedSlug)) return bySlug.get(scrapedSlug)!

    // 2. First + last name match (ignores middle initials in either direction)
    const fl = firstLastKey(scrapedName)
    if (fl && byFirstLast.has(fl)) return byFirstLast.get(fl)!

    // 3. Last name match — only if unambiguous (exactly one legislator with that last name)
    const ln = lastNameKey(scrapedName)
    const lastMatches = byLastName.get(ln) ?? []
    if (lastMatches.length === 1) return lastMatches[0]!

    return null
  }

  let processed = 0
  let failed = 0
  const errors: string[] = []

  for (let district = 1; district <= 51; district++) {
    if (district > 1) await new Promise(r => setTimeout(r, 500))

    try {
      const res = await fetch(`https://council.nyc.gov/district-${district}/`, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NYCLegislativeTracker/1.0)' },
      })

      if (!res.ok) {
        errors.push(`District ${district}: HTTP ${res.status}`)
        failed++
        continue
      }

      const html = await res.text()

      const memberName = parseMemberName(html)
      if (!memberName) {
        errors.push(`District ${district}: could not parse member name from page title`)
        failed++
        continue
      }

      const legislatorId = findLegislatorId(memberName)
      if (!legislatorId) {
        errors.push(`District ${district} (${memberName}): no DB match found`)
        failed++
        continue
      }

      const neighborhoods = parseNeighborhoods(html)
      const community_boards = parseCommunityBoards(html)

      if (neighborhoods.length === 0) {
        errors.push(`District ${district} (${memberName}): no neighborhoods found`)
      }

      const { error } = await supabase
        .from('legislators')
        .update({ district, neighborhoods, community_boards })
        .eq('id', legislatorId)

      if (error) {
        errors.push(`District ${district} (${memberName}): DB update failed — ${error.message}`)
        failed++
        continue
      }

      console.log(`District ${district} (${memberName}): ${neighborhoods.length} neighborhoods, ${community_boards.length} community boards`)
      processed++
    } catch (e) {
      errors.push(`District ${district}: ${String(e)}`)
      failed++
    }
  }

  return { processed, failed, errors }
}
