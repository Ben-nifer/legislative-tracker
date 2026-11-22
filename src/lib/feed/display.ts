// How a content item reads on a card (onboarding spec v1.2 §6.1): "Type · status",
// the title, and an optional context label. Labels describe the item, never the
// viewer (recommendations plan §6.6). No stance or engagement controls.

const DAY_MS = 86_400_000

const TYPE_LABELS: Record<string, string> = {
  bill: 'Bill',
  resolution: 'Resolution',
  hearing: 'Hearing',
  project: 'Project',
  budget_item: 'Budget item',
  announcement: 'Agency notice',
  news: 'News',
}

const STAGE_LABELS: Record<string, string> = {
  introduced: 'Introduced',
  in_committee: 'In committee',
  hearing_scheduled: 'Hearing scheduled',
  passed_committee: 'Headed to a full vote',
  passed_chamber: 'Awaiting the Mayor',
  enacted: 'Enacted',
  vetoed: 'Vetoed',
  dead: 'Closed',
}

export function typeLabel(itemType: string): string {
  return TYPE_LABELS[itemType] ?? 'Item'
}

export function statusLabel(stage: string | null, itemType: string): string {
  if (itemType === 'hearing') return stage === 'hearing_scheduled' ? 'Upcoming' : 'Held'
  return (stage && STAGE_LABELS[stage]) ?? 'Update'
}

function nyDate(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', ...opts })
}

// "Hearing Thursday" within a week, "Hearing Dec 4" after; otherwise a stage milestone
export function contextLabel(
  item: { itemType: string; stage: string | null; nextEventAt: string | null },
  now: Date
): string | null {
  if (item.nextEventAt) {
    const days = (new Date(item.nextEventAt).getTime() - now.getTime()) / DAY_MS
    const sameDay = nyDate(item.nextEventAt, { dateStyle: 'short' }) === nyDate(now.toISOString(), { dateStyle: 'short' })
    if (sameDay) return 'Hearing today'
    if (days >= 0 && days <= 6) return `Hearing ${nyDate(item.nextEventAt, { weekday: 'long' })}`
    if (days > 6) return `Hearing ${nyDate(item.nextEventAt, { month: 'short', day: 'numeric' })}`
  }
  if (item.stage === 'passed_committee') return 'Passed committee'
  if (item.stage === 'passed_chamber') return 'Passed the Council'
  return null
}

export function itemHref(item: { legislationSlug: string | null; url: string }): string {
  return item.legislationSlug ? `/legislation/${item.legislationSlug}` : item.url
}
