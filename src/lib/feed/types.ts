// Feed shapes shared by getFeed, POST /api/feed, the onboarding preview and the
// home page (recommendations-planv1.2.md §7, onboarding spec v1.2 §6.1).

export type FeedTopic =
  | { kind: 'topic'; id: string }
  | { kind: 'interest'; phrase: string; display: string } // phrase = normalized interest_phrases key

// What a user follows, in the order they added it. Derived from their rows
// (signed in) or the onb_ctx cookie / onboarding state (guests).
export interface FeedContext {
  userId: string | null
  jurisdictions: { type: string; id: string }[]
  topics: FeedTopic[]
  legislatorIds: string[]
}

export type WidgetKind = 'jurisdiction' | 'neighborhood' | 'topic' | 'politician' | 'tracked' | 'trending' | 'friends'

export interface FeedItem {
  id: string // content_items.id
  typeLabel: string // "Bill"
  statusLabel: string // "Hearing scheduled"
  title: string
  label: string | null // context label ("Hearing Thursday") or friend activity ("Ana supports this")
  personal: boolean // label is about people the viewer follows (accent color)
  href: string // the item's full page; the whole card links there
  isNew: boolean // not on screen before this preview update ("New ·")
}

export interface FeedWidget {
  key: string // widget_cache key, or tracked / friend_activity
  kind: WidgetKind
  title: string // the name only, e.g. "Park Slope", "bike lanes · Park Slope"
  items: FeedItem[]
  total: number // items available behind "See all"
  comingSoon: { place: string } | null // typed interest for a place we don't cover
  nearby: string | null // neighborhood topped up from a neighbor: "Nearby: Gowanus"
}

export interface FeedResponse {
  popular: boolean // nothing selected: "Popular right now"
  widgets: FeedWidget[]
  added: { titles: string[]; items: number } // sections and items new since previousItemIds
  configVersion: number | null
}
