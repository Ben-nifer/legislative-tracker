# Recommendations Plan — Content Layer, Embeddings & Feed Ranking

**Status:** Draft v1.1 · 2026-11-22 · **Phase 1 done** (see §14 Done log) · Built from product-owner interview answers and a review of the onboarding mockup (Claude design canvas "Civic App Onboarding": iPhone clickable flow + web split view).
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
| D7 | Ranking signals | Followed jurisdiction/district, followed politician, interest match, timeliness, bill stage, the user's own history, friends' activity. Popularity counts as a **moderate** factor. **[DECIDED]** |
| D8 | Down-ranking | **Stale / dead bills** only. **[DECIDED]** |
| D9 | Freshness | **Every 2 hours** (the current Legistar sync cadence). **[DECIDED]** |
| D10 | Feed layout | A **"Top for you"** strip, then **jurisdiction banners** (Federal → State → City → Neighborhood). **[DECIDED]** |
| D11 | Balance rule | **Cap per sponsor.** **[DECIDED]** |
| D12 | Home page | The home page is made of **widgets** (Top for you, banners, Tracked, Trending, Friend activity…). This plan builds the **engine plus a fixed default layout**. The widget customization UI gets its own plan. **[DECIDED]** |
| D13 | Interest matching | **Keep the existing flat topics.** Free-text interests ("high-speed rail") match **directly against item embeddings**. No curated topic graph or aliases. *Supersedes spec §7.2 items 1, 3a, 3d and 4.* **[DECIDED]** |
| D14 | Guests | **Personalized, session-based.** The feed is scored from onboarding answers held in the session, and nothing persists until sign-up. **[DECIDED]** |
| D15 | Starting weights | §6.2 weights approved as a starting point. **[DECIDED]** |
| D16 | Weight tuning | Weights are editable from an **admin weights editor** with preview, versioning and rollback (§8). **[DECIDED]** |
| D17 | Impression logging | **Log every feed impression and click** with its score breakdown and weights version (§3.5). **[DECIDED]** |
| D18 | Related topics for free text | Typed phrases match items directly. The closest existing topics are shown as **tap-to-add suggestions** ("+ Transit"), **never auto-added** (§5.3). *Adjusts the mockup, which auto-adds them.* **[DECIDED]** |
| D19 | "Top for you" strip | **Keep it** on the home page, even though the mockup's final page is banners only. The mockup gets updated later. **[DECIDED]** |
| D20 | S3 politician ranking | The **"Active in your jurisdictions"** list in onboarding S3 is **in this plan** (§6.5). **[DECIDED]** |
| D21 | Banners from follows | Following a politician **adds a banner for their level**, holding only their items, even if that jurisdiction wasn't selected. *From the mockup.* **[DECIDED]** |

---

## 2. Architecture overview

```
 INGEST (cron, every 2h)                 ENRICH (cron)                   SERVE (per request)
 ───────────────────────                 ─────────────                   ───────────────────
 Legistar ─┐                                                             UserContext
 NY State ─┤  adapter.fetchChanged()     content_items                   (account OR guest session)
 Congress ─┼─► adapter.toContentItem() ─► + places / people / topics ─┐       │
 Open Data ┤      (upsert by hash)                                    │       ▼
 News ─────┘                                                          │  1. Candidate generation (SQL)
                                                                      ├─►2. Feature scoring (formula)
                    embed cron: items with no / stale vector ─► Voyage │  3. Re-rank (sponsor cap)
                                    │                                  │  4. Slice into widgets + reasons
                                    ▼                                  │       │
                             content_embeddings (pgvector, HNSW) ──────┘       ▼
                                                                         Onboarding preview / Home widgets
```

**Core idea:** everything downstream of the adapters (embeddings, ranking, feed) only sees `content_items`. Adding a source means writing one adapter file.

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

### 5.3 Free-text interest matching (D13)

1. Normalize the phrase and look it up in `interest_phrases`. **Cache hit = no API call.**
2. On a miss: make **one** Voyage call with `input_type: "query"`, then store the vector.
3. Run nearest-neighbor search over `content_embeddings`, **pre-filtered** to the user's jurisdictions and to `not is_dead`.
4. Items above the similarity floor (§6.2) become candidates and are tagged **"Matches: high-speed rail"**.
5. **Related-topic suggestions (D18):** compare the phrase vector against `topic_embeddings` (about 20 vectors, done in memory) and show the top 2–3 above a similarity floor as **tap-to-add** buttons:
   ```
   "high-speed rail" matched 6 items.   Related:  [+ Transit]  [+ Infrastructure]
   ```
   Tapping one adds it as a normal topic chip (`topic_follows`). Nothing is added without a tap (spec principle #2).
6. Removing a typed interest removes its matched items from the feed.

This meets the spec §14 criteria: **chip taps make 0 model calls, and free-text makes at most 1 embedding call and 0 LLM calls.**

---

## 6. Ranking engine

### 6.1 Pipeline

```
UserContext ─► 1. Candidates (SQL, ≤ ~600 items)
              2. Features → score = Σ weight × signal, × staleness multiplier
              3. Re-rank with the sponsor cap
              4. Slice into widgets, attach reasons, de-duplicate
```

**`UserContext`** has the same shape for signed-in users (loaded from tables) and guests (sent from session state):
```ts
{ places, jurisdictionFollows, legislatorIds, topicIds,
  interestPhrases, friendIds, historyItemIds, isGuest }
```
Guests have no friends or history, so those signals are 0.

**Candidate generation** (one Postgres function, `feed_candidates(ctx jsonb)`): a union of
| Pool | Limit |
|---|---|
| Recent items in followed places/jurisdictions | 300 |
| Items attached to followed legislators | 100 |
| Nearest neighbors per interest phrase (pre-filtered) | 50 each |
| Items tagged with followed topic chips | 100 |
| Nearest neighbors to the user's history centroid | 50 |
| Items friends acted on in the last 14 days | 50 |
| Top trending per followed jurisdiction | 50 |

### 6.2 Signals and starting weights **[DECIDED: D15]**

Every signal is normalized to 0–1. Weights sum to 100 so a score reads as "out of 100."

| Signal | Weight | How it's computed |
|---|---|---|
| **Place match** | 20 | 1.0 if the item's places include the user's own district or neighborhood · 0.7 if the item is in a followed jurisdiction **and** sponsored by the user's own representative · 0.5 if only in a followed jurisdiction · 0 otherwise |
| **Interest match** | 20 | Max over the user's phrases of `clamp((cosine − floor) / (ceiling − floor))`. Starting floor 0.30 and ceiling 0.60, **calibrated on real data**. A tagged topic chip counts as 1.0 |
| **Followed politician** | 15 | 1.0 primary sponsor · 0.6 co-sponsor · 0.4 other actor |
| **Timeliness** | 12 | `max(recency, upcoming)`, where recency = `exp(−days_since_last_activity / 14)` and upcoming = 1.0 if the next hearing/vote is within 7 days, falling linearly to 0 at 30 days |
| **Popularity** | 10 | Percentile of `legislation_stats.trending_score` **within the same jurisdiction**, so city items aren't drowned out by federal ones |
| **Stage** | 8 | Stage score from §5.2 |
| **Own history** | 8 | Cosine similarity to a weighted centroid of items the user stanced on (×3), bookmarked (×2) or viewed (×1) in the last 90 days, mapped the same way as interest match |
| **Friends' activity** | 7 | `min(1, log2(1 + friends_who_acted_14d) / 3)` |

**Staleness multiplier (D8):** ×0.2 if there has been no activity in 180 days. Items with `is_dead = true` are excluded, except in Tracked when the user follows them.

**Neutrality guardrail (spec §1.5, §S3):** party, ideology and stance sentiment are **never** inputs. `feed_candidates` and the scorer never read `legislators.party`, and a unit test asserts this.

### 6.3 Re-rank: sponsor cap (D11)

A greedy pass over each widget's sorted list allows **at most 2 items with the same primary sponsor in the visible slots** (Top for you: 5; each banner: 5). An item over the cap drops below the fold, but isn't removed.

### 6.4 Reasons (provenance tags)

Spec §6 requires a provenance tag on every item. The reason shown is the **signal that contributed the most points**, rendered as copy:

| Top signal | Tag |
|---|---|
| Place match | "In your district" / "Popular in Park Slope" |
| Interest match | "Matches: high-speed rail" |
| Followed politician | "Because you follow Shahana Hanif" |
| Timeliness | "Hearing Thursday" |
| Friends' activity | "3 people you follow weighed in" |
| Popularity | "Trending in NYC" |
| No strong signal (fallback) | "Top in New York City" / "Popular right now" (Popular feed) |

Politician tags use the office when the politician is the user's own representative ("Because you follow your Council Member"), and the name otherwise. In the onboarding preview, items that just appeared get a **"New ·"** prefix (from the mockup).

### 6.5 Politician ranking for onboarding S3 (D20)

A second, smaller ranking, of **people** instead of items, behind the S3 group "Active in your jurisdictions".

- **Candidates:** active legislators in the user's selected jurisdictions (or all covered jurisdictions if none are selected, headed "Active in New York"), **excluding** the user's own representatives, who already appear in the "Your representatives" group.
- **Activity score** (0–100), computed from `content_items` + `content_item_people`, refreshed with the 15-minute stats cron:
  | Signal | Weight | Computation |
  |---|---|---|
  | Bills introduced (30 days) | 40 | Primary sponsorships, log-scaled, as a percentile within the same body |
  | Upcoming votes/hearings (14 days) | 35 | Items they sponsor with `next_event_at` in the window |
  | Recent actions (30 days) | 25 | Any `last_activity_at` on items they're attached to |

  News volume (spec §S3) is added once a news adapter exists.
- **Reason line** = the strongest signal: "Introduced 4 bills this month", "Vote on Thursday", "Sponsor of a bill in committee".
- **Cap:** 8, plus "See more".
- **Neutrality:** party is never read (same unit test as §6.2). Legislative bodies are interleaved, so one body can't fill the list.
- **Audit:** a monthly admin report compares the party mix of the top 8 with each body's actual party mix and flags large gaps for review. It doesn't auto-correct (spec §S3).
- Endpoint: `GET /api/politicians/active?jurisdictions=…`, cached 15 minutes per jurisdiction set.
- Weights live in the same `ranking_config` row under `politician_weights`.

### 6.6 Popular feed (spec §7.3)

The same engine with an empty context. Only timeliness, popularity and stage carry weight (renormalized), across the Federal / NY State / NYC banners.

---

## 7. Feed API & widgets

### 7.1 Server function

```ts
// src/lib/feed/getFeed.ts
getFeed(ctx: UserContext, widgets: WidgetRequest[]): Promise<FeedResponse>
```
It runs one candidate-and-score pass and slices the results into each requested widget, so a page load with 6 widgets doesn't run 6 rankings.

### 7.2 Widget types (engine only, D12)

| Widget | Source of items | Default size |
|---|---|---|
| `top_for_you` | Highest scores across all levels | 5 |
| `jurisdiction:{level}` / `place:{type}:{id}` | Scored items in that jurisdiction or place, **excluding items already in Top for you**. A level the user didn't select but follows a politician in gets a banner with **only that politician's items** (D21) | 5 + "See all" (3 in the onboarding preview) |
| `tracked` | User's followed legislation, ordered by next event, then last activity | 5 |
| `trending` | Popularity-only ranking | 5 |
| `friend_activity` | Items friends acted on, ordered by recency | 5 |

**Default layout** (until the customization UI exists): Top for you → followed jurisdiction banners (Federal → State → City → Neighborhood) → Tracked → Trending → Friend activity.

**Onboarding preview layout** (from the mockup): banners only, 3 items each. On mobile, the peek card shows the top 2 items across all banners plus the total count.

### 7.3 Endpoints

- `POST /api/feed`: body `{ widgets, guestContext?, previousItemIds? }`. Signed-in users' context is loaded server-side. Guests send their session context, validated with zod; **no address data is accepted**. The response includes, per widget, the items, their reasons, which are **new** compared with `previousItemIds`, and counts. That's what drives the preview's "Added 3 items from New York City · 6 items" live-region text and the "New ·" tags.
- `POST /api/interests/resolve`: phrase → cached/embedded vector key, top matching items, and 2–3 related-topic suggestions, for onboarding S4.
- `GET /api/politicians/active`: S3 list (§6.5).

### 7.4 Caching & performance

| Path | Strategy | Budget (spec §6) |
|---|---|---|
| Toggle jurisdiction / politician / chip | Indexed candidate queries, no external calls | p95 ≤ 300 ms |
| Free-text interest | Phrase cache → at most 1 Voyage call + HNSW search | p95 ≤ 800 ms |
| Signed-in home feed | Cache the result in Upstash for 10 min, keyed by user + `ranking_config.version`; clear it when the user changes follows | — |

---

## 8. Admin tooling

- **Ranking inspector** (`/admin/ranking`): pick a user or a fixture persona to see their feed with each item's per-signal point breakdown.
- **Weights editor** (`/admin/ranking/weights`, D16):
  - One slider per signal (§6.2), plus the staleness multiplier, staleness window, similarity floor/ceiling, sponsor cap, and the §6.5 politician weights.
  - **Preview before saving:** the 5 fixture personas' top-10 feeds, current vs. proposed, side by side, with items that moved highlighted.
  - **Save** creates a new `ranking_config` version with a required note ("Boost timeliness for budget season"). Older versions stay.
  - **Rollback:** make any earlier version active in one click.
  - Changes reach users within the 10-minute feed cache. The cache key includes the version, so no manual flush is needed.
  - **Signal performance panel:** click-through rate by top signal and by widget, from `feed_impressions` / `feed_clicks` (§3.5), filterable by weights version. This shows whether a change helped.
  - Admin-only (existing `is_admin` flag).
- **Similarity calibration view:** for a typed phrase, list nearest items with their cosine scores to set the floor and ceiling in §6.2.
- **Source health:** last sync time, items ingested, items awaiting embedding, and error counts per source.

---

## 9. Testing

| Layer | Tests |
|---|---|
| Adapters | Fixture raw records → expected `NormalizedItem` (one test file per adapter) |
| Scoring | Pure-function unit tests per signal; the "party is never read" assertion |
| Re-rank | Sponsor-cap edge cases (one prolific sponsor, ties) |
| Personas | 5 fixture users (e.g. Park Slope transit advocate, guest with no answers, single-issue housing user) with snapshot-tested top-10 feeds, to catch weight-change regressions |
| Performance | Load script measuring p95 against the §7.4 budgets on a 300k-item synthetic table |

---

## 10. Phased delivery

| Phase | Deliverable | Depends on |
|---|---|---|
| **0. Setup** | Voyage API key stored as a secret; `pgvector` enabled in Supabase; `api.voyageai.com` allowed on the network | — |
| **1. Content layer** | Migration `020`; adapter contract + runner; Legistar adapter; backfill | 0 |
| **2. Embeddings** | Embed cron; backfill; `interest_phrases` cache; `/api/interests/resolve` | 1 |
| **3. Ranking engine** | `feed_candidates`; scorer; sponsor cap; reasons; `ranking_config`; S3 politician ranking (§6.5); persona tests | 2 |
| **4. Feed & widgets** | `getFeed`, `/api/feed` (with new-item diff), default widget layout incl. Top for you, guest context, Popular fallback, onboarding preview wiring, related-topic suggestions, impression/click logging | 3 + onboarding UI |
| **5. Tuning** | Ranking inspector, **weights editor**, signal performance panel, calibration view, source health, party-mix audit for S3; set the similarity floor/ceiling from real data | 4 |

---

## 11. Changes to `onboarding-spec.md` this plan implies

| Spec section | Change |
|---|---|
| §2 Geography | "All 50 states at launch" → **NYC first; other states via adapters later** (D5) |
| §7.2 items 1, 3a, 3d, 4 | Curated topic graph, alias cache and curation workstream → **replaced by direct embedding match against items** (D13). Flat topics remain for chips. **Q7 (topic owner) is no longer a launch blocker** |
| §7.2 item 5 | Vector store decided: **pgvector in Supabase**, embeddings from **Voyage AI** |
| §S3 "Active in…" politician suggestions | Activity score defined in §6.5 (news volume added once a news adapter exists) |
| §S4 adjacency feedback | Related topics are **tap-to-add suggestions**, not auto-added (D18) |

---

## 12. Open questions

| # | Question | Why it matters |
|---|---|---|
| ~~Q1~~ | ~~Review the onboarding mockup~~ **Resolved 2026-11-22:** reviewed; changes captured in D18, D19, D21, §6.4 and §7.2–7.3 | — |
| ~~Q2~~ | ~~Starting weights~~ **Resolved:** approved (D15), tunable via the weights editor (D16) | — |
| ~~Q3~~ | ~~S3 politician ranking~~ **Resolved:** in this plan (D20, §6.5) | — |
| Q4 | Similarity floor/ceiling values | Need real embeddings to calibrate (Phase 5) |
| ~~Q5~~ | ~~Log impressions?~~ **Resolved:** yes (D17, §3.5) | — |
| Q6 | Update the mockup: add the "Top for you" strip to the final page, and switch related topics to tap-to-add | Keeps the design and the plan in sync |
| Q7 | The mockup's in-feed card suggests "Follow Brooklyn **Borough** projects?", but spec §3 says boroughs aren't followable | Resolve when suggestion cards are planned (phase 2) |
| Q8 | Council Land Use items (`project`, neighborhood level) cover the same ULURP applications as `local_proposals` (from `feature/neighborhood-map`, already in the live DB). Link, merge or replace them so the neighborhood banner doesn't show duplicates | Decide before Phase 3 |

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
