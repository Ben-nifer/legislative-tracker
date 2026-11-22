import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeNycAddress } from '../geo/geoclient'
import { inList, socrataFetch } from '../ulurp/bbl'

// Where each Council Land Use item is (migration 027, land_use_locations), so
// it reaches neighborhood widgets and links to its ZAP proposal. Resolved once
// per item from its title, before the Legistar ingest reads the table:
//   "Application number C 260193 HAX (…)"  → ZAP project → its tax lots → PLUTO points
//     (by application number; else by the exact project name, when one ZAP project has it)
//   "Block 2109, Lot 17; …, Manhattan"     → PLUTO points
//   "…sidewalk café located at 749 Ninth Avenue, … Borough of Manhattan" → Geoclient
// Points become NTA codes in SQL (ntas_at_points). Nothing else is placed: a
// historic district or a citywide text amendment has no single location.

const ZAP_PROJECTS_URL = 'https://data.cityofnewyork.us/resource/hgx4-8ukb.json'
const ZAP_BBL_URL = 'https://data.cityofnewyork.us/resource/2iga-a6mk.json'
const PLUTO_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json'
const ZAP_KEYS_PER_QUERY = 15
const BBLS_PER_QUERY = 200

export type LocationMethod = 'zap' | 'block_lot' | 'address' | 'none'

export interface LandUseLocation {
  file_number: string
  method: LocationMethod
  zap_project_id: string | null
  bbls: string[]
  nta_codes: string[]
}

const BOROUGH_CODES: [RegExp, string][] = [
  [/\bmanhattan\b/i, '1'],
  [/\bbronx\b/i, '2'],
  [/\bbrooklyn\b/i, '3'],
  [/\bqueens\b/i, '4'],
  [/\bstaten island\b/i, '5'],
]

// "C 260193 HAX", "N 250330 ZRQ", "C 240123(A) ZMK" → "260193HAX": the key ZAP's
// ulurp_numbers uses, without the prefix letter (ZAP drops the C)
export function applicationKey(title: string): string | null {
  const m = title.match(/^Application (?:number|No\.?)\s+[A-Z]{1,3}\s?(\d{6})(?:[A-Z]|\s?\([A-Z]\))?\s?([A-Z]{3})\b/i)
  return m ? `${m[1]}${m[2].toUpperCase()}` : null
}

// "Application number C 260060 ZMM (Dewitt Clinton Park North (629 West 54th Street)) submitted…"
// → "Dewitt Clinton Park North (629 West 54th Street)". Skips "(DL 547, LP 2692)"-style references.
export function projectName(title: string): string | null {
  const start = title.match(/^Application (?:number|No\.?)\s+[^(]*/i)
  if (!start) return null
  let i = start[0].length
  while (title[i] === '(') {
    let depth = 0
    let j = i
    for (; j < title.length; j++) {
      if (title[j] === '(') depth++
      else if (title[j] === ')' && --depth === 0) break
    }
    const name = title.slice(i + 1, j).trim()
    if (!/^(?:DL|LP)\s?\d/i.test(name)) return name || null
    i = j + 1
    while (title[i] === ' ') i++
  }
  return null
}

// ZAP's "260190ZSX; N260191ZCX; 260192LDX" → its keys
export function zapKeys(ulurpNumbers: string | null | undefined): string[] {
  return [...(ulurpNumbers ?? '').toUpperCase().matchAll(/(\d{6})\s?(?:\([A-Z]\)\s?)?([A-Z]{3})/g)].map((m) => `${m[1]}${m[2]}`)
}

// "Block 2265 Lots 2 and 3; Block 2282, Lot 12, Bronx" → BBLs ("2022650002", …).
// The borough is the last borough name in the title.
export function blockLotBbls(title: string): string[] {
  let borough: string | null = null
  let at = -1
  for (const [re, code] of BOROUGH_CODES) {
    const global = new RegExp(re.source, 'gi')
    for (const m of title.matchAll(global)) if (m.index! > at) [borough, at] = [code, m.index!]
  }
  if (!borough) return []
  const bbls: string[] = []
  for (const m of title.matchAll(/Block\s+(\d{1,5}),?\s+Lots?\s+([\d,\s]+(?:(?:and|&)\s+\d+)?)/gi)) {
    for (const lot of m[2].match(/\d+/g) ?? []) {
      if (lot.length <= 4) bbls.push(`${borough}${m[1].padStart(5, '0')}${lot.padStart(4, '0')}`)
    }
  }
  return [...new Set(bbls)]
}

// Sidewalk cafés: "located at 749 Ninth Avenue, New York, NY 10019, Borough of Manhattan" → "749 Ninth Avenue, 10019"
export function cafeAddress(title: string): string | null {
  const m = title.match(/located at ([^,;]+),[^;]*?\bNY\s+(\d{5})/i)
  return m ? `${m[1].trim()}, ${m[2]}` : null
}

const plutoBbl = (bbl: string) => bbl.split('.')[0]

export async function zapProjectsByKey(keys: string[]): Promise<Map<string, string>> {
  const byKey = new Map<string, string>()
  for (let i = 0; i < keys.length; i += ZAP_KEYS_PER_QUERY) {
    const batch = keys.slice(i, i + ZAP_KEYS_PER_QUERY)
    const rows = await socrataFetch<{ project_id: string; ulurp_numbers?: string }>(ZAP_PROJECTS_URL, {
      $select: 'project_id,ulurp_numbers',
      $where: batch.map((k) => `ulurp_numbers like '%${k}%'`).join(' OR '),
      $limit: '1000',
    })
    const wanted = new Set(batch)
    for (const r of rows) {
      for (const k of zapKeys(r.ulurp_numbers)) if (wanted.has(k) && !byKey.has(k)) byKey.set(k, r.project_id.replace(/^P/, ''))
    }
  }
  return byKey
}

// Exact (case-insensitive) project names → project ID, only where one ZAP project has the name
export async function zapProjectsByName(names: string[]): Promise<Map<string, string>> {
  const byName = new Map<string, string>()
  for (let i = 0; i < names.length; i += ZAP_KEYS_PER_QUERY) {
    const batch = names.slice(i, i + ZAP_KEYS_PER_QUERY).map((n) => n.toUpperCase())
    const rows = await socrataFetch<{ project_id: string; project_name?: string }>(ZAP_PROJECTS_URL, {
      $select: 'project_id,project_name',
      $where: `upper(project_name) in(${inList(batch)})`,
      $limit: '1000',
    })
    const ids = new Map<string, Set<string>>()
    for (const r of rows) {
      const name = r.project_name?.toUpperCase()
      if (name) ids.set(name, (ids.get(name) ?? new Set()).add(r.project_id.replace(/^P/, '')))
    }
    for (const [name, set] of ids) if (set.size === 1) byName.set(name, [...set][0])
  }
  return byName
}

export async function zapBbls(projectIds: string[]): Promise<Map<string, string[]>> {
  const byProject = new Map<string, string[]>()
  for (let i = 0; i < projectIds.length; i += 50) {
    const batch = projectIds.slice(i, i + 50)
    // The BBL dataset writes some IDs with a P prefix and some without
    const rows = await socrataFetch<{ project_id: string; bbl: string }>(ZAP_BBL_URL, {
      $select: 'project_id,bbl',
      $where: `project_id in(${inList(batch.flatMap((id) => [id, `P${id}`]))})`,
      $limit: '5000',
    })
    for (const r of rows) {
      if (!r.project_id || !r.bbl) continue
      const id = r.project_id.replace(/^P/, '')
      byProject.set(id, [...(byProject.get(id) ?? []), r.bbl])
    }
  }
  return byProject
}

export async function plutoPoints(bbls: string[]): Promise<Map<string, [number, number]>> {
  const points = new Map<string, [number, number]>()
  for (let i = 0; i < bbls.length; i += BBLS_PER_QUERY) {
    const rows = await socrataFetch<{ bbl: string; latitude?: string; longitude?: string }>(PLUTO_URL, {
      $select: 'bbl,latitude,longitude',
      $where: `bbl in(${inList(bbls.slice(i, i + BBLS_PER_QUERY))})`,
      $limit: '5000',
    })
    for (const r of rows) {
      const lat = Number(r.latitude)
      const lng = Number(r.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) points.set(plutoBbl(r.bbl), [lng, lat])
    }
  }
  return points
}

async function ntasAt(supabase: SupabaseClient, points: [number, number][]): Promise<string[]> {
  if (!points.length) return []
  const { data, error } = await supabase.rpc('ntas_at_points', { p_lngs: points.map((p) => p[0]), p_lats: points.map((p) => p[1]) })
  if (error) throw new Error(`ntas_at_points failed: ${error.message}`)
  return (data as string[] | null) ?? []
}

export interface ResolveResult {
  resolved: number
  byMethod: Record<LocationMethod, number>
}

// Resolves Land Use items that have no row yet (or every one with `all`).
export async function resolveLandUseLocations(
  supabase: SupabaseClient,
  opts: { limit?: number; all?: boolean } = {}
): Promise<ResolveResult> {
  const items: { file_number: string; title: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('legislation')
      .select('file_number, title')
      .like('file_number', 'LU %')
      .order('file_number', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`Land Use read failed: ${error.message}`)
    items.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  let pending = items
  if (!opts.all) {
    const { data, error } = await supabase.from('land_use_locations').select('file_number')
    if (error) throw new Error(`land_use_locations read failed: ${error.message}`)
    const done = new Set((data ?? []).map((r) => r.file_number as string))
    pending = items.filter((i) => !done.has(i.file_number))
  }
  pending = pending.slice(0, opts.limit ?? pending.length)
  const byMethod: Record<LocationMethod, number> = { zap: 0, block_lot: 0, address: 0, none: 0 }
  if (!pending.length) return { resolved: 0, byMethod }

  const keys = new Map(pending.map((i) => [i.file_number, applicationKey(i.title)]))
  const byKey = await zapProjectsByKey([...new Set([...keys.values()].filter((k): k is string => !!k))])
  const unmatched = pending.filter((i) => !byKey.has(keys.get(i.file_number) ?? ''))
  const names = new Map(unmatched.map((i) => [i.file_number, projectName(i.title)]))
  const byName = await zapProjectsByName([...new Set([...names.values()].filter((n): n is string => !!n))])
  const projectOf = (file: string) => byKey.get(keys.get(file) ?? '') ?? byName.get(names.get(file)?.toUpperCase() ?? '')
  const projectIds = [...new Set([...byKey.values(), ...byName.values()])]
  const bblsByProject = await zapBbls(projectIds)

  const bblsByFile = new Map<string, string[]>()
  for (const item of pending) {
    const project = projectOf(item.file_number)
    bblsByFile.set(item.file_number, project ? (bblsByProject.get(project) ?? []) : blockLotBbls(item.title))
  }
  const points = await plutoPoints([...new Set([...bblsByFile.values()].flat())])

  const rows: LandUseLocation[] = []
  for (const item of pending) {
    const project = projectOf(item.file_number) ?? null
    const bbls = bblsByFile.get(item.file_number) ?? []
    let ntaCodes = await ntasAt(supabase, bbls.map((b) => points.get(b)).filter((p): p is [number, number] => !!p))
    let method: LocationMethod = ntaCodes.length ? (project ? 'zap' : 'block_lot') : 'none'

    if (!ntaCodes.length) {
      const address = cafeAddress(item.title)
      if (address) {
        const geo = await geocodeNycAddress(address)
        if (geo.status === 'ok' && geo.districts.ntaCode) {
          ntaCodes = [geo.districts.ntaCode]
          method = 'address'
        }
      }
    }
    byMethod[method]++
    rows.push({ file_number: item.file_number, method, zap_project_id: project, bbls, nta_codes: ntaCodes })
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('land_use_locations')
      .upsert(rows.slice(i, i + 500).map((r) => ({ ...r, resolved_at: new Date().toISOString() })), { onConflict: 'file_number' })
    if (error) throw new Error(`land_use_locations write failed: ${error.message}`)
  }
  return { resolved: rows.length, byMethod }
}
