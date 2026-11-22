// Generates the `places` gazetteer seed for migration 023 (recommendations-planv1.2.md §3.6, D26).
// Prints SQL to stdout; the output is pasted into 023_shared_widgets.sql. Re-run only if the
// alias rules below change (NTA 2020 codes are fixed).
//
//   npx tsx scripts/generate-places-seed.ts > /tmp/places-seed.sql
//   npx tsx --env-file=.env.local scripts/generate-places-seed.ts --apply   (upserts the same rows via the service role)
//
// Sources: NYC Open Data "2020 Neighborhood Tabulation Areas" (9nt8-h7nd), plus the hand lists below.

import { createClient } from '@supabase/supabase-js'
import { normalizePhrase } from '../src/lib/embeddings/normalize'

interface NtaRow {
  nta2020: string
  ntaname: string
  boroname: string
}

interface PlaceRow {
  placeType: string
  placeId: string
  name: string
  aliases: string[]
  parentPlace: string | null
  members: string[] | null
  covered: boolean
}

const BOROUGHS: Record<string, { id: string; aliases: string[] }> = {
  Manhattan: { id: 'MN', aliases: ['new york county'] },
  Bronx: { id: 'BX', aliases: ['the bronx', 'bronx county'] },
  Brooklyn: { id: 'BK', aliases: ['kings county'] },
  Queens: { id: 'QN', aliases: ['queens county'] },
  'Staten Island': { id: 'SI', aliases: ['richmond county'] },
}

// Council district → the borough holding most of it. 8 (MN/BX) and 34 (BK/QN) straddle a line.
function districtBorough(n: number): string {
  if (n <= 10) return 'MN'
  if (n <= 18) return 'BX'
  if (n <= 32) return 'QN'
  if (n <= 48) return 'BK'
  return 'SI'
}

// Postal codes are left out of aliases: most collide with words once lowercased ("in", "or", "me").
const STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York State'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington State'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['DC', 'Washington, D.C.'],
]
const STATE_ALIASES: Record<string, string[]> = {
  NY: ['ny state', 'nys', 'albany'],
  WA: ['washington'],
  DC: ['dc', 'washington dc', 'district of columbia'],
}

// Hyphens inside a single name, not between NTA pieces ("Bedford-Stuyvesant" isn't "Bedford" + "Stuyvesant")
const ONE_NAME = [/Bedford-Stuyvesant/g, /Green-Wood/g, /Co-op/g]
// Pieces that mean something else on their own
const JUNK_PARTS = new Set(['corona park'])

// A name shared by NTAs in different boroughs goes to the better-known one; the rest are dropped
const CROSS_BOROUGH_PICK: Record<string, string> = {
  'murray hill': 'MN0603',
  chelsea: 'MN0401',
}

// Colloquial names (spec §3). Keys are NTA codes, or area names generated below.
const HAND_ALIASES: Record<string, string[]> = {
  MN0101: ['fidi'],
  MN0302: ['les'],
  MN0402: ['hells kitchen'],
  QN0201: ['lic'],
  'upper west side': ['uws'],
  'upper east side': ['ues'],
  'bedford stuyvesant': ['bed stuy', 'bedstuy'],
  rockaway: ['rockaways', 'the rockaways'],
}

const qualifier = /\s*\((north|south|east|west|central)\)/gi

function sqlText(s: string) {
  return `'${s.replace(/'/g, "''")}'`
}
function sqlArray(xs: string[] | null) {
  if (!xs) return 'null'
  return xs.length ? `array[${xs.map(sqlText).join(', ')}]` : "'{}'::text[]"
}

async function main() {
  const res = await fetch(
    'https://data.cityofnewyork.us/resource/9nt8-h7nd.json?$select=nta2020,ntaname,boroname&$limit=500'
  )
  if (!res.ok) throw new Error(`Open Data ${res.status}`)
  const ntas = ((await res.json()) as NtaRow[]).sort((a, b) => a.nta2020.localeCompare(b.nta2020))

  const rows: PlaceRow[] = [
    { placeType: 'federal', placeId: 'us', name: 'Federal', aliases: ['federal', 'national', 'nationwide', 'united states', 'usa', 'congress'], parentPlace: null, members: null, covered: false },
    // Bare "New York" means the city: NYC is what we cover (build decision, see §14)
    { placeType: 'city', placeId: 'nyc', name: 'New York City', aliases: ['nyc', 'new york city', 'new york', 'ny city', 'the five boroughs', 'citywide'], parentPlace: null, members: null, covered: true },
  ]

  for (const [code, name] of STATES) {
    const aliases = [normalizePhrase(name), ...(STATE_ALIASES[code] ?? [])]
    rows.push({ placeType: 'state', placeId: code, name, aliases: [...new Set(aliases)], parentPlace: null, members: null, covered: false })
  }

  for (const [name, b] of Object.entries(BOROUGHS)) {
    rows.push({ placeType: 'borough', placeId: b.id, name, aliases: [normalizePhrase(name), ...b.aliases], parentPlace: 'city:nyc', members: null, covered: true })
  }

  for (let n = 1; n <= 51; n++) {
    rows.push({
      placeType: 'council_district',
      placeId: String(n),
      name: `Council District ${n}`,
      aliases: [`council district ${n}`, `district ${n}`],
      parentPlace: `borough:${districtBorough(n)}`,
      members: null,
      covered: true,
    })
  }

  // Alias candidates per NTA: full name without qualifiers, plus each run of hyphen pieces
  const boroughOf = new Map<string, string>()
  const byAlias = new Map<string, Set<string>>()
  for (const nta of ntas) {
    boroughOf.set(nta.nta2020, BOROUGHS[nta.boroname].id)
    const name = ONE_NAME.reduce((n, re) => n.replace(re, (m) => m.replace('-', ' ')), nta.ntaname)
    const parts = name.replace(qualifier, '').split('-').map((p) => p.trim())
    const candidates = new Set<string>()
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j <= parts.length; j++) candidates.add(normalizePhrase(parts.slice(i, j).join(' ')))
    }
    for (const c of candidates) {
      if (!c || JUNK_PARTS.has(c)) continue
      if (!byAlias.has(c)) byAlias.set(c, new Set())
      byAlias.get(c)!.add(nta.nta2020)
    }
  }

  const ntaAliases = new Map<string, string[]>(ntas.map((n) => [n.nta2020, []]))
  const areas = new Map<string, string[]>() // alias → member NTA codes (same borough)
  for (const [alias, codes] of byAlias) {
    const list = [...codes]
    if (list.length === 1) {
      ntaAliases.get(list[0])!.push(alias)
    } else if (CROSS_BOROUGH_PICK[alias]) {
      ntaAliases.get(CROSS_BOROUGH_PICK[alias])!.push(alias)
    } else if (new Set(list.map((c) => boroughOf.get(c))).size === 1) {
      areas.set(alias, list.sort())
    }
    // Otherwise it spans boroughs with no obvious pick (cemeteries, Jamaica Bay): dropped
  }
  areas.set('bedford stuyvesant', ['BK0301', 'BK0302'])
  areas.set('rockaway', ['QN1401', 'QN1402', 'QN1403'])

  for (const nta of ntas) {
    const aliases = [...ntaAliases.get(nta.nta2020)!, ...(HAND_ALIASES[nta.nta2020] ?? [])]
    rows.push({
      placeType: 'neighborhood',
      placeId: nta.nta2020,
      name: nta.ntaname,
      aliases: [...new Set(aliases)].sort(),
      parentPlace: `borough:${boroughOf.get(nta.nta2020)}`,
      members: null,
      covered: true,
    })
  }

  // Areas: a common name covering several NTAs ("Harlem", "Astoria"). Matching one filters to all members.
  for (const [alias, codes] of [...areas].sort(([a], [b]) => a.localeCompare(b))) {
    const borough = boroughOf.get(codes[0])!
    const name = alias.replace(/\b\w/g, (c) => c.toUpperCase())
    rows.push({
      placeType: 'area',
      placeId: `${borough}:${alias.replace(/ /g, '-')}`,
      name: alias === 'bedford stuyvesant' ? 'Bedford-Stuyvesant' : name,
      aliases: [...new Set([alias, ...(HAND_ALIASES[alias] ?? [])])],
      parentPlace: `borough:${borough}`,
      members: codes.map((c) => `neighborhood:${c}`),
      covered: true,
    })
  }

  if (process.argv.includes('--apply')) {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { error } = await supabase.from('places').upsert(
      rows.map((r) => ({
        place_type: r.placeType,
        place_id: r.placeId,
        name: r.name,
        aliases: r.aliases,
        parent_place: r.parentPlace,
        members: r.members,
        covered: r.covered,
      })),
      { onConflict: 'place_type,place_id' }
    )
    if (error) throw new Error(`Upsert failed: ${error.message}`)
    console.error(`Upserted ${rows.length} places`)
    return
  }

  console.log('insert into places (place_type, place_id, name, aliases, parent_place, members, covered) values')
  console.log(
    rows
      .map((r) => `  (${sqlText(r.placeType)}, ${sqlText(r.placeId)}, ${sqlText(r.name)}, ${sqlArray(r.aliases)}, ${r.parentPlace ? sqlText(r.parentPlace) : 'null'}, ${sqlArray(r.members)}, ${r.covered})`)
      .join(',\n')
  )
  console.log('on conflict (place_type, place_id) do update set')
  console.log('  name = excluded.name, aliases = excluded.aliases, parent_place = excluded.parent_place,')
  console.log('  members = excluded.members, covered = excluded.covered;')
  console.error(`${rows.length} places (${ntas.length} NTAs, ${areas.size} areas)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
