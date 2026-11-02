import type { ZapProject } from './types'

const BASE_URL = 'https://data.cityofnewyork.us/resource/hgx4-8ukb.json'

// Socrata SoQL pagination — $limit/$offset, same shape as Legistar's $top/$skip.
async function zapFetchPage(limit: number, offset: number, whereClause: string): Promise<ZapProject[]> {
  const url = new URL(BASE_URL)
  url.searchParams.set('$limit', String(limit))
  url.searchParams.set('$offset', String(offset))
  url.searchParams.set('$where', whereClause)
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) {
    url.searchParams.set('$$app_token', process.env.NYC_OPEN_DATA_APP_TOKEN)
  }

  const response = await fetch(url.toString(), { next: { revalidate: 0 } })
  if (!response.ok) {
    throw new Error(`ZAP API ${response.status}`)
  }
  return response.json()
}

// Only pull projects with a community district (required for map scoping)
// filed reasonably recently — the full ~33k-row history isn't useful for
// "what's happening in your neighborhood right now."
const DEFAULT_WHERE = "community_district IS NOT NULL AND app_filed_date >= '2015-01-01'"

export async function fetchZapProjects(whereClause: string = DEFAULT_WHERE): Promise<ZapProject[]> {
  const results: ZapProject[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const page = await zapFetchPage(limit, offset, whereClause)
    results.push(...page)
    if (page.length < limit) break
    offset += limit
  }

  return results
}
