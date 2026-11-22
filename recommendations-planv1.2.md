# Recommendations Plan — Content Layer, Embeddings & Feed Ranking

**Status:** Draft v1.2 · 2026-11-22 · **Phases 1–3 done** (see §14 Done log) · **v1.2: every widget is shared, not personalized; no "Top for you"; topic and politician widgets** (D22–D32) · Built from product-owner interview answers and a review of the onboarding mockup (Claude design canvas "Civic App Onboarding": iPhone clickable flow + web split view).
**Builds on:** `onboarding-spec.md` v1.1 (§6 live preview, §7 content & ranking).
**Scope:** The data layer, embeddings pipeline and ranking engine behind the onboarding live preview and the home-feed widgets.

> **[DECIDED]** = product-owner answer from the interview. **[PROPOSED]** = my recommendation, still awaiting approval. **[OPEN]** = unresolved (see §12).

---

## 1. Decisions from the interview

| # | Topic | Decision |
|---|---|---|
| D1 | Surfaces in scope | **Onboarding live preview + home feed.** Suggestion cards (spec §9) and search re-ranking come later. **[DECIDED]** |
| D2 | Ranking approach | **Weighted scoring formula only.** No machine learning planned. **[DECIDED]** |
| D3 | Content model | **One shared `content_items` table.** Every data source writes to it through an adapter. **[DECIDED]** |
| D4 | Sources expected within 6 months | NYC Legistar (now), then NY State Legislature, U.S. Congress, NYC neighborhood data (projects, budget, agency announcements), and news. **[DECIDED]** |
| D5 | Geography | **NYC first.** Other states plug in later through adapters and don't block launch. *Supersedes spec §2 "all 50 states at launch."* **[DECIDED]** |
| D6 | Embedding provider | **Voyage AI.** **[DECIDED]** |
| D7 | Ranking signals | Followed jurisdiction/district, followed politician, interest match, timeliness, bill stage, the user's own history, friends' activity. Popularity counts as a **moderate** factor. ~~**[DECIDED]**~~ *Superseded by D22, D28.* |
| D8 | Down-ranking | **Stale / dead bills** only. **[DECIDED]** |
| D9 | Freshness | **Every 2 hours** (the current Legistar sync cadence). **[DECIDED]** |
| D10 | Feed layout | A **"Top for you"** strip, then **jurisdiction banners** (Federal → State → City → Neighborhood). ~~**[DECIDED]**~~ *Superseded by D23.* |
| D11 | Balance rule | **Cap per sponsor.** **[DECIDED]** |
| D12 | Home page | The home page is made of **widgets** (jurisdiction, topic and politician widgets, Tracked, Trending, Friend activity…). This plan builds the **engine plus a fixed default layout**. The widget customization UI gets its own plan. **[DECIDED]** |
| D13 | Interest matching | **Keep the existing flat topics.** Free-text interests ("high-speed rail") match **directly against item embeddings**. No curated topic graph or aliases. *Supersedes spec §7.2 items 1, 3a, 3d and 4.* **[DECIDED]** |
| D14 | Guests | **Session-based.** Guests' widget choices live in the session; nothing persists until sign-up. *(Scoring is no longer per-person, see D22.)* **[DECIDED]** |
| D15 | Starting weights | §6.2 weights approved as a starting point. ~~**[DECIDED]**~~ *Superseded by D24, D25.* |
| D16 | Weight tuning | Weights are editable from an **admin weights editor** with preview, versioning and rollback (§8). **[DECIDED]** |
| D17 | Impression logging | **Log every feed impression and click** with its score breakdown and weights version (§3.5). **[DECIDED]** |
| D18 | Related topics for free text | Typed phrases match items directly. The closest existing topics are shown as **tap-to-add suggestions** ("+ Transit"), **never auto-added** (§5.3). *Adjusts the mockup, which auto-adds them.* **[DECIDED]** |
| D19 | "Top for you" strip | **Keep it** on the home page, even though the mockup's final page is banners only. The mockup gets updated later. ~~**[DECIDED]**~~ *Superseded by D23.* |
| D20 | S3 politician ranking | The **"Active in your jurisdictions"** list in onboarding S3 is **in this plan** (§6.7). **[DECIDED]** |
| D22 | Personalization model | **Every widget is shared.** The NYC or Park Slope widget shows the same items, in the same order, for everyone; so does each topic and politician widget. **Personalization = which widgets a user has**, not how items are ranked inside them. Only Tracked and Friend activity are per-user lists, and they're not scored. **[DECIDED]** |
| D23 | "Top for you" | **Removed.** **[DECIDED]** |
| D24 | Jurisdiction widgets | Ranked by **importance 60 + recency 40** (§6.4). **[DECIDED]** |
| D25 | Topic widgets | Each followed topic (chip) or typed interest **is its own widget**, ranked by **relevance 50 → recency 30 → importance 20**, across **all levels** (§6.4). **[DECIDED]** |
| D26 | Places inside typed topics | A typed interest can include a place ("housing legislation in California", "Park Slope bike lanes"). Detected by a **place-name list first, with an async Claude Haiku fallback** that never blocks the request (§5.3). Uncovered places show "Coming soon." **[DECIDED]** |
| D27 | Politician widgets | Each followed politician gets a **shared widget** of their items, ranked like jurisdiction widgets. **[DECIDED]** |
| D28 | Importance signals, v1 | **Process signals** (stage, cosponsors, hearings) + **on-platform engagement** (stances in any direction, comments, saves, views). **News mentions and lobbying filings come later** as new sources (§6.2, §15). **[DECIDED]** |
| D29 | Ceremonial items | **No cap.** Street co-namings and commemorative resolutions are ranked like any other item. **[DECIDED]** |
| D31 | New-account engagement | **Capped** to resist brigading: engagement from new accounts counts for less in importance (§6.2). **[DECIDED]** |
| D32 | Cross-widget duplicates | **Allowed.** A bill can appear in both the NYC widget and a topic widget on the same page. **[DECIDED]** |
| D30 | Migration strategy | No changes to the applied `020`/`021`/`022` migrations. Everything new goes in an additive `023_shared_widgets.sql` plus a `ranking_config` v2 row (§3.6). **[DECIDED]** |
| D21 | Banners from follows | Following a politician **adds a banner for their level**, holding only their items, even if that jurisdiction wasn't selected. *From the mockup.* ~~**[DECIDED]**~~ *Superseded by D27.* |

---

## 2. Architecture overview

```
 INGEST (cron, every 2h)             ENRICH (cron)                   PRECOMPUTE (cron, every 15 min)          SERVE (per request)
 ───────────────────────             ─────────────                   ───────────────────────────────          ───────────────────
 Legistar ─┐                                                         1. importance score per item             user's widget list
 NY State ─┤  adapter.fetchChanged() content_items ──► embed ──────► 2. rank every shared widget:              (from their follows,
 Congress ─┼─► adapter.toContentItem()+ places/people/  (Voyage)       jurisdiction · place · topic ·           or guest session)
 Open Data ┤      (upsert by hash)     topics                          politician · trending                        │
 News ─────┘                                                         3. write widget_cache ─────────────────► read cache ─► widgets
                                                                                                              + live Tracked / Friends
```

**Core ideas:**
- Everything downstream of the adapters only sees `content_items`. Adding a source means writing one adapter file.
- **Rankings are shared (D22),** so they're computed once in the background and cached. A page load is mostly cache reads: fast, cheap, and easy to audit for neutrality.

---

## 3. Data model

All new tables live in a single migration: `020_content_layer.sql`. Existing tables (`legislation`, `legislators`, `topics`, `topic_follows`, `legislator_follows`, `user_follows`, `engagement_events`, `legislation_stats`) stay as they are.

### 3.1 Sources & content

**`sources`**: one row per data source.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text unique | `nyc-legistar`, `ny-senate`, `congress-gov`, `nyc-capital-projects`, … |
| `name`, `kind` | text | `kind`: `legislature` \| `open_data` \| `news` |
| `enabled` | bool | Kill switch per source |
| `last_synced_at` | timestamptz | Watermark for incremental fetches |
| `config` | jsonb | Non-secret settings, e.g. page size |

**`content_items`**: the shared feed unit.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source_id` | uuid FK | |
| `external_id` | text | ID in the source system. **Unique with `source_id`** |
| `item_type` | text | `bill` \| `resolution` \| `hearing` \| `project` \| `budget_item` \| `announcement` \| `news` |
| `title` | text | |
| `summary` | text | Best available: `ai_summary` → official summary → null |
| `url` | text | Link to the original |
| `jurisdiction_level` | text | `federal` \| `state` \| `city` \| `neighborhood` |
| `legislature_id` | uuid FK null | Null for non-legislative items |
| `stage` | text null | Normalized lifecycle stage (see §5.2) |
| `status_raw` | text | The source's own status string, kept for display |
| `introduced_at` | date null | |
| `last_activity_at` | timestamptz | Drives timeliness and staleness |
| `next_event_at` | timestamptz null | Next hearing or vote |
| `is_dead` | bool | Filed, withdrawn, or expired at session end |
| `legislation_id` | uuid FK null | Link back to `legislation` for bill-specific detail |
| `metadata` | jsonb | Source-specific extras |
| `content_hash` | text | Hash of `title + summary`. A change triggers re-embedding |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(source_id, external_id)` unique; `(jurisdiction_level, last_activity_at desc)`; `(legislature_id, last_activity_at desc)`; partial `where not is_dead`.

**`content_item_places`**: where an item applies. One item can touch many places (spec §7.1 corridor rule).
| Column | Notes |
|---|---|
| `content_item_id`, `place_type`, `place_id` | `place_type`: `city` \| `council_district` \| `neighborhood` (NTA 2020 code) \| `state_senate` \| `assembly` \| `congressional` \| `state` |

**`content_item_people`**: politicians attached to an item.
| Column | Notes |
|---|---|
| `content_item_id`, `legislator_id`, `role` | `role`: `primary_sponsor` \| `sponsor` \| `actor` |

**`content_item_topics`**: the generalized version of `legislation_topics`, using the existing `topics` table.

### 3.2 Embeddings

**`content_embeddings`**
| Column | Type | Notes |
|---|---|---|
| `content_item_id` | uuid FK | |
| `model` | text | e.g. `voyage-3.5`. **PK is (`content_item_id`, `model`)**, so switching models later means a re-embed, not a schema change |
| `embedding` | `vector(1024)` | Dimension must match the model. Confirm at build time |
| `content_hash` | text | Hash of the text that was embedded |
| `embedded_at` | timestamptz | |

Index: HNSW, `vector_cosine_ops`, on the active model's rows.

**`topic_embeddings`**: one vector per existing flat topic (about 20 rows), built from `name` plus a one-line description. Used only to suggest related topics for a typed phrase (§5.3). It's re-embedded when a topic is added or renamed.
| Column | Notes |
|---|---|
| `topic_id` + `model` (PK), `embedding vector(1024)`, `embedded_at` | No index needed at this size |

**`interest_phrases`**: a cache, so each distinct phrase is embedded only once across all users.
| Column | Notes |
|---|---|
| `normalized_phrase` (PK), `model`, `embedding vector(1024)`, `hit_count`, `created_at` | Normalization: lowercase, trim, collapse whitespace, strip punctuation |

### 3.3 User context

| Table | Purpose |
|---|---|
| `user_places` | Resolved districts and neighborhood: `user_id, place_type, place_id`. Raw address is never stored (spec §S1) |
| `user_jurisdiction_follows` | Followed levels/places: `user_id, place_type, place_id` |
| `user_interests` | Free-text interests: `user_id, normalized_phrase` (FK → `interest_phrases`), `display_phrase`, `created_at` |
| *(existing)* `topic_follows` | Chip selections |
| *(existing)* `legislator_follows`, `user_follows`, `bookmarks`, `user_stances`, `engagement_events` | Politician, friend and history signals |

RLS: users read/write only their own rows. `content_*` tables are public-read and written by the service role only.

### 3.4 Ranking config

**`ranking_config`**: `version` (PK), `weights` jsonb, `params` jsonb, `active` bool, `note` text, `created_by` uuid, `created_at`. Exactly one row is active. Weights can be tuned without a deploy (§8), and every feed response records which version scored it.

### 3.5 Impression & click logging (D17)

*(Unchanged in v1.2. `signals` now holds the widget's score components rather than personal signals.)*


**`feed_impressions`**
| Column | Notes |
|---|---|
| `id` | bigserial PK |
| `user_id` | uuid null (signed-in users) |
| `session_id` | text: random ID per browser session; the only identifier for guests. **No address, IP or device data** |
| `surface` | `onboarding_preview` \| `home` |
| `widget` | e.g. `top_for_you`, `jurisdiction:city` |
| `content_item_id`, `position` | What was shown, and where |
| `score`, `signals` jsonb | The total and the per-signal points, e.g. `{"place":20,"interest":14.2,…}` |
| `reason` | The tag shown |
| `config_version` | Which weights produced it |
| `created_at` | |

**`feed_clicks`**: `impression_id` FK, `action` (`open` \| `stance` \| `bookmark` \| `follow`), `created_at`.

- Written in batches from the feed API (one insert per feed load, not per item).
- Retention: 180 days, then rolled up into daily per-signal click-through aggregates.
- On sign-up, the guest's `session_id` rows are linked to the new `user_id`.
- Used for the "which signals lead to clicks" panel in §8. Nothing else reads it at request time.

### 3.6 Additions in `023_shared_widgets.sql` (v1.2, D30)

Additive only; nothing in `020`–`022` changes.

| Change | Purpose |
|---|---|
| **`item_importance`**: `content_item_id` PK, `score` numeric(5,2), `components` jsonb, `computed_at` | The shared importance score (§6.2), recomputed every 15 minutes |
| **`places`** (gazetteer): `place_type`, `place_id`, `name`, `aliases` text[], `parent_place`, `covered` bool | Place-name list for D26: 50 states + DC, "federal", NYC, 5 boroughs, and every NTA neighborhood + alias (rows from the build plan's `neighborhoods` table). `covered` drives "Coming soon" |
| `interest_phrases` + `topic_text`, `place_type`, `place_id`, `parse_method` (`gazetteer` \| `llm` \| `none`), `parse_pending` bool | Stores the split "housing legislation" + California. The embedding is of `topic_text`, not the whole phrase |
| **`widget_cache`**: `widget_key` PK, `items` jsonb, `config_version`, `computed_at` | Precomputed shared widgets, e.g. `place:neighborhood:BK37`, `topic:housing`, `interest:housing legislation in california`, `politician:<uuid>`, `trending` |
| `ranking_config` v2 row | New weight shape (§6.2–6.4). v1 stays for history |

A user's widget list **isn't stored separately**: it's derived from their follows (`user_jurisdiction_follows`, `topic_follows`, `user_interests`, `legislator_follows`). The later widget-customization plan can add ordering.

---

## 4. Ingest & adapters

### 4.1 Adapter contract

```ts
// src/lib/ingest/types.ts
export interface SourceAdapter<Raw> {
  slug: string                                   // matches sources.slug
  fetchChanged(since: Date | null): AsyncIterable<Raw>
  toContentItem(raw: Raw): NormalizedItem | null // null = skip
}

export interface NormalizedItem {
  externalId: string
  itemType: ItemType
  title: string
  summary: string | null
  url: string
  jurisdictionLevel: JurisdictionLevel
  legislatureSlug?: string
  stage?: Stage
  statusRaw?: string
  introducedAt?: string
  lastActivityAt: string
  nextEventAt?: string
  isDead: boolean
  places: { type: PlaceType; id: string }[]
  people: { legislatorExternalId: string; role: PersonRole }[]
  topicSlugs?: string[]
  metadata?: Record<string, unknown>
}
```

A shared runner (`src/lib/ingest/run.ts`) handles everything else for every source: upsert by `(source_id, external_id)`, compute `content_hash`, replace places/people/topics, advance `sources.last_synced_at`. **Adapters never touch the database directly.**

### 4.2 Legistar (first adapter)

- Keep `src/lib/legistar/sync.ts` writing to `legislation` as it does today.
- Add `src/lib/ingest/adapters/nyc-legistar.ts`. It reads the synced `legislation` rows plus sponsors, history and events, and emits `NormalizedItem`s with `legislation_id` set.
- Places: every NYC Council bill gets `{city: 'nyc'}`. If the primary sponsor holds a district seat, it also gets `{council_district: N}`.
- One-time backfill script: `scripts/backfill-content-items.ts`.

### 4.3 Future adapters (not built in this plan)

| Source | Key mapping work |
|---|---|
| NY State Legislature | Map chamber → `state_senate` / `assembly` places; normalize stages |
| U.S. Congress | Map to `congressional` places; normalize stages |
| NYC neighborhood data | Geo-tag points/lines to NTA 2020 codes (spec §7.1); `item_type` = `project` / `budget_item` / `announcement` |
| News | Link articles to items or places; `item_type` = `news`; short half-life |

---

## 5. Embeddings pipeline

### 5.1 Item embeddings

- **Cron:** `/api/cron/embed-content`, every 2 hours, offset 30 minutes after the Legistar sync.
- **Selects:** items with no row for the active model, or whose `content_hash` differs from the stored one.
- **Text embedded:** `"{item_type}: {title}\n\n{summary}"`, truncated to the model's token limit.
- **Batching:** batched requests to Voyage, using `input_type: "document"`. Retry with backoff; on failure, leave rows unembedded for the next run.
- **Re-embed triggers:** a new AI summary arrives (hash change), or a model change.
- **Backfill:** `scripts/backfill-embeddings.ts`.

### 5.2 Stage normalization

| `stage` | Meaning | Stage score |
|---|---|---|
| `introduced` | Just filed | 0.3 |
| `in_committee` | Referred, no hearing | 0.4 |
| `hearing_scheduled` | Upcoming hearing | 0.8 |
| `passed_committee` | Voted out of committee | 0.9 |
| `passed_chamber` | Passed a full vote | 1.0 |
| `enacted` / `vetoed` | Final outcome | 0.6 |
| `dead` | Filed, withdrawn or expired | 0.0, and `is_dead = true` |

Each adapter owns the mapping from its own status strings to these stages.

### 5.3 Free-text interests → topic widgets (D13, D25, D26)

1. **Normalize** the phrase and look it up in `interest_phrases`. Cache hit = no API calls; go to step 6.
2. **Detect a place (gazetteer, instant):** longest match of the phrase against `places.name` / `aliases` (case-insensitive, word boundaries). Strip the place and its connector word ("in", "for", "around", "near") to get `topic_text`:
   - "housing legislation in California" → topic **"housing legislation"** · place **state:CA**
   - "Park Slope bike lanes" → topic **"bike lanes"** · place **neighborhood:BK37**
   - "high-speed rail" → topic **"high-speed rail"** · no place
3. **Async AI fallback (D26):** if no place matched but the phrase looks like it names one (a capitalized word that isn't a known topic, or "in/near/around + word"), set `parse_pending = true` and queue **one Claude Haiku call** in the background. It returns `{topic_text, place}` as JSON validated against the `places` table (it can't invent places). The widget shows results without a place filter meanwhile, then **re-ranks itself** once the parse lands. **No AI call ever blocks the request.** Uncertain parses are logged for the admin review list.
4. **Embed `topic_text`** with one Voyage call (`input_type: "query"`) and store it.
5. **Coverage:** if the place isn't `covered` (e.g. California today), the widget is created anyway and shows **"Coming soon — we don't cover California yet."** It fills in automatically once an adapter brings that content.
6. **Rank** the widget per §6.4 (topic formula), filtered to the place when there is one, and cache it as `interest:{normalized phrase}`. Two users who type the same phrase share one widget.
7. **Related-topic suggestions (D18)**, unchanged: the closest existing topics appear as **tap-to-add** buttons ("+ Transit"). Tapping one adds a `topic:{slug}` widget.

**Topic chips** (the existing flat topics) work the same way without steps 2–4: relevance is **1.0** for items tagged with the topic, otherwise the item's similarity to the topic's embedding (so untagged long-tail items still qualify above the floor).

**Spec §14 criteria still hold:** chip taps make 0 model calls; a new typed phrase makes at most 1 embedding call in the request path, and the optional Haiku parse runs outside it.

---

## 6. Ranking engine (v1.2: shared widgets)

### 6.1 Overview

Every scored widget is the same for everyone (D22). A background job every 15 minutes:
1. recomputes each item's **importance** (§6.2) and **recency** (§6.3),
2. ranks every widget anyone follows (§6.4), plus all jurisdiction and neighborhood widgets and Trending,
3. applies the sponsor cap (§6.5) and writes `widget_cache`.

A widget nobody has requested before (a brand-new typed phrase) is ranked on demand once, then joins the 15-minute cycle.

### 6.2 Importance score (0–100, D28)

| Component | Weight | Computation |
|---|---|---|
| **Stage reached** | 30 | Stage score from §5.2 |
| **Cosponsors** | 15 | Cosponsor count as a percentile within the same legislative body and item type |
| **Hearings** | 10 | Held or scheduled hearings on the item (1 = 0.5, 2+ = 1.0) |
| **On-platform engagement** | 45 | See below |

**Engagement**, following common ranking practice (§15):
- Weighted actions over the last 30 days: stance ×3, comment ×2, save ×2, view ×0.2. **All stance directions count the same**; which side people took is never an input.
- **New-account cap (D31):** actions from accounts **younger than 7 days** count ×0.25, and guests' views count ×0.1. Thresholds are tunable in the weights editor. **[PROPOSED values]**
- **Log-scaled** (`log(1 + x)`), so the first 10 stances matter as much as the next 100 and pile-ons can't run away.
- **Bayesian-smoothed** toward the average for that level (prior weight 10), so an item with 2 stances can't outrank one with 200 on a lucky ratio.
- Converted to a **percentile within the same level**, so neighborhood items aren't drowned out by citywide ones.

**Adjustments:** dead items are excluded from every widget except Tracked. Ceremonial items are not capped (D29).

**Reserved for later (weight 0 until the sources exist):** news mentions and lobbying filings (§15). Adding them means a new adapter plus a weight in `ranking_config`. No schema change.

**Neutrality:** party, ideology and stance direction are never read. A unit test asserts it.

### 6.3 Recency (0–1)

`recency = max(activity, upcoming)`, where activity = `exp(−days_since_last_activity / 14)` and upcoming = 1.0 for a hearing or vote within 7 days, falling to 0 at 30 days. The half-life (14 days) is tunable in the weights editor.

### 6.4 Widget formulas

| Widget | Candidates | Score |
|---|---|---|
| **Jurisdiction / place** (`jurisdiction:city`, `place:neighborhood:BK37`) | Live items at that level / tagged with that place | **0.6 importance + 0.4 recency** (D24) |
| **Topic** (`topic:{slug}`, `interest:{phrase}`) | Items tagged with the topic, plus the top 300 nearest neighbors by embedding; filtered to the phrase's place if any; **all levels** (D25); above the relevance floor | **0.5 relevance + 0.3 recency + 0.2 importance** (D25). Relevance = similarity mapped to 0–1 between the floor (0.30) and ceiling (0.60) |
| **Politician** (`politician:{id}`) | Items the politician is attached to | **0.6 importance + 0.4 recency**, ×0.6 when they're a co-sponsor rather than the primary sponsor (D27) |
| **Trending** | All live items with engagement in the last 7 days | Engagement only, with gravity decay: `log(1 + engagement_7d) / (hours_since_last_engagement + 2)^1.8` (§15) |
| **Tracked** | The user's followed legislation | Not scored: next event first, then latest activity |
| **Friend activity** | Items people the user follows acted on | Not scored: most recent action first |

**Neighborhood fallback** (spec §7.1): a neighborhood widget with fewer than 3 items is topped up from adjacent neighborhoods in the same borough, labeled "Nearby: [name]."

### 6.5 Balance: sponsor cap (D11)

In every scored widget, **at most 2 items with the same primary sponsor among the visible slots.** Items over the cap drop below the fold. (Not applied to politician widgets, where every item is that person's by definition.)

**Cross-widget duplicates (D32):** allowed. A bill can appear in both the NYC widget and the Housing widget; they're different lenses.

### 6.6 Item labels

Since rankings are shared, the **widget header** carries the "why" ("Because you follow Housing", "Park Slope"). Items carry **context labels** instead of personal reasons: "Hearing Thursday", "Passed committee", "Trending", "42 people weighed in", and "New ·" in the onboarding preview.

### 6.7 Politician ranking for onboarding S3 (D20)

A ranking of **people**, behind the S3 group "Active in your jurisdictions".

- **Candidates:** active legislators in the user's selected jurisdictions (or all covered jurisdictions if none are selected, headed "Active in New York"), **excluding** the user's own representatives, who already appear in "Your representatives."
- **Activity score** (0–100), refreshed with the 15-minute cycle:
  | Signal | Weight | Computation |
  |---|---|---|
  | Bills introduced (30 days) | 40 | Primary sponsorships, log-scaled, as a percentile within the same body |
  | Upcoming votes/hearings (14 days) | 35 | Items they sponsor with `next_event_at` in the window |
  | Recent actions (30 days) | 25 | Any `last_activity_at` on items they're attached to |
- **Reason line** = the strongest signal: "Introduced 4 bills this month", "Vote on Thursday".
- **Cap:** 8, plus "See more". **Party is never read.** Bodies are interleaved.
- **Audit:** a monthly admin report compares the party mix of the top 8 with each body's actual mix and flags large gaps (spec §S3). No auto-correction.
- Endpoint: `GET /api/politicians/active?jurisdictions=…`, cached 15 minutes.

### 6.8 Zero selections (spec §7.3)

A user with no follows sees the **NYC** widget and **Trending**, headed "Popular right now," with a "Personalize" button. Federal and State join once live.

---

## 7. Feed API & widgets

### 7.1 Server function

```ts
// src/lib/feed/getFeed.ts
getFeed(ctx: UserContext, opts?: { previousItemIds?: string[]; size?: number }): Promise<FeedResponse>
```
It derives the user's widget list from their follows (or the guest session), reads each scored widget from `widget_cache`, fills Tracked and Friend activity live, and returns them in layout order.

### 7.2 Widget types & default layout

| Widget | Key | Shared? | Default size |
|---|---|---|---|
| Jurisdiction | `jurisdiction:{level}` | ✅ | 5 + "See all" |
| Neighborhood | `place:neighborhood:{nta}` | ✅ | 5 + "See all" |
| Topic (chip) | `topic:{slug}` | ✅ | 5 + "See all" |
| Topic (typed) | `interest:{normalized phrase}` | ✅ | 5 + "See all" |
| Politician | `politician:{id}` | ✅ | 5 + "See all" |
| Trending | `trending` | ✅ | 5 |
| Tracked | `tracked` | Per user | 5 |
| Friend activity | `friend_activity` | Per user | 5 |

**Default layout** (until the customization UI exists), **[PROPOSED]** order:
1. Jurisdiction widgets: Federal → State → City (only live ones)
2. Neighborhood widgets
3. Topic widgets, in the order the user added them
4. Politician widgets
5. Tracked → Trending → Friend activity

**Onboarding preview:** the same widgets, 3 items each, updating live. S2 adds jurisdiction/neighborhood widgets, S3 adds politician widgets, S4 adds topic widgets. On mobile, the peek card shows the first 2 items plus the total count.

### 7.3 Endpoints

- `POST /api/feed`: body `{ widgets, guestContext?, previousItemIds? }`. Signed-in users' context is loaded server-side. Guests send their session context, validated with zod; **no address data is accepted**. The response includes, per widget, the items, their reasons, which are **new** compared with `previousItemIds`, and counts. That's what drives the preview's "Added 3 items from New York City · 6 items" live-region text and the "New ·" tags.
- `POST /api/interests/resolve`: phrase → the parsed topic and place (with coverage status), the widget's first items, and 2–3 related-topic suggestions, for onboarding S4.
- `GET /api/politicians/active`: S3 list (§6.7).

### 7.4 Caching & performance

| Path | Strategy | Budget (spec §6) |
|---|---|---|
| Toggle jurisdiction / politician / chip | Cache read of a precomputed widget | p95 ≤ 300 ms (typically far less) |
| New typed interest | Phrase cache → gazetteer → at most 1 Voyage call + vector search, ranked once, then cached | p95 ≤ 800 ms |
| Home page | Cache reads + two small live queries (Tracked, Friends) | — |
| Weights change | The cache key includes `config_version`, so the next 15-minute cycle serves the new ranking | — |

---

## 8. Admin tooling

- **Ranking inspector** (`/admin/ranking`): pick any widget (NYC, Park Slope, Housing, a politician) to see its items with each score component (importance parts, recency, relevance).
- **Weights editor** (`/admin/ranking/weights`, D16):
  - Sliders for the importance components (§6.2), each widget blend (§6.4), recency half-life, trending gravity, new-account cap (age threshold and multiplier), sponsor cap, relevance floor/ceiling, and the §6.7 politician weights.
  - **Preview before saving:** a fixed set of sample widgets (NYC, Park Slope, Housing, "bike lanes", one politician, Trending), current vs. proposed, side by side, with items that moved highlighted.
  - **Save** creates a new `ranking_config` version with a required note ("Boost timeliness for budget season"). Older versions stay.
  - **Rollback:** make any earlier version active in one click.
  - Changes reach users within the 10-minute feed cache. The cache key includes the version, so no manual flush is needed.
  - **Signal performance panel:** click-through rate by widget type and position, from `feed_impressions` / `feed_clicks` (§3.5), filterable by weights version. This shows whether a change helped.
  - Admin-only (existing `is_admin` flag).
- **Similarity calibration view:** for a typed phrase, list nearest items with their cosine scores to set the relevance floor and ceiling (§6.4).
- **Phrase review list:** typed interests whose place parse was uncertain or came from the AI fallback (§5.3), to confirm or correct.
- **Source health:** last sync time, items ingested, items awaiting embedding, and error counts per source.

---

## 9. Testing

| Layer | Tests |
|---|---|
| Adapters | Fixture raw records → expected `NormalizedItem` (one test file per adapter) |
| Scoring | Unit tests for importance components, recency and each widget formula; assertions that **party and stance direction are never read** |
| Place parsing | Gazetteer cases ("housing in California", "Park Slope bike lanes", "DUMBO", no place); AI fallback output rejected unless the place exists in `places` |
| Re-rank | Sponsor-cap edge cases (one prolific sponsor, ties) |
| Widget snapshots | Snapshot-tested top-10s for the sample widgets above, to catch weight-change regressions |
| Performance | Load script measuring p95 against the §7.4 budgets on a 300k-item synthetic table |

---

## 10. Phased delivery

| Phase | Deliverable | Depends on |
|---|---|---|
| **0. Setup** | ✅ Folded into Phase 1 | — |
| **1. Content layer** | ✅ Done (§14) | — |
| **2. Embeddings** | ✅ Done (§14) | 1 |
| **3. Shared ranking** | ✅ Done (§14); neighborhood "Nearby" fallback waits on NTA adjacency (build plan B1) | 2 |
| **4. Feed & widgets** | `getFeed`, `/api/feed` (with new-item diff), default layout (§7.2), guest session, zero-selection view, onboarding preview wiring, related-topic suggestions, impression/click logging | 3 + onboarding UI |
| **5. Tuning** | Ranking inspector, weights editor, signal performance panel, calibration view, phrase review list, source health, S3 party-mix audit | 4 |
| **6. More importance signals** (later) | News-mention source and NYC lobbying adapter feeding importance (§15) | 3 |

---

## 11. Changes to `onboarding-spec.md` this plan implies

| Spec section | Change |
|---|---|
| §2 Geography | "All 50 states at launch" → **NYC first; other states via adapters later** (D5) |
| §7.2 items 1, 3a, 3d, 4 | Curated topic graph, alias cache and curation workstream → **replaced by direct embedding match against items** (D13). Flat topics remain for chips. **Q7 (topic owner) is no longer a launch blocker** |
| §7.2 item 5 | Vector store decided: **pgvector in Supabase**, embeddings from **Voyage AI** |
| §S3 "Active in…" politician suggestions | Activity score defined in §6.7 (news volume added once a news adapter exists) |
| §S4 adjacency feedback | Related topics are **tap-to-add suggestions**, not auto-added (D18) |
| §6 live preview / provenance tags | Picking a topic or politician **adds a widget** instead of re-ranking banners; "Matches: X" / "Because you follow X" move from items to the **widget header** (D22, §6.6) |
| §7.3 Popular feed | NYC + Trending widgets (§6.8) |

---

## 12. Open questions

| # | Question | Why it matters |
|---|---|---|
| ~~Q1~~ | ~~Review the onboarding mockup~~ **Resolved 2026-11-22:** reviewed; changes captured in D18, D19, D21, §6.4 and §7.2–7.3 | — |
| ~~Q2~~ | ~~Starting weights~~ **Resolved:** approved (D15), tunable via the weights editor (D16) | — |
| ~~Q3~~ | ~~S3 politician ranking~~ **Resolved:** in this plan (D20, §6.7) | — |
| Q4 | Similarity floor/ceiling values | Need real embeddings to calibrate (Phase 5) |
| ~~Q5~~ | ~~Log impressions?~~ **Resolved:** yes (D17, §3.5) | — |
| Q6 | Update the mockup: switch related topics to tap-to-add; show topic and politician widgets on S6 (no "Top for you", D23) | Keeps the design and the plan in sync |
| Q7 | The mockup's in-feed card suggests "Follow Brooklyn **Borough** projects?", but spec §3 says boroughs aren't followable | Resolve when suggestion cards are planned (phase 2) |
| Q8 | Council Land Use items (`project`, neighborhood level) cover the same ULURP applications as `local_proposals` (from `feature/neighborhood-map`, already in the live DB). Link, merge or replace them so the neighborhood banner doesn't show duplicates | Decide before Phase 3 |

| Q9 | Which news source for importance: GDELT (free, global, measures share of coverage, noisy matching) or NYC outlets' feeds (THE CITY, Gothamist, City & State, Politico NY), matched by bill number/title? | Decides Phase 6 |
| Q10 | NYC eLobbyist open data: confirm how bill numbers appear in the dataset before building the adapter | Decides Phase 6 |
| ~~Q11~~ | ~~Brigading~~ **Resolved:** cap new-account engagement (D31) | — |
| ~~Q12~~ | ~~Cross-widget duplicates~~ **Resolved:** allowed (D32) | — |

## 13. Housekeeping

~~`CLAUDE.md` is out of date~~ **Done in Phase 1** (Next.js 16, Haiku 4.5, pointer to this plan).

## 14. Done log

One short section per finished phase: what shipped, decisions made during the build that this plan didn't cover, and anything left open.

### Phase 1 — Content layer ✅ (2026-11-22, commit `e3cb205`)

**Shipped:** migration `020_content_layer.sql` (all §3 tables, pgvector enabled, D15 weights seeded as `ranking_config` v1) and `021_lock_down_definer_functions.sql`, both applied. `src/lib/ingest/` (contract, runner, NYC Legistar adapter). `/api/cron/ingest-content` at `15 */2 * * *`. `npm run backfill:content` (ran: 9,169 items; re-run writes 0). Vitest adapter tests (`npm test`). `VOYAGE_API_KEY` is set in `.env.local` and in Vercel (Preview, `feature/onboarding` only; add Production at merge).

**Decisions made during the build:**
- **Numbering:** migration is `020`, not `014`. `feature/neighborhood-map` already applied 014–019 to the live DB.
- **Phase 0 folded in:** 020 enables pgvector and holds the full §3 schema in one migration.
- **Which Legistar rows:** Intros → `bill`, Resolutions → `resolution`, Land Use (`LU`) → `project`, T-items whose title starts with "Oversight" → `hearing`. Skipped: Mayoral communications (`M`), `SLR`, other T-items.
- **Land Use items:** `jurisdiction_level = neighborhood`. Places are the council districts parsed from the title (155 have none). No people attached: the listed sponsor is the subcommittee chair, not the local member.
- **Stage mapping** (in `adapters/nyc-legistar.ts`): Introduced → introduced; Committee / Laid Over / Deferred → in_committee (→ hearing_scheduled with a future event); Reported from Committee (+ and Introduced) / General Orders / Coupled on Call-Up / Companion Pending → passed_committee; Enacted (Mayor's Desk) → passed_chamber; Enacted / Adopted / Local Laws → enacted; Vetoed / Disapproved → vetoed; Filed / Filed (End of Session) / Withdrawn / Defeated / Received, Ordered, Printed and Filed → dead.
- **Change detection:** `legislation.updated_at` never changes, so the Legistar adapter scans everything each run (~10s). The runner hashes each resolved item (`ingest_hash`) and skips unchanged rows. `content_hash` (title + summary) is kept separately for re-embedding.
- **Person IDs:** a new `legislator_external_ids (source_id, external_id) → legislator_id` table. A trigger keeps Legistar IDs in sync. The contract also gained an optional `legislationId`.
- **Writes** go through one transactional function, `upsert_content_items()`, callable by the service role only.
- **Hearings:** `syncEvents()` is now called from the sync-legislation cron, so `next_event_at` and `hearing_scheduled` start filling in after deploy.

**Left open:** Q8 above. `syncEvents()` shares the sync cron's 300s budget; move it to its own cron if timeouts appear. The HNSW index assumes `voyage-3.5`; recreate it if Phase 2 picks a different model.

### Phase 2 — Embeddings, part 1 ✅ (2026-11-21, commit `0c7296b`)

Built to the **v1.1** Phase 2 scope, before v1.2 landed. The v1.2 additions to Phase 2 are listed under *Left open*.

**Shipped:** migration `022_embeddings.sql` (applied): `content_items_to_embed`, `interest_phrase_hit`, `store_interest_phrase`, `match_phrase_items`, `match_phrase_topics`, all service-role only, plus a `content_hash` column on `topic_embeddings`. `src/lib/embeddings/` (Voyage client with retry/backoff, embed jobs, phrase normalization and resolve). `/api/cron/embed-content` at `30 */2 * * *` (240s budget per run). `POST /api/interests/resolve`, rate-limited to 60/hour per IP. `npm run backfill:embeddings` (ran: 9,169 items + 27 topics, ~800K tokens, 102s; re-run writes 0). Vitest tests for normalization, embedding text, the Voyage client and topic picking. `VOYAGE_API_KEY` is now also set for Production in Vercel.

**Decisions made during the build:**
- **Model:** stayed on `voyage-3.5` (1024-d), so the 020 HNSW index stands. `voyage-4` also works with this key at 1024-d. Switching means changing `EMBEDDING_MODEL`, recreating the partial index and re-running the backfill. No schema change.
- **Topic text:** `topics` has no description column, so the one-line descriptions live in `TOPIC_DESCRIPTIONS` in `embed-content.ts`. Topics not in the map embed from their name alone. The hash covers name + description, so editing either re-embeds on the next cron.
- **Phrase matching runs in SQL by cache key.** The phrase vector never leaves the DB. Topic suggestions use SQL too (v1.1 said "in memory"); at 27 rows that comes to the same thing.
- **Topic suggestion rule (D18):** a topic needs similarity ≥ 0.40 **and** must be within 0.06 of the best topic, max 3. A floor alone surfaced generic topics ("Small Business" scores ~0.44 against "bike lanes"). Sample results: bike lanes → Transportation; rent control → Housing & Rent; dog parks → Parks & Recreation; high-speed rail → Transportation; rats / e-bike batteries → none.
- **Item floor** comes from the active `ranking_config.params.similarity_floor` (0.30).
- **Pre-filters by `jurisdiction_level` only** (optional `levels`), plus `not is_dead`.
- **`excludeTopicIds`** on the resolve endpoint, so topics the user already follows aren't suggested back.
- Phrase cache: a row stored under a different model counts as a miss and is overwritten.
- **Normalization:** punctuation becomes a space ("high-speed rail" → "high speed rail").

**Measured:** cache hit ~180 ms; miss (one Voyage call) 330–890 ms, run from a laptop against live Supabase. On-topic items score ~0.55–0.65 and loose matches ~0.38–0.48, so the 0.30 item floor is probably low (Q4).

**Left open:**
- ~~**v1.2 Phase 2 additions not built**~~ **Done in part 2 below.**
- `/api/interests/resolve` wasn't HTTP-tested locally (`.env.local` has no `KV_REST_API_*`, and the local dev server hung). Only the library path behind it was exercised, against live data. Smoke-test it on the Preview deploy.
- Duplicate topics (Housing / Housing & Rent, Land Use / Land Use & Zoning, Finance & Budget / Budget & Finance, Seniors / Senior Services, Youth Services / Youth & Families, Civil Rights / Civil Rights & Equity) split suggestions, and under v1.2 would create near-duplicate topic widgets. Worth merging before onboarding ships.

### Phase 2 — Embeddings, part 2 (v1.2 additions) ✅ (2026-11-22)

**Shipped:** migration `023_shared_widgets.sql` (applied): `item_importance`, `places`, `widget_cache`, the `interest_phrases` topic/place columns, `ranking_config` **v2 (now active**; v1 kept), and service-role functions `interest_phrase_lookup`, `store_interest_phrase_parsed`, `claim_interest_parse`, `complete_interest_parse`, `expand_place`, `match_interest_items`. `024_place_filtered_match.sql` (applied) fixes the place path of `match_interest_items`. Places seed: 397 rows from `scripts/generate-places-seed.ts` (NYC Open Data NTA 2020 list + hand lists). `src/lib/embeddings/places.ts`: gazetteer match, "looks like a place" check, Haiku fallback. `/api/interests/resolve` returns the v1.2 shape: `widgetKey`, `topicText`, `place` (with `covered`), `comingSoon`, `parsePending`, place-filtered items, related topics. Haiku runs after the response via `after()`. 14 new tests (44 total).

**Decisions made during the build:**
- **No `neighborhoods` table yet** (build plan B1), so NTAs were seeded straight into `places` from Open Data (`9nt8-h7nd`). B1 adds geometry/adjacency in its own table; NTA codes are 2020 (`BK0602`), not the 2010 codes in the plan's examples.
- **`area` place type + `members` column:** common names covering several NTAs ("Harlem", "Astoria", "Bed-Stuy", "UWS"; 26 in all) filter to all their member NTAs. Names shared across boroughs go to the better-known one ("Murray Hill", "Chelsea" → Manhattan) or are dropped (cemeteries, Jamaica Bay).
- **Also seeded:** boroughs (`borough:BK`) and the 51 council districts, with `parent_place` so a borough expands to its districts + NTAs. Council districts map to boroughs by number (legislators' `borough` is empty); 8 and 34 straddle borough lines.
- **Bare "New York" = NYC.** "New York State" / "NY state" / "Albany" → `state:NY`. Every state, DC and federal are `covered = false` ("Coming soon"). State postal codes aren't aliases (they collide with words once lowercased).
- **Place filter = the place plus everything inside it** (via `parent_place` and `members`). Federal filters on `jurisdiction_level` since it has no place tags.
- **Phrase that is only a place** ("Park Slope") keeps the whole phrase as its topic.
- **Cache reuse:** a phrase whose topic is already cached ("park slope bike lanes" → "bike lanes") copies that vector, no Voyage call.
- **Haiku fallback:** triggers on "in/near/around + word" or a capitalized non-first word that isn't a topic word. One call per phrase via `claim_interest_parse` (a claim older than 5 minutes can be retaken). The answer is kept in `parse_raw` for the phrase review list (§8); places Haiku names that aren't in the gazetteer are rejected (e.g. "Hoboken"). On error the phrase stops pending rather than retrying.
- **Place-filtered search is exact, not HNSW** (024): collect the place's items via the `(place_type, place_id)` index, score them in a materialized CTE. ~200 ms for all of NYC (9k items); the 023 version timed out.
- **Items are ordered by similarity only.** The §6.4 topic formula and writing `widget_cache` stay in Phase 3. `match_phrase_items` / `interest_phrase_hit` / `store_interest_phrase` from 022 are now unused; drop them later.
- **Seed loading:** the 023 schema went through the Supabase migration tool; the places rows were upserted with `generate-places-seed.ts --apply` (identical to 023's seed block, which runs in full on a fresh DB).

**Measured (laptop → live Supabase):** cached phrase ~500–850 ms incl. place filter; new phrase with a cached topic ~400–700 ms; first call in a cold process ~3 s (gazetteer load).

**Left open:**
- **Neighborhood and area phrases return no items** until content is tagged to NTAs (B3 neighborhood adapter). Borough results are mostly bills whose *sponsor* represents a district there (Phase 1 tagging), not bills about that borough.
- **Parse quirks:** a place name inside a longer proper noun gets stripped ("noise near Gowanus canal" → topic "noise canal"; "Staten Island ferry" → topic "ferry", filtered to Staten Island). Common-word NTA aliases ("Corona", "Madison", "Utopia") can misfire. Review in the Phase 5 phrase review list.
- **At 300k items** the exact path for city-wide places would scan most items; revisit with the Phase 3 precompute (cached widgets make it a background cost).
- `/api/interests/resolve` still not HTTP-tested (no local `KV_REST_API_*`); smoke-test on the Preview deploy. The test phrases from this build are left in `interest_phrases` as cache rows.
- `NYC_GEOCLIENT_KEY` is now in `.env.local` (for build plan B1); not yet in Vercel.

---

### Phase 3 — Shared ranking ✅ (2026-11-22)

**Shipped:** migration `025_ranking_inputs.sql` (applied): read-only service-role functions `ranking_item_inputs`, `topic_candidates`, `politician_item_roles`, `place_item_ids`, `item_rank_context`, plus `widget_cache.last_requested_at`. `src/lib/ranking/`: `score.ts` (importance §6.2, recency §6.3, widget formulas §6.4, sponsor cap §6.5, all pure), `politicians.ts` (S3 activity §6.7), `precompute.ts`, `config.ts`. `/api/cron/rank-widgets` at `5-59/15 * * * *` (offset from refresh-stats); `npm run rank:widgets`. `GET /api/politicians/active?jurisdictions=…&exclude=…` (cap 8, bodies interleaved, `heading`, `hasMore`). `/api/interests/resolve` serves the cached `interest:{phrase}` widget, or ranks it once with the §6.4 topic formula and caches it. 20 new tests (64 total): importance, recency, sponsor-cap edge cases, a neutrality guard that fails if party/ideology/stance direction is read, S3 scoring, and snapshot top-10s for sample widgets on a fixed fixture.

**Ran live:** 5,063 live items scored; 82 widgets (`jurisdiction:city`, 27 `topic:*`, 52 `politician:*`, `trending`, `politicians:active`) in ~20 s. Importance spans 9–64 (median 23). Interest widget: first request ~1 s warm (up to 3 s cold), then ~300 ms from cache.

**Decisions made during the build:**
- **Scoring in TypeScript, inputs in SQL.** SQL aggregates per item so raw per-user rows never leave the DB; party is never selected anywhere. Makes the snapshot and neutrality tests possible.
- **Engagement sources:** views from `engagement_events`; stances (all four states, incl. watching; direction never read), comments (not hidden) and saves from their own tables, since comments are never logged as events. Account age = `user_profiles.created_at` at the time of the action; no profile counts as a new account.
- **Hearings:** "Hearing Held by Committee", "Hearing on P-C Item by Comm" and "Hearing Held by Mayor" history actions, plus scheduled future events. (Only 5 `events` rows link to a bill; history covers ~3,900.)
- **Smoothing (§6.2):** items with no actions score 0; engaged items are smoothed toward the mean of *engaged* items at their level, weighted by action count (prior 10). Smoothing toward an all-items mean would rank an item with one guest view below items with none. Percentiles make any monotonic transform a no-op, so the smoothing only matters when evidence (action count) differs at equal totals.
- **S3 (§6.7):** all three signals log-scaled → percentile within the body (the plan specified it for bills only). Reason line = strongest signal with a non-zero count: "Introduced N bills this month", "Hearing on Thursday" (≤ 7 days) / "N hearings in the next 2 weeks", "Active on N items this month". Stored in `widget_cache` as `politicians:active`; the endpoint filters by body and `exclude`. Selected places map to NYC Council for every NYC place type; other places have no body yet.
- **Cache contents:** top 30 items per widget (for "See all"), self-contained (title, stage, URL, dates, score, signals) so a page load is one read. The sponsor cap applies to the first 5 slots.
- **Which widgets the cycle ranks:** jurisdiction levels with items; every NTA (stored only if it has items) plus followed places; every topic; interest phrases someone follows or requested in the last 7 days; every active legislator; trending. Widgets the run didn't produce are deleted (on-demand writes during the run survive).
- **On-demand ranking** reads importance + primary sponsors for its ≤ 300 candidates via `item_rank_context`. Request paths cache the ranking config for 60 s; the precompute always reads it fresh. A finished Haiku parse deletes the interest widget so the next request re-ranks with the place.

**Left open:**
- **Neighborhood "Nearby" fallback** (§6.4) needs NTA adjacency from build plan B1; no neighborhood has items yet anyway (B3).
- ~~**Joint hearings are duplicated**~~ **Fixed below** (follow-up fixes).
- **Trending is empty** (no engagement in the last 7 days) and **no item has `next_event_at`**, so "upcoming" recency and the S3 hearing signal are idle until events link to bills.
- **Latency:** the new-phrase path is ~1 s warm, over the §7.4 800 ms budget, and cold-cache DB reads vary 10× (13–956 ms for the same vector query). Likely the instance's memory vs ~80 MB of vectors + HNSW index. Settle with the §9 load test; options are a larger compute tier or caching more aggressively.
- **Q8** (Land Use items vs `local_proposals`) didn't block Phase 3 (`local_proposals` aren't in `content_items` yet) but must be decided before the B3 neighborhood adapter.
- Hearing items' `last_activity_at` is the hearing date, which can be in the future; recency treats that as "now" (1.0).

**Follow-up fixes (same day, product-owner decisions):**
- **T-numbered Intros/Resolutions removed.** `classify` checked the matter type before the T prefix, so 323 pre-filing T records (283 with an identical Int/Res twin) were in `content_items` as duplicates, against the Phase 1 decision. The adapter now checks the T prefix first (only "Oversight" hearings pass), and the 323 rows were deleted (their `legislation` rows and bookmarks are untouched).
- **Land Use resolutions credit no one and live in the neighborhood level.** The Council's decisions on Land Use applications (Land Use committee or its subcommittees; not "calling on / in support of / urging" policy resolutions) are filed under the Land Use chair, which put Kevin C. Riley at the top of S3 with 18 "bills" (2 were his). Like Land Use items, they now have no people and `jurisdiction_level = neighborhood`, placed by the council districts in their title, or else in the title of the LU item they cite ("L.U. No. 143" → `LU 0143-2026`; 676 of 706 link). 28 have no district. Committee names are attached in the adapter from `committee_id` (there's no FK to embed).
- **S3 "introduced" counts bills and resolutions**, worded by what was filed ("Introduced 2 bills and resolutions this month").
- **Council decisions folded into Land Use items.** A Land Use resolution that cites an LU item ("L.U. No. 143") is no longer its own item: the LU item carries `metadata.council_decision` (`fileNumber`, `outcome`: approved / approved_with_modifications / disapproved / affirmed / other, `status`, `date`, `url`), and the decision date counts toward its `last_activity_at`. Statuses already agreed (648 Adopted↔Adopted, 15 Disapproved, 10 Filed; no LU item has two decisions). 676 folded; the 30 with no linkable LU item stay as neighborhood resolutions crediting no one.
- **Joint hearings deduped.** Oversight T-items with the same title on the same date are one hearing: the lowest file number is emitted, with `metadata.committees` (all of them) and `metadata.joint_file_numbers`. 262 joint hearings, 330 extra filings dropped. Same-title hearings on different dates stay separate. Every hearing item now lists its committee(s).
- **The runner prunes for full-scan adapters** (`SourceAdapter.fullScan`, set for NYC Legistar): after a clean run, items the adapter no longer emits are deleted, so skipped or folded items can't linger the way the T duplicates did. It refuses to prune more than 25% of a source in one run. First run removed 1,006 (676 decisions + 330 hearings).
- **Still open:** Land Use items are tagged to council districts, but neighborhood widgets are keyed by NTA, so they won't appear in a neighborhood widget until there's a district → NTA crosswalk (build plan B1/B3).
- **Hearing dates → `next_event_at`.** An oversight hearing's intro/last-action date is the hearing date. Upcoming hearings now carry it as `next_event_at` (stored as 17:00 UTC, midday Eastern, so the New York weekday is right), which also moves them to `hearing_scheduled` like any item with an upcoming event. `last_activity_at` now only uses dates that have passed, for every item; when all of a row's dates are ahead, it falls back to `legislation.created_at` (when our sync first saw it). After the hearing, the next run makes the hearing date its last activity. Live: 19 upcoming hearings, no future `last_activity_at`. Hearings still lead `jurisdiction:city` (recency 0.82–1.0, from being scheduled recently, plus the stage bump to 0.8). That's the formula as designed; tune with weights if it's too much.

---

## 15. Research notes: measuring importance

What established practice suggests for the importance score (§6.2) and how it's applied here.

| Finding | Applied as |
|---|---|
| Political scientists rate bills **commemorative / substantive / substantive & significant**; "significant" is coded from **newspaper mentions** and end-of-year summaries, and weighted ~10× ([Volden & Wiseman; Bucchianeri, Volden & Wiseman 2024, APSR](https://thelawmakers.org/wp-content/uploads/2024/01/BVW_SLES_Jan2024.pdf), [Senate adaptation](https://thelawmakers.org/wp-content/uploads/2018/12/VoldenWisemanJOP2018.pdf)) | News mentions as a future importance input (Phase 6). The ceremonial distinction was considered and not adopted (D29) |
| Bill-passage prediction (GovTrack's prognosis via PredictGov) uses sponsor, **cosponsors**, amendments and bill text; cosponsor count and sponsor's committee role correlate most with success ([Vanderbilt on PredictGov](https://engineering.vanderbilt.edu/news/2017/john-nay-ai-predictgov/), [independent analysis](https://medium.com/@elizabethjafek/predicting-the-path-of-congressional-bills-cf1105f7c6c8)) | Stage, cosponsor and hearing components. Bipartisanship skipped: not meaningful at NYC Council |
| NYC publishes **eLobbyist data as open data, including bill numbers** ([Reinvent Albany](https://reinventalbany.org/2019/04/after-long-campaign-by-watchdogs-city-publishes-lobbying-information-as-open-data/), [data.gov listing](https://catalog-old.data.gov/dataset/city-clerk-elobbyist-data)) | Future lobbying component (Phase 6, Q10) |
| **GDELT DOC 2.0** gives free news-volume timelines back to 2017, as **share of coverage**, not raw counts ([GDELT blog](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)) | Candidate news source (Q9) |
| Feed ranking practice: **log-scale votes** so early votes don't snowball, **gravity decay** `(age + 2)^1.8` for "hot" lists, **Wilson/Bayesian lower bounds** so small samples don't win ([Hacker News ranking](https://www.righto.com/2013/11/how-hacker-news-ranking-really-works.html), [Lemmy ranking docs](https://join-lemmy.org/docs/contributors/07-ranking-algo.html)) | Engagement component (log + smoothing); Trending formula (gravity) |

**Risks noted:** engagement can be brigaded (handled by D31); news coverage favors controversial bills over quietly impactful ones. Mixing several independent, capped, log-scaled signals limits both.
