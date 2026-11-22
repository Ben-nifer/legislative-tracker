import type { DotCapitalProject } from './types'

const BASE_URL = 'https://data.cityofnewyork.us/resource/jvk9-k4re.json'

async function fetchPage(limit: number, offset: number, whereClause: string): Promise<DotCapitalProject[]> {
  const url = new URL(BASE_URL)
  url.searchParams.set('$limit', String(limit))
  url.searchParams.set('$offset', String(offset))
  url.searchParams.set('$where', whereClause)
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) {
    url.searchParams.set('$$app_token', process.env.NYC_OPEN_DATA_APP_TOKEN)
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        next: { revalidate: 0 },
        headers: { 'User-Agent': 'legislative-tracker/1.0' },
        signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) {
        throw new Error(`DOT capital projects API ${response.status}`)
      }
      return response.json()
    } catch (e) {
      lastError = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }

  const cause = lastError instanceof Error ? (lastError.cause ?? lastError.message) : lastError
  throw new Error(`DOT capital projects API fetch failed after 3 attempts: ${String(cause)}`)
}

// Lexical comparison on a 4-digit-year text column — sorts correctly for
// any plausible year range. Keeps the dataset to recent/active projects.
const DEFAULT_WHERE = "the_geom IS NOT NULL AND constructi >= '2015'"

export async function fetchDotCapitalProjects(
  whereClause: string = DEFAULT_WHERE
): Promise<DotCapitalProject[]> {
  const results: DotCapitalProject[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const page = await fetchPage(limit, offset, whereClause)
    results.push(...page)
    if (page.length < limit) break
    offset += limit
  }

  return results
}
