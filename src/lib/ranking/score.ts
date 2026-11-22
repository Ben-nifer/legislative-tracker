import type { RankingConfig } from './config'

// Shared scoring (recommendations-planv1.2.md §6). Pure functions: the
// precompute and the on-demand interest path both rank through here.
//
// Neutrality (§6.2): nothing in this file reads party, ideology or which side
// anyone took. The input types below don't carry them, and a unit test fails
// if any of those fields is ever accessed.

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

// Default widget size (§7.2); the sponsor cap applies to these slots
export const VISIBLE_SLOTS = 5
// Items kept per cached widget, for "See all"
export const WIDGET_CACHE_SIZE = 30

// §5.2. enacted/vetoed are final outcomes (0.6); dead items never reach a widget.
export const STAGE_SCORES: Record<string, number> = {
  introduced: 0.3,
  in_committee: 0.4,
  hearing_scheduled: 0.8,
  passed_committee: 0.9,
  passed_chamber: 1.0,
  enacted: 0.6,
  vetoed: 0.6,
  dead: 0,
}

export interface RankInput {
  id: string
  itemType: string
  title: string
  url: string
  jurisdictionLevel: string
  legislatureId: string | null
  legislationId: string | null
  stage: string | null
  introducedAt: string | null
  lastActivityAt: string
  nextEventAt: string | null
  primarySponsorId: string | null
  cosponsorCount: number
  hearingCount: number
  engagementWindow: number // weighted actions, last 30 days, new-account cap applied (D31)
  actionsWindow: number // unweighted action count, same window: the evidence for smoothing
  engagementTrending: number // weighted actions, last 7 days
  lastEngagementAt: string | null
}

export interface Importance {
  score: number // 0–100
  components: { stage: number; cosponsors: number; hearings: number; engagement: number } // points
}

export interface WidgetItem {
  id: string
  title: string
  itemType: string
  jurisdictionLevel: string
  stage: string | null
  url: string
  legislationId: string | null
  lastActivityAt: string
  nextEventAt: string | null
  primarySponsorId: string | null
  score: number
  signals: { importance?: number; recency?: number; relevance?: number; similarity?: number; cosponsor?: boolean; engagement7d?: number }
}

const round = (x: number, places = 4) => Math.round(x * 10 ** places) / 10 ** places

// Fraction of the group strictly below each value (SQL percent_rank): ties share a rank
export function percentRanks(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 0)
  const sorted = [...values].sort((a, b) => a - b)
  return values.map((v) => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < v) lo = mid + 1
      else hi = mid
    }
    return lo / (values.length - 1)
  })
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(item)
  }
  return groups
}

// §6.2. Engagement: log-scaled, Bayesian-smoothed toward the level's average
// (items with no actions stay at 0), then a percentile within the level.
export function computeImportance(items: RankInput[], config: RankingConfig): Map<string, Importance> {
  const w = config.weights.importance
  const { prior_weight } = config.params.engagement
  const hearingsFullAt = config.params.hearings_full_at

  const cosponsorPct = new Map<string, number>()
  for (const group of groupBy(items, (i) => `${i.legislatureId}|${i.itemType}`).values()) {
    const ranks = percentRanks(group.map((i) => i.cosponsorCount))
    group.forEach((item, idx) => cosponsorPct.set(item.id, ranks[idx]))
  }

  const engagementPct = new Map<string, number>()
  for (const group of groupBy(items, (i) => i.jurisdictionLevel).values()) {
    const logged = group.map((i) => Math.log1p(i.engagementWindow))
    const engaged = group.map((i, idx) => (i.actionsWindow > 0 ? logged[idx] : null)).filter((v): v is number => v !== null)
    const levelMean = engaged.length ? engaged.reduce((a, b) => a + b, 0) / engaged.length : 0
    const smoothed = group.map((i, idx) =>
      i.actionsWindow > 0 ? (i.actionsWindow * logged[idx] + prior_weight * levelMean) / (i.actionsWindow + prior_weight) : 0
    )
    const ranks = percentRanks(smoothed)
    group.forEach((item, idx) => engagementPct.set(item.id, ranks[idx]))
  }

  const result = new Map<string, Importance>()
  for (const item of items) {
    const hearings = item.hearingCount >= hearingsFullAt ? 1 : item.hearingCount > 0 ? 0.5 : 0
    const components = {
      stage: round(w.stage * (STAGE_SCORES[item.stage ?? ''] ?? 0), 2),
      cosponsors: round(w.cosponsors * (cosponsorPct.get(item.id) ?? 0), 2),
      hearings: round(w.hearings * hearings, 2),
      engagement: round(w.engagement * (engagementPct.get(item.id) ?? 0), 2),
    }
    const score = components.stage + components.cosponsors + components.hearings + components.engagement
    result.set(item.id, { score: round(Math.min(100, score), 2), components })
  }
  return result
}

// §6.3: max(activity decay, upcoming hearing/vote)
export function computeRecency(
  item: Pick<RankInput, 'lastActivityAt' | 'nextEventAt'>,
  config: RankingConfig,
  now: Date
): number {
  const { recency_half_days, upcoming_full_days, upcoming_zero_days } = config.params
  const daysSince = Math.max(0, (now.getTime() - new Date(item.lastActivityAt).getTime()) / DAY_MS)
  const activity = Math.exp(-daysSince / recency_half_days)

  let upcoming = 0
  if (item.nextEventAt) {
    const daysUntil = (new Date(item.nextEventAt).getTime() - now.getTime()) / DAY_MS
    if (daysUntil >= 0 && daysUntil <= upcoming_full_days) upcoming = 1
    else if (daysUntil > upcoming_full_days && daysUntil < upcoming_zero_days) {
      upcoming = (upcoming_zero_days - daysUntil) / (upcoming_zero_days - upcoming_full_days)
    }
  }
  return Math.max(activity, upcoming)
}

// §6.4: similarity mapped to 0–1 between the floor and the ceiling
export function relevanceFromSimilarity(similarity: number, config: RankingConfig): number {
  const { similarity_floor: floor, similarity_ceiling: ceiling } = config.params
  return Math.min(1, Math.max(0, (similarity - floor) / (ceiling - floor)))
}

export type ItemFields = Omit<WidgetItem, 'score' | 'signals'>

export function itemFields(item: RankInput): ItemFields {
  return {
    id: item.id,
    title: item.title,
    itemType: item.itemType,
    jurisdictionLevel: item.jurisdictionLevel,
    stage: item.stage,
    url: item.url,
    legislationId: item.legislationId,
    lastActivityAt: item.lastActivityAt,
    nextEventAt: item.nextEventAt,
    primarySponsorId: item.primarySponsorId,
  }
}

function byScore(a: WidgetItem, b: WidgetItem) {
  return b.score - a.score || b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id)
}

export interface ScoreContext {
  config: RankingConfig
  now: Date
  importance: (id: string) => number // 0–100; 0 when not yet computed
}

// Jurisdiction / place widgets (D24): 0.6 importance + 0.4 recency
export function rankJurisdiction(items: ItemFields[], ctx: ScoreContext): WidgetItem[] {
  const w = ctx.config.weights.widgets.jurisdiction
  return items
    .map((item) => {
      const importance = ctx.importance(item.id) / 100
      const recency = computeRecency(item, ctx.config, ctx.now)
      return {
        ...item,
        score: round(w.importance * importance + w.recency * recency),
        signals: { importance: round(importance), recency: round(recency) },
      }
    })
    .sort(byScore)
}

// Topic widgets (D25), chips and typed interests: 0.5 relevance + 0.3 recency + 0.2 importance.
// Tagged items have relevance 1.0; untagged ones need similarity above the floor.
export function rankTopic(
  candidates: { item: ItemFields; similarity: number | null; tagged: boolean }[],
  ctx: ScoreContext
): WidgetItem[] {
  const w = ctx.config.weights.widgets.topic
  const floor = ctx.config.params.similarity_floor
  return candidates
    .filter((c) => c.tagged || (c.similarity !== null && c.similarity >= floor))
    .map(({ item, similarity, tagged }) => {
      const relevance = tagged ? 1 : relevanceFromSimilarity(similarity!, ctx.config)
      const importance = ctx.importance(item.id) / 100
      const recency = computeRecency(item, ctx.config, ctx.now)
      return {
        ...item,
        score: round(w.relevance * relevance + w.recency * recency + w.importance * importance),
        signals: {
          relevance: round(relevance),
          recency: round(recency),
          importance: round(importance),
          ...(similarity !== null ? { similarity: round(similarity) } : {}),
        },
      }
    })
    .sort(byScore)
}

// Politician widgets (D27): jurisdiction formula, × 0.6 when only a co-sponsor
export function rankPolitician(items: { item: ItemFields; primary: boolean }[], ctx: ScoreContext): WidgetItem[] {
  const w = ctx.config.weights.widgets.politician
  return items
    .map(({ item, primary }) => {
      const importance = ctx.importance(item.id) / 100
      const recency = computeRecency(item, ctx.config, ctx.now)
      const base = w.importance * importance + w.recency * recency
      return {
        ...item,
        score: round(primary ? base : base * w.cosponsor_multiplier),
        signals: { importance: round(importance), recency: round(recency), cosponsor: !primary },
      }
    })
    .sort(byScore)
}

// Trending (§6.4, §15): engagement only, with gravity decay
export function rankTrending(items: RankInput[], ctx: Omit<ScoreContext, 'importance'>): WidgetItem[] {
  const { gravity, offset_hours } = ctx.config.params.trending
  return items
    .filter((i) => i.engagementTrending > 0 && i.lastEngagementAt)
    .map((i) => {
      const hours = Math.max(0, (ctx.now.getTime() - new Date(i.lastEngagementAt!).getTime()) / HOUR_MS)
      return {
        ...itemFields(i),
        score: round(Math.log1p(i.engagementTrending) / (hours + offset_hours) ** gravity, 6),
        signals: { engagement7d: round(i.engagementTrending, 2) },
      }
    })
    .sort(byScore)
}

// §6.5: at most `cap` items per primary sponsor in the visible slots.
// Items over the cap drop below the fold, keeping their order.
export function applySponsorCap<T extends { primarySponsorId: string | null }>(
  ranked: T[],
  cap: number,
  visibleSlots = VISIBLE_SLOTS
): T[] {
  const visible: T[] = []
  const below: T[] = []
  const counts = new Map<string, number>()
  for (const item of ranked) {
    const sponsor = item.primarySponsorId
    if (visible.length < visibleSlots && (!sponsor || (counts.get(sponsor) ?? 0) < cap)) {
      visible.push(item)
      if (sponsor) counts.set(sponsor, (counts.get(sponsor) ?? 0) + 1)
    } else {
      below.push(item)
    }
  }
  return [...visible, ...below]
}
