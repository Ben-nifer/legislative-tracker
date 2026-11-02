// NYC Open Data "Zoning Application Portal (ZAP) – BBL" (Socrata 2iga-a6mk) —
// one row per tax lot associated with a ZAP project (a rezoning can span
// many lots). Joined with PLUTO for real lat/long per lot.
const ZAP_BBL_URL = 'https://data.cityofnewyork.us/resource/2iga-a6mk.json'
const PLUTO_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json'

async function socrataFetch<T>(baseUrl: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(baseUrl)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) {
    url.searchParams.set('$$app_token', process.env.NYC_OPEN_DATA_APP_TOKEN)
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        next: { revalidate: 0 },
        headers: { 'User-Agent': 'legislative-tracker/1.0' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error(`Socrata API ${res.status}`)
      return res.json()
    } catch (e) {
      lastError = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  const cause = lastError instanceof Error ? (lastError.cause ?? lastError.message) : lastError
  throw new Error(`Socrata fetch failed after 3 attempts: ${String(cause)}`)
}

// Socrata `in(...)` clause value list, single-quoted and escaped.
function inList(values: string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')
}

/**
 * For a batch of ZAP project IDs, returns each project's centroid point
 * (averaged across all its validated tax lots) via the ZAP-BBL → PLUTO join.
 * Projects with no validated BBL rows, or whose BBLs don't resolve in
 * PLUTO, are simply absent from the result map.
 */
export async function lookupUlurpCentroids(
  projectIds: string[]
): Promise<Map<string, [number, number]>> {
  if (projectIds.length === 0) return new Map()

  const bblRows = await socrataFetch<{ project_id: string; bbl: string }>(ZAP_BBL_URL, {
    $where: `project_id in(${inList(projectIds)}) AND validated = true`,
    $select: 'project_id,bbl',
    $limit: '5000',
  })

  const bblsByProject = new Map<string, string[]>()
  const allBbls = new Set<string>()
  for (const row of bblRows) {
    const list = bblsByProject.get(row.project_id) ?? []
    list.push(row.bbl)
    bblsByProject.set(row.project_id, list)
    allBbls.add(row.bbl)
  }

  if (allBbls.size === 0) return new Map()

  const plutoRows = await socrataFetch<{ bbl: string; latitude: string; longitude: string }>(PLUTO_URL, {
    $where: `bbl in(${inList([...allBbls])})`,
    $select: 'bbl,latitude,longitude',
    $limit: '5000',
  })

  const pointByBbl = new Map<string, [number, number]>()
  for (const row of plutoRows) {
    const lat = Number(row.latitude)
    const lng = Number(row.longitude)
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
      pointByBbl.set(row.bbl, [lng, lat])
    }
  }

  const centroidByProject = new Map<string, [number, number]>()
  for (const [projectId, bbls] of bblsByProject) {
    const points = bbls.map((b) => pointByBbl.get(b)).filter((p): p is [number, number] => !!p)
    if (points.length === 0) continue
    const lng = points.reduce((s, p) => s + p[0], 0) / points.length
    const lat = points.reduce((s, p) => s + p[1], 0) / points.length
    centroidByProject.set(projectId, [lng, lat])
  }

  return centroidByProject
}
