import type {
  LegistarMatter,
  LegistarPerson,
  LegistarOfficeRecord,
  LegistarSponsor,
  LegistarHistory,
} from './types'

const BASE_URL = 'https://webapi.legistar.com/v1/nyc'

async function legistarFetch<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`)
  url.searchParams.set('token', process.env.LEGISTAR_API_TOKEN!)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url.toString(), { next: { revalidate: 0 } })
  if (!response.ok) {
    throw new Error(`Legistar API ${response.status}: ${path}`)
  }
  return response.json()
}

// Paginate through all results — API max is 1000 per page
async function legistarFetchAll<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const results: T[] = []
  let skip = 0
  const top = 1000

  while (true) {
    const page = await legistarFetch<T[]>(path, {
      ...params,
      '$top': String(top),
      '$skip': String(skip),
    })
    results.push(...page)
    if (page.length < top) break
    skip += top
  }

  return results
}

export const legistar = {
  getMatters: (params?: Record<string, string>) =>
    legistarFetchAll<LegistarMatter>('/matters', params),

  getMatterSponsors: (matterId: number) =>
    legistarFetch<LegistarSponsor[]>(`/matters/${matterId}/sponsors`),

  getMatterHistories: (matterId: number) =>
    legistarFetch<LegistarHistory[]>(`/matters/${matterId}/histories`),

  getPersons: () =>
    legistarFetchAll<LegistarPerson>('/persons'),

  getOfficeRecords: (params?: Record<string, string>) =>
    legistarFetchAll<LegistarOfficeRecord>('/officerecords', params),
}
