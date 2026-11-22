// Legistar sends a meeting's date as "2026-11-23T00:00:00" (no time zone) and
// its time separately as "10:00 AM". Both are New York local time.

const NY = 'America/New_York'

// Minutes east of UTC for New York at a given instant (−300 in winter, −240 in summer)
function nyOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: NY, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value // "GMT-5"
  const m = name?.match(/GMT([+-]\d+)(?::(\d+))?/)
  if (!m) return -300
  const hours = Number(m[1])
  return hours * 60 + Math.sign(hours) * Number(m[2] ?? 0)
}

// "2026-11-23T00:00:00" + "10:00 AM" → "2026-11-23T15:00:00.000Z".
// No usable time → midday, so the New York calendar day is still right.
export function legistarEventTimestamp(eventDate: string, eventTime: string | null | undefined): string | null {
  const day = eventDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!day || day[1] === '0001') return null
  const [, y, mo, d] = day.map(Number)

  let hour = 12
  let minute = 0
  const t = eventTime?.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (t) {
    hour = (Number(t[1]) % 12) + (t[3].toUpperCase() === 'PM' ? 12 : 0)
    minute = Number(t[2])
  }

  // Treat the wall-clock time as UTC, then shift by New York's offset at that moment
  const asUtc = Date.UTC(y, mo - 1, d, hour, minute)
  const offset = nyOffsetMinutes(new Date(asUtc))
  return new Date(asUtc - offset * 60_000).toISOString()
}
