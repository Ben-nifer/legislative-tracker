import { describe, expect, it } from 'vitest'
import {
  MAX_GUEST_CONTEXT_BYTES,
  emptyGuestContext,
  isEmptyGuestContext,
  parseGuestContext,
  serializeGuestContext,
  type GuestContext,
} from './guest'
import { parsePendingAction, readSessionId, safeRedirectPath, serializePendingAction } from './session'
import { pickUsername, usernameBase, displayNameFor } from './username'
import { addressLabel, districtsToPlaces } from './data/address'
import { coverageFromRows } from './data/coverage'
import { buildRepresentatives, type RepLegislator } from './data/representatives'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('guest context cookie', () => {
  const ctx: GuestContext = {
    v: 1,
    places: [{ type: 'council_district', id: '39' }, { type: 'neighborhood', id: 'BK0602' }],
    jurisdictions: [{ type: 'city', id: 'nyc' }],
    legislatorIds: [uuid(1)],
    topicIds: [uuid(2)],
    interests: [{ phrase: 'high speed rail', display: 'High-speed rail' }],
  }

  it('round-trips through the cookie value', () => {
    expect(parseGuestContext(serializeGuestContext(ctx))).toEqual(ctx)
  })

  it('reads missing, malformed or other-version cookies as no context', () => {
    expect(parseGuestContext(undefined)).toBeNull()
    expect(parseGuestContext('not json')).toBeNull()
    expect(parseGuestContext(encodeURIComponent(JSON.stringify({ ...ctx, v: 2 })))).toBeNull()
    expect(parseGuestContext(encodeURIComponent(JSON.stringify({ ...ctx, legislatorIds: ['nope'] })))).toBeNull()
  })

  it('has no field for an address, and drops unknown keys', () => {
    const raw = encodeURIComponent(JSON.stringify({ ...ctx, address: '200 5th Ave', lat: 40.6 }))
    const parsed = parseGuestContext(raw)!
    expect(parsed).toEqual(ctx)
    expect(JSON.stringify(parsed)).not.toContain('5th Ave')
  })

  it('rejects place types the user tables do not accept', () => {
    const bad = { ...ctx, places: [{ type: 'borough', id: 'BK' }] }
    expect(parseGuestContext(encodeURIComponent(JSON.stringify(bad)))).toBeNull()
  })

  it('stays under the size cap at its limits', () => {
    const full: GuestContext = {
      v: 1,
      places: districtsToPlaces({
        councilDistrict: '39',
        stateSenateDistrict: '26',
        assemblyDistrict: '52',
        congressionalDistrict: '10',
        ntaCode: 'BK0602',
        borough: 'BK',
        communityDistrict: '306',
      }),
      jurisdictions: [
        { type: 'city', id: 'nyc' },
        { type: 'state', id: 'NY' },
        { type: 'federal', id: 'us' },
        { type: 'neighborhood', id: 'BK0602' },
        { type: 'neighborhood', id: 'BK0601' },
        { type: 'neighborhood', id: 'BK0702' },
      ],
      legislatorIds: Array.from({ length: 12 }, (_, i) => uuid(i)),
      topicIds: Array.from({ length: 15 }, (_, i) => uuid(100 + i)),
      interests: Array.from({ length: 10 }, (_, i) => ({ phrase: `affordable housing ${i}`, display: `Affordable housing ${i}` })),
    }
    expect(serializeGuestContext(full).length).toBeLessThanOrEqual(MAX_GUEST_CONTEXT_BYTES)
  })

  it('knows when nothing is selected', () => {
    expect(isEmptyGuestContext(emptyGuestContext())).toBe(true)
    expect(isEmptyGuestContext(ctx)).toBe(false)
  })
})

describe('session cookies', () => {
  it('accepts only well-formed session IDs', () => {
    expect(readSessionId('0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef')
    expect(readSessionId('short')).toBeNull()
    expect(readSessionId('has spaces in it ok ok ok')).toBeNull()
  })

  it('round-trips a pending stance and rejects unknown actions', () => {
    const pending = { action: 'stance' as const, legislationId: uuid(5), stance: 'support' as const }
    expect(parsePendingAction(serializePendingAction(pending))).toEqual(pending)
    expect(parsePendingAction(encodeURIComponent(JSON.stringify({ action: 'comment', body: 'hi' })))).toBeNull()
  })

  it('only redirects within the site', () => {
    expect(safeRedirectPath('/legislation/int-1-2026')).toBe('/legislation/int-1-2026')
    expect(safeRedirectPath('//evil.example')).toBe('/')
    expect(safeRedirectPath('/\\evil.example')).toBe('/')
    expect(safeRedirectPath('@evil.example')).toBe('/')
    expect(safeRedirectPath(null)).toBe('/')
  })
})

describe('generated usernames', () => {
  it('slugifies the Google name, falling back to the email', () => {
    expect(usernameBase('José García', 'x@y.com')).toBe('josegarcia')
    expect(usernameBase(null, 'jane.doe+news@example.com')).toBe('janedoe')
    expect(usernameBase('  ', 'Al@example.com')).toBe('user')
    expect(usernameBase('A Very Long Name That Keeps Going', null)).toBe('averylongnamethatkee')
  })

  it('only uses characters the profile editor allows', () => {
    expect(usernameBase('O’Brien-Smith 3rd', null)).toMatch(/^[a-z0-9_]{3,30}$/)
  })

  it('adds the lowest free number when taken', () => {
    expect(pickUsername('jane', new Set())).toBe('jane')
    expect(pickUsername('jane', new Set(['jane', 'jane2', 'janet']))).toBe('jane3')
  })

  it('takes a display name from the profile name or email', () => {
    expect(displayNameFor('Jane Doe', 'j@x.com')).toBe('Jane Doe')
    expect(displayNameFor(undefined, 'jdoe@x.com')).toBe('jdoe')
  })
})

describe('address resolution', () => {
  it('maps districts to place IDs and drops absent ones', () => {
    expect(
      districtsToPlaces({
        councilDistrict: '39',
        stateSenateDistrict: null,
        assemblyDistrict: '52',
        congressionalDistrict: '10',
        ntaCode: null,
        borough: 'BK',
        communityDistrict: null,
      })
    ).toEqual([
      { type: 'city', id: 'nyc' },
      { type: 'state', id: 'NY' },
      { type: 'council_district', id: '39' },
      { type: 'assembly', id: '52' },
      { type: 'congressional', id: '10' },
    ])
  })

  it('labels the confirmation chip', () => {
    expect(addressLabel('39', 'Park Slope')).toBe('Council District 39 · Park Slope')
    expect(addressLabel('3', null)).toBe('Council District 3')
  })
})

describe('coverage registry', () => {
  it('defaults missing levels to not live', () => {
    expect(coverageFromRows([{ level: 'city', live: true }, { level: 'bogus', live: true }])).toEqual({
      federal: false,
      state: false,
      city: true,
      neighborhood: false,
    })
  })
})

describe('representatives', () => {
  const rep = (name: string): RepLegislator => ({
    id: uuid(9),
    fullName: name,
    slug: name.toLowerCase().replace(/ /g, '-'),
    title: null,
    district: null,
    photoUrl: null,
    party: null,
  })

  it('orders federal → local with state and federal coming soon', () => {
    const cards = buildRepresentatives(
      [
        { type: 'council_district', id: '39' },
        { type: 'state_senate', id: '26' },
        { type: 'assembly', id: '52' },
        { type: 'congressional', id: '10' },
      ],
      { councilMember: rep('Shahana Hanif'), mayor: rep('Zohran Mamdani') }
    )
    expect(cards.map((c) => [c.office, c.districtLabel, c.comingSoon])).toEqual([
      ['U.S. Senators', 'New York', true],
      ['U.S. Representative', 'NY-10', true],
      ['State Senator', 'District 26', true],
      ['Assembly Member', 'District 52', true],
      ['Council Member', 'District 39', false],
      ['Mayor', 'New York City', false],
    ])
    expect(cards[4].legislator?.fullName).toBe('Shahana Hanif')
  })

  it('is empty without a resolved NYC address', () => {
    expect(buildRepresentatives([], { councilMember: null, mayor: null })).toEqual([])
  })
})
