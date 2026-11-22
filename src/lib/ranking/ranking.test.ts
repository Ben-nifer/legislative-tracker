import { describe, expect, it } from 'vitest'
import type { RankingConfig } from './config'
import { interleaveBodies, rankActivePoliticians } from './politicians'
import {
  type RankInput,
  applySponsorCap,
  computeImportance,
  computeRecency,
  itemFields,
  percentRanks,
  rankJurisdiction,
  rankPolitician,
  rankTopic,
  rankTrending,
  relevanceFromSimilarity,
} from './score'

// The v2 row seeded by migration 023
const config: RankingConfig = {
  version: 2,
  weights: {
    importance: { stage: 30, cosponsors: 15, hearings: 10, engagement: 45 },
    widgets: {
      jurisdiction: { importance: 0.6, recency: 0.4 },
      topic: { relevance: 0.5, recency: 0.3, importance: 0.2 },
      politician: { importance: 0.6, recency: 0.4, cosponsor_multiplier: 0.6 },
    },
  },
  params: {
    similarity_floor: 0.3,
    similarity_ceiling: 0.6,
    recency_half_days: 14,
    upcoming_full_days: 7,
    upcoming_zero_days: 30,
    sponsor_cap: 2,
    topic_candidate_count: 300,
    neighborhood_min_items: 3,
    hearings_full_at: 2,
    engagement: {
      window_days: 30,
      action_weights: { stance: 3, comment: 2, save: 2, view: 0.2 },
      new_account_days: 7,
      new_account_multiplier: 0.25,
      guest_view_multiplier: 0.1,
      prior_weight: 10,
    },
    trending: { window_days: 7, gravity: 1.8, offset_hours: 2 },
    politician_weights: { bills_introduced_30d: 40, upcoming_events_14d: 35, recent_actions_30d: 25 },
  },
}

const NOW = new Date('2026-11-22T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString()

let seq = 0
function item(overrides: Partial<RankInput> = {}): RankInput {
  seq++
  return {
    id: `item-${String(seq).padStart(2, '0')}`,
    itemType: 'bill',
    title: `Item ${seq}`,
    url: `https://example.org/${seq}`,
    jurisdictionLevel: 'city',
    legislatureId: 'nyc',
    legislationId: null,
    stage: 'in_committee',
    introducedAt: daysAgo(60).slice(0, 10),
    lastActivityAt: daysAgo(30),
    nextEventAt: null,
    primarySponsorId: null,
    cosponsorCount: 0,
    hearingCount: 0,
    engagementWindow: 0,
    actionsWindow: 0,
    engagementTrending: 0,
    lastEngagementAt: null,
    ...overrides,
  }
}

// A small, varied city fixture for the widget snapshots
seq = 0
const fixture: RankInput[] = [
  item({ stage: 'passed_chamber', cosponsorCount: 40, hearingCount: 2, lastActivityAt: daysAgo(2), primarySponsorId: 'sp-a' }),
  item({ stage: 'hearing_scheduled', cosponsorCount: 12, hearingCount: 1, nextEventAt: daysAhead(3), primarySponsorId: 'sp-a' }),
  item({ stage: 'introduced', cosponsorCount: 2, lastActivityAt: daysAgo(1), primarySponsorId: 'sp-a', engagementWindow: 30, actionsWindow: 10, engagementTrending: 12, lastEngagementAt: daysAgo(0.5) }),
  item({ stage: 'in_committee', cosponsorCount: 25, lastActivityAt: daysAgo(90), primarySponsorId: 'sp-b' }),
  item({ stage: 'passed_committee', cosponsorCount: 18, hearingCount: 3, lastActivityAt: daysAgo(10), primarySponsorId: 'sp-a', engagementWindow: 6, actionsWindow: 2 }),
  item({ stage: 'enacted', cosponsorCount: 30, hearingCount: 2, lastActivityAt: daysAgo(5), primarySponsorId: 'sp-c' }),
  item({ stage: 'introduced', cosponsorCount: 0, lastActivityAt: daysAgo(20), primarySponsorId: 'sp-b', engagementWindow: 3, actionsWindow: 1, engagementTrending: 3, lastEngagementAt: daysAgo(3) }),
  item({ itemType: 'resolution', stage: 'in_committee', cosponsorCount: 5, lastActivityAt: daysAgo(4), primarySponsorId: 'sp-d' }),
  item({ itemType: 'resolution', stage: 'enacted', cosponsorCount: 9, lastActivityAt: daysAgo(40), primarySponsorId: 'sp-c' }),
  item({ stage: 'in_committee', cosponsorCount: 7, lastActivityAt: daysAgo(14), nextEventAt: daysAhead(20), primarySponsorId: 'sp-e', engagementWindow: 1.2, actionsWindow: 6, engagementTrending: 0.4, lastEngagementAt: daysAgo(1) }),
  item({ stage: 'passed_committee', cosponsorCount: 22, hearingCount: 1, lastActivityAt: daysAgo(3), primarySponsorId: 'sp-a' }),
  item({ stage: 'introduced', cosponsorCount: 1, lastActivityAt: daysAgo(0), primarySponsorId: null }),
  item({ itemType: 'project', jurisdictionLevel: 'neighborhood', legislatureId: 'nyc', stage: 'in_committee', lastActivityAt: daysAgo(6) }),
]
const importance = computeImportance(fixture, config)
const ctx = { config, now: NOW, importance: (id: string) => importance.get(id)?.score ?? 0 }
const top = (items: { id: string; score: number }[], n = 10) => items.slice(0, n).map((i) => `${i.id} ${i.score}`)

describe('percentRanks', () => {
  it('matches SQL percent_rank, ties sharing a rank', () => {
    expect(percentRanks([10, 20, 20, 30])).toEqual([0, 1 / 3, 1 / 3, 1])
    expect(percentRanks([5])).toEqual([0])
  })
})

describe('computeImportance', () => {
  it('adds stage, cosponsor, hearing and engagement points', () => {
    const imp = importance.get('item-01')!
    expect(imp.components.stage).toBe(30) // passed_chamber = 1.0
    expect(imp.components.hearings).toBe(10) // 2+ hearings
    expect(imp.components.cosponsors).toBe(15) // most cosponsors among city bills
    expect(imp.score).toBe(imp.components.stage + imp.components.cosponsors + imp.components.hearings + imp.components.engagement)
  })

  it('compares cosponsors only within the same body and item type', () => {
    // item-09 is the top resolution, though bills have more cosponsors
    expect(importance.get('item-09')!.components.cosponsors).toBe(15)
  })

  it('never ranks an engaged item below one with no engagement', () => {
    const items = [item({ engagementWindow: 0.02, actionsWindow: 1 }), item(), item({ engagementWindow: 50, actionsWindow: 20 })]
    const imp = computeImportance(items, config)
    const eng = items.map((i) => imp.get(i.id)!.components.engagement)
    expect(eng[0]).toBeGreaterThan(eng[1])
    expect(eng[2]).toBeGreaterThan(eng[0])
  })

  it('favors more actions over one lucky high-weight action (smoothing)', () => {
    // Same weighted total (3), above the level average: one stance vs fifteen views.
    // With little evidence the single stance is pulled back toward the average.
    const items = [
      item({ engagementWindow: 3, actionsWindow: 1 }),
      item({ engagementWindow: 3, actionsWindow: 15 }),
      ...[1, 2, 3].map(() => item({ engagementWindow: 0.2, actionsWindow: 1 })),
    ]
    const imp = computeImportance(items, config)
    expect(imp.get(items[0].id)!.components.engagement).toBeLessThan(imp.get(items[1].id)!.components.engagement)
  })

  it('ranks engagement within each level, so neighborhood items are not drowned out', () => {
    const items = [
      item({ engagementWindow: 100, actionsWindow: 50 }),
      item({ engagementWindow: 50, actionsWindow: 20 }),
      item({ jurisdictionLevel: 'neighborhood', engagementWindow: 2, actionsWindow: 1 }),
      item({ jurisdictionLevel: 'neighborhood' }),
    ]
    const imp = computeImportance(items, config)
    expect(imp.get(items[2].id)!.components.engagement).toBe(45)
  })
})

describe('neutrality (§6.2)', () => {
  it('never reads party, ideology or stance direction', () => {
    const forbidden = new Set(['party', 'ideology', 'stance', 'support_count', 'oppose_count', 'supportCount', 'opposeCount'])
    const guard = <T extends object>(o: T): T =>
      new Proxy(o, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && forbidden.has(prop)) throw new Error(`Ranking read forbidden field "${prop}"`)
          return Reflect.get(target, prop, receiver)
        },
      })
    const guarded = fixture.map(guard)
    const imp = computeImportance(guarded, config)
    const c = { config, now: NOW, importance: (id: string) => imp.get(id)?.score ?? 0 }
    expect(() => {
      rankJurisdiction(guarded.map(itemFields).map(guard), c)
      rankTopic(guarded.map((i) => ({ item: guard(itemFields(i)), similarity: 0.5, tagged: false })), c)
      rankPolitician(guarded.map((i) => ({ item: guard(itemFields(i)), primary: true })), c)
      rankTrending(guarded, c)
      rankActivePoliticians(
        [guard({ id: 'p', legislatureId: 'nyc', fullName: 'A', slug: 'a', photoUrl: null, district: '1' })],
        new Map(),
        config,
        NOW
      )
    }).not.toThrow()
  })
})

describe('computeRecency', () => {
  it('decays with days since last activity', () => {
    expect(computeRecency({ lastActivityAt: daysAgo(0), nextEventAt: null }, config, NOW)).toBe(1)
    expect(computeRecency({ lastActivityAt: daysAgo(14), nextEventAt: null }, config, NOW)).toBeCloseTo(Math.exp(-1))
  })

  it('is 1.0 for a hearing within 7 days, falling to 0 at 30', () => {
    const old = daysAgo(200)
    expect(computeRecency({ lastActivityAt: old, nextEventAt: daysAhead(6) }, config, NOW)).toBe(1)
    expect(computeRecency({ lastActivityAt: old, nextEventAt: daysAhead(18.5) }, config, NOW)).toBeCloseTo(0.5)
    expect(computeRecency({ lastActivityAt: old, nextEventAt: daysAhead(31) }, config, NOW)).toBeLessThan(0.001)
    expect(computeRecency({ lastActivityAt: old, nextEventAt: daysAgo(1) }, config, NOW)).toBeLessThan(0.001)
  })
})

describe('relevanceFromSimilarity', () => {
  it('maps the floor to 0 and the ceiling to 1', () => {
    expect(relevanceFromSimilarity(0.3, config)).toBe(0)
    expect(relevanceFromSimilarity(0.45, config)).toBeCloseTo(0.5)
    expect(relevanceFromSimilarity(0.8, config)).toBe(1)
  })
})

describe('applySponsorCap (§6.5)', () => {
  const ranked = (sponsors: (string | null)[]) => sponsors.map((s, i) => ({ id: `r${i}`, primarySponsorId: s }))

  it('lets at most 2 items per sponsor into the visible slots', () => {
    const out = applySponsorCap(ranked(['a', 'a', 'a', 'a', 'b', 'c', 'd']), 2)
    expect(out.map((i) => i.id)).toEqual(['r0', 'r1', 'r4', 'r5', 'r6', 'r2', 'r3'])
  })

  it('keeps order when one prolific sponsor has everything', () => {
    const out = applySponsorCap(ranked(['a', 'a', 'a', 'a']), 2)
    expect(out.map((i) => i.id)).toEqual(['r0', 'r1', 'r2', 'r3'])
  })

  it('never caps items without a sponsor', () => {
    const out = applySponsorCap(ranked([null, null, null, 'a', 'a', 'a']), 2)
    expect(out.slice(0, 5).map((i) => i.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('only fills the visible slots; the rest keep their ranked order', () => {
    const out = applySponsorCap(ranked(['a', 'b', 'c', 'd', 'e', 'a', 'a']), 2)
    expect(out.map((i) => i.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
  })
})

describe('widget snapshots (§9)', () => {
  const city = fixture.filter((i) => i.jurisdictionLevel === 'city').map(itemFields)

  it('jurisdiction:city', () => {
    expect(top(applySponsorCap(rankJurisdiction(city, ctx), 2))).toMatchSnapshot()
  })

  it('topic: tagged items plus near neighbors above the floor', () => {
    const sims = [0.62, null, 0.41, 0.55, 0.29, 0.33, 0.5, 0.36, 0.31, 0.58, 0.47, 0.25]
    const candidates = city.map((it, i) => ({ item: it, similarity: sims[i], tagged: i === 1 || i === 7 }))
    const ranked = rankTopic(candidates, ctx)
    expect(ranked.find((r) => r.id === 'item-05')).toBeUndefined() // 0.29, below the floor
    expect(top(applySponsorCap(ranked, 2))).toMatchSnapshot()
  })

  it('politician: co-sponsored items count ×0.6', () => {
    const items = city.slice(0, 6).map((it, i) => ({ item: it, primary: i % 2 === 0 }))
    const ranked = rankPolitician(items, ctx)
    expect(top(ranked)).toMatchSnapshot()
  })

  it('trending', () => {
    expect(top(rankTrending(fixture, { config, now: NOW }))).toMatchSnapshot()
  })
})

describe('rankActivePoliticians (§6.7)', () => {
  const legislators = ['a', 'b', 'c'].map((x) => ({ id: x, legislatureId: 'nyc', fullName: `Member ${x}`, slug: x, photoUrl: null, district: null }))

  it('scores bills introduced, upcoming hearings and recent actions, with a reason line', () => {
    const items = new Map([
      ['a', { primary: [1, 2, 3, 4].map(() => ({ itemType: 'bill', introducedAt: daysAgo(5), nextEventAt: null, lastActivityAt: daysAgo(5) })), cosponsored: [] }],
      ['b', { primary: [{ itemType: 'bill', introducedAt: daysAgo(200), nextEventAt: '2026-11-26T15:00:00Z', lastActivityAt: daysAgo(40) }], cosponsored: [] }],
      ['c', { primary: [], cosponsored: [] }],
    ])
    const ranked = rankActivePoliticians(legislators, items, config, NOW)
    expect(ranked.map((p) => [p.legislatorId, p.score, p.reason])).toEqual([
      ['a', 65, 'Introduced 4 bills this month'],
      ['b', 35, 'Hearing on Thursday'],
      ['c', 0, null],
    ])
  })

  it('counts bills and resolutions as introduced, worded by what was filed', () => {
    const filed = (itemType: string) => ({ itemType, introducedAt: daysAgo(3), nextEventAt: null, lastActivityAt: daysAgo(3) })
    const items = new Map([
      ['a', { primary: [filed('bill'), filed('resolution')], cosponsored: [] }],
      ['b', { primary: [filed('resolution')], cosponsored: [] }],
      ['c', { primary: [filed('hearing')], cosponsored: [] }],
    ])
    const byId = new Map(rankActivePoliticians(legislators, items, config, NOW).map((p) => [p.legislatorId, p]))
    expect(byId.get('a')!.reason).toBe('Introduced 2 bills and resolutions this month')
    expect(byId.get('b')!.reason).toBe('Introduced 1 resolution this month')
    expect(byId.get('c')!.counts.billsIntroduced).toBe(0)
  })

  it('interleaves bodies and caps the list', () => {
    const ranked = [
      { id: 1, legislatureId: 'council' },
      { id: 2, legislatureId: 'council' },
      { id: 3, legislatureId: 'assembly' },
      { id: 4, legislatureId: 'council' },
    ]
    expect(interleaveBodies(ranked, 3).map((p) => p.id)).toEqual([1, 3, 2])
  })
})
