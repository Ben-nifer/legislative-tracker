import type { RankingConfig } from './config'
import { percentRanks } from './score'

// Onboarding S3 "Active in your jurisdictions" (recommendations-planv1.2.md §6.7, D20).
// A ranking of people. Party is never read: the legislator type has no party field.

const DAY_MS = 86_400_000

export interface Legislator {
  id: string
  legislatureId: string
  fullName: string
  slug: string
  photoUrl: string | null
  district: string | null
  title?: string | null // office, e.g. "Council Member", "Mayor"
}

export interface LegislatorItems {
  primary: { itemType: string; introducedAt: string | null; nextEventAt: string | null; lastActivityAt: string }[]
  cosponsored: { nextEventAt: string | null; lastActivityAt: string }[]
}

export interface ActivePolitician {
  legislatorId: string
  legislatureId: string
  fullName: string
  slug: string
  photoUrl: string | null
  district: string | null
  title: string | null
  score: number // 0–100
  components: { billsIntroduced: number; upcomingEvents: number; recentActions: number } // points
  counts: { billsIntroduced: number; upcomingEvents: number; recentActions: number }
  reason: string | null // the strongest signal, e.g. "Introduced 4 bills this month"
}

// Legislation a member files. Land Use resolutions carry no people (the chair
// is only the listed sponsor), so they never reach this count.
const INTRODUCED_TYPES = new Set(['bill', 'resolution'])

function introducedText(bills: number, resolutions: number) {
  const n = bills + resolutions
  const what = !resolutions ? (n === 1 ? 'bill' : 'bills') : !bills ? (n === 1 ? 'resolution' : 'resolutions') : 'bills and resolutions'
  return `Introduced ${n} ${what} this month`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function weekday(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' })
}

// Each signal is log-scaled and turned into a percentile within the same body
export function rankActivePoliticians(
  legislators: Legislator[],
  itemsByLegislator: Map<string, LegislatorItems>,
  config: RankingConfig,
  now: Date
): ActivePolitician[] {
  const w = config.params.politician_weights
  const t = now.getTime()
  const within = (iso: string | null, fromDays: number, toDays: number) => {
    if (!iso) return false
    const d = (new Date(iso).getTime() - t) / DAY_MS
    return d >= fromDays && d <= toDays
  }

  const raw = legislators.map((l) => {
    const items = itemsByLegislator.get(l.id) ?? { primary: [], cosponsored: [] }
    const all = [...items.primary, ...items.cosponsored]
    const upcoming = all
      .map((i) => i.nextEventAt)
      .filter((d): d is string => within(d, 0, 14))
      .sort()
    const introduced = items.primary.filter((i) => INTRODUCED_TYPES.has(i.itemType) && within(i.introducedAt, -30, 0))
    return {
      legislator: l,
      introducedBills: introduced.filter((i) => i.itemType === 'bill').length,
      counts: {
        billsIntroduced: introduced.length,
        upcomingEvents: upcoming.length,
        recentActions: all.filter((i) => within(i.lastActivityAt, -30, 0)).length,
      },
      soonestEvent: upcoming[0] ?? null,
    }
  })

  const pct = new Map<string, { bills: number; upcoming: number; recent: number }>()
  const byBody = new Map<string, typeof raw>()
  for (const r of raw) {
    if (!byBody.has(r.legislator.legislatureId)) byBody.set(r.legislator.legislatureId, [])
    byBody.get(r.legislator.legislatureId)!.push(r)
  }
  for (const group of byBody.values()) {
    const bills = percentRanks(group.map((r) => Math.log1p(r.counts.billsIntroduced)))
    const upcoming = percentRanks(group.map((r) => Math.log1p(r.counts.upcomingEvents)))
    const recent = percentRanks(group.map((r) => Math.log1p(r.counts.recentActions)))
    group.forEach((r, i) => pct.set(r.legislator.id, { bills: bills[i], upcoming: upcoming[i], recent: recent[i] }))
  }

  return raw
    .map(({ legislator: l, counts, soonestEvent, introducedBills }) => {
      const p = pct.get(l.id)!
      const components = {
        billsIntroduced: Math.round(w.bills_introduced_30d * p.bills * 100) / 100,
        upcomingEvents: Math.round(w.upcoming_events_14d * p.upcoming * 100) / 100,
        recentActions: Math.round(w.recent_actions_30d * p.recent * 100) / 100,
      }
      const reasons: [number, string | null][] = [
        [
          components.billsIntroduced,
          counts.billsIntroduced ? introducedText(introducedBills, counts.billsIntroduced - introducedBills) : null,
        ],
        [
          components.upcomingEvents,
          soonestEvent
            ? within(soonestEvent, 0, 7)
              ? `Hearing on ${weekday(soonestEvent)}`
              : `${plural(counts.upcomingEvents, 'hearing')} in the next 2 weeks`
            : null,
        ],
        [components.recentActions, counts.recentActions ? `Active on ${plural(counts.recentActions, 'item')} this month` : null],
      ]
      const reason = reasons.filter(([, text]) => text).sort((a, b) => b[0] - a[0])[0]?.[1] ?? null
      return {
        legislatorId: l.id,
        legislatureId: l.legislatureId,
        fullName: l.fullName,
        slug: l.slug,
        photoUrl: l.photoUrl,
        district: l.district,
        title: l.title ?? null,
        score: Math.round((components.billsIntroduced + components.upcomingEvents + components.recentActions) * 100) / 100,
        components,
        counts,
        reason,
      }
    })
    .sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName))
}

// §6.7 display rule: interleave bodies (Council, Assembly, …), cap at `limit`
export function interleaveBodies<T extends { legislatureId: string }>(ranked: T[], limit: number): T[] {
  const queues = new Map<string, T[]>()
  for (const p of ranked) {
    if (!queues.has(p.legislatureId)) queues.set(p.legislatureId, [])
    queues.get(p.legislatureId)!.push(p)
  }
  const out: T[] = []
  while (out.length < limit && [...queues.values()].some((q) => q.length)) {
    for (const q of queues.values()) {
      const next = q.shift()
      if (next && out.length < limit) out.push(next)
    }
  }
  return out
}
