import { describe, expect, it, vi } from 'vitest'
import { geocodeNycAddress, parseGeoclientResponse } from './geoclient'
import responses from './fixtures/geoclient-responses.json'

// Recorded Geoclient v2 responses, trimmed to the fields we read (no coordinates)

describe('parseGeoclientResponse', () => {
  it('reads districts and the NTA 2020 code from an exact match', () => {
    expect(parseGeoclientResponse(responses['park-slope'])).toEqual({
      status: 'ok',
      districts: {
        councilDistrict: '39',
        stateSenateDistrict: '26',
        assemblyDistrict: '52',
        congressionalDistrict: '10',
        ntaCode: 'BK0602',
        borough: 'BK',
        communityDistrict: '306',
      },
    })
  })

  it('accepts a possible match that has a council district, stripping zero padding', () => {
    const result = parseGeoclientResponse(responses['times-square'])
    expect(result).toMatchObject({ status: 'ok', districts: { councilDistrict: '3', ntaCode: 'MN0502', borough: 'MN' } })
  })

  it('treats a rejected address (outside NYC or unplaceable) as not found', () => {
    expect(parseGeoclientResponse(responses['rejected-hoboken'])).toEqual({ status: 'not_found' })
  })

  it('skips matches without a council district', () => {
    const json = { results: [{ status: 'POSSIBLE_MATCH', response: { nta2020: 'MN0502' } }] }
    expect(parseGeoclientResponse(json)).toEqual({ status: 'not_found' })
  })

  it('handles junk input', () => {
    expect(parseGeoclientResponse(null)).toEqual({ status: 'not_found' })
    expect(parseGeoclientResponse({ results: 'nope' })).toEqual({ status: 'not_found' })
  })
})

describe('geocodeNycAddress', () => {
  const address = '200 5th Ave Brooklyn'

  it('sends the key as a header and never logs the address', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(responses['park-slope'])))
    const result = await geocodeNycAddress(address, { key: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.status).toBe('ok')
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('k')
  })

  it('reports the service as unavailable on HTTP errors and network failures, without the address', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const http = vi.fn(async () => new Response('down', { status: 503 }))
    expect(await geocodeNycAddress(address, { key: 'k', fetchImpl: http as unknown as typeof fetch })).toEqual({
      status: 'unavailable',
    })
    const thrown = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${address}`)
    })
    expect(await geocodeNycAddress(address, { key: 'k', fetchImpl: thrown as unknown as typeof fetch })).toEqual({
      status: 'unavailable',
    })
    for (const call of log.mock.calls) expect(call.join(' ')).not.toContain('5th Ave')
    log.mockRestore()
  })

  it('is unavailable without a key', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await geocodeNycAddress(address, { key: '' })).toEqual({ status: 'unavailable' })
    log.mockRestore()
  })
})
