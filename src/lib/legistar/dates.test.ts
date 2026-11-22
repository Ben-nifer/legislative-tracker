import { describe, expect, it } from 'vitest'
import { legistarEventTimestamp } from './dates'

describe('legistarEventTimestamp', () => {
  it('reads date + time as New York local time (EST)', () => {
    expect(legistarEventTimestamp('2026-11-23T00:00:00', '10:00 AM')).toBe('2026-11-23T15:00:00.000Z')
    expect(legistarEventTimestamp('2026-11-23T00:00:00', '1:30 PM')).toBe('2026-11-23T18:30:00.000Z')
    expect(legistarEventTimestamp('2026-11-23T00:00:00', '12:00 PM')).toBe('2026-11-23T17:00:00.000Z')
  })

  it('handles daylight saving time (EDT)', () => {
    expect(legistarEventTimestamp('2026-06-10T00:00:00', '10:00 AM')).toBe('2026-06-10T14:00:00.000Z')
  })

  it('falls back to midday when the time is missing or unreadable', () => {
    expect(legistarEventTimestamp('2026-11-23T00:00:00', null)).toBe('2026-11-23T17:00:00.000Z')
    expect(legistarEventTimestamp('2026-11-23T00:00:00', 'Recessed')).toBe('2026-11-23T17:00:00.000Z')
  })

  it('stays on the same New York calendar day', () => {
    const iso = legistarEventTimestamp('2026-11-23T00:00:00', '9:30 AM')!
    expect(new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York' })).toBe('11/23/2026')
  })

  it('rejects Legistar placeholder dates', () => {
    expect(legistarEventTimestamp('0001-01-01T00:00:00', '10:00 AM')).toBeNull()
  })
})
