# Onboarding Build Plan — Screens, Home Widgets & Shared Plumbing

**Status:** Draft v1.1 · 2026-11-22 · Built from product-owner interview answers. **v1.1:** aligned with `recommendations-plan.md` v1.2 (shared widgets, no "Top for you", topic and politician widgets).
**Builds on:** `onboarding-spec.md` v1.1 (what the screens do), the "Civic App Onboarding" design canvas (how they look), and `recommendations-plan.md` v1.1 (the engine behind the feed).
**Scope:** Building onboarding S0–S6, the widget home page, and the plumbing both depend on, in this Next.js web app.

> **[DECIDED]** = product-owner answer from the interview. **[PROPOSED]** = my recommendation, awaiting approval. **[OPEN]** = unresolved (see §12).

---

## 1. Decisions from the interview

| # | Topic | Decision |
|---|---|---|
| B1 | Scope | **Onboarding S0–S6 + the widget home page + shared plumbing** (address → districts, guest state, sign-in, rep data, analytics). Widget customization stays a separate, later plan. **[DECIDED]** |
| B2 | Platform | **Responsive web only.** iOS and S5 (notifications) come later. **[DECIDED]** |
| B3 | Federal / State levels | Shown as **"Coming soon"**: S2 cards visible but disabled, state/federal reps in S3 likewise. Each level **switches on automatically** once its adapter has content. **[DECIDED]** |
| B4 | Addresses outside NYC | **Friendly NYC-only note** with the StreetEasy link from spec §S1, then continue with the Popular NYC feed. Federal/state districts are not resolved or stored. **[DECIDED]** |
| B5 | Visual style | **The mockup's look** (teal accent, Inter + Space Grotesk, light warm background) for **onboarding and the home page**. Other pages keep the NYC theme for now. **[DECIDED]** |
| B6 | Geocoding | **NYC Geoclient API** replaces today's GeoSearch → PLUTO lookup. **[DECIDED]** |
| B7 | Sign-in | **Google + email magic link** (as today). Apple waits for the iOS app. **[DECIDED]** |
| B8 | Who sees onboarding | **New visitors** (signed out, new browser session) are routed to S0. Returning guests in a new session **see S0 again**; nothing about them is remembered. Signed-in users never see it. Existing accounts get a one-time "Build your feed" banner. **[DECIDED]** |
| B9 | Username | **Auto-generated** at sign-up from the Google/email name; editable in Profile. The username step is removed. **[DECIDED]** |
| B10 | S3 representatives | **Council Member + Mayor.** The Mayor is one manual record. State/federal reps show as "Coming soon." **[DECIDED]** |
| B11 | Analytics | Spec §11 events go to a **Supabase `analytics_events` table**. No new vendor. **[DECIDED]** |
| B12 | Neighborhood content | A **small adapter feeds the kept DOT/ULURP `local_proposals` data into `content_items`**, tagged to NTA neighborhoods. **[DECIDED]** |
| B13 | Rollout | **Behind a feature flag**, off by default. Tested on Vercel previews, then switched on. The old home page stays as the fallback. **[DECIDED]** |

---

## 2. How this fits with the other documents

```
onboarding-spec.md        WHAT each screen does
design canvas (mockup)    HOW it looks
this plan                 HOW we build the screens + plumbing
recommendations-plan.md   The engine: content_items, embeddings, ranking, /api/feed
```

**Integration seam:** every screen reads data through interfaces in `src/lib/onboarding/data/` (§4.6). They start as **fixtures** and are swapped for real implementations as the recommendations-plan phases land. No screen code changes when the swap happens.

---

## 3. Architecture

### 3.1 Routes

| Route | What | Notes |
|---|---|---|
| `/welcome` | Onboarding S0–S4 | New, under `src/app/(public)/welcome/`. One client route; the step lives in the URL (`?step=2`) so Back works |
| `/` | Home: S6 / widget page | Flag on: new widget home page. Flag off: today's page |
| `/onboarding` (existing) | Username form | **Retired** (B9). Redirects to `/` |

**Redirect rule** (in `middleware.ts`, flag on): a request to `/` with **no signed-in user** and **no `onb_session` cookie** → redirect to `/welcome`. `onb_session` is a **session cookie** (no expiry), set on the first visit to `/welcome`, so it disappears when the browser closes (B8). Crawlers (detected by user agent) are not redirected, so the public home page stays indexable.

### 3.2 Feature flags

| Flag (env var) | Default | Controls |
|---|---|---|
| `NEXT_PUBLIC_FLAG_NEW_ONBOARDING` | `false` | `/welcome`, the redirect, the new home page |
| `NEXT_PUBLIC_FLAG_STEP_POLITICIANS` | `true` | Kill switch for S3 (spec §S3) |
| `NEXT_PUBLIC_FLAG_STEP_INTERESTS` | `true` | Kill switch for S4 (spec §S4) |

Env vars are enough for an on/off launch switch. **[PROPOSED]**

### 3.3 Guest state

Spec §2 requires guest selections to last only for the session. **[PROPOSED]** Store them in a **session cookie** `onb_ctx` rather than `sessionStorage`:

| Option | Shared across tabs? | Server can read it? | Gone when browser closes? |
|---|---|---|---|
| `sessionStorage` | ❌ No. Opening a bill in a new tab loses the feed | ❌ | ✅ |
| **Session cookie (proposed)** | ✅ | ✅ The home page can render a guest's feed on the server | ✅ |

- **Contents:** only IDs: districts, neighborhood, jurisdictions, legislator IDs, topic IDs, interest phrases (max 10). Shaped like `UserContext` (recommendations plan §6.1), versioned (`v: 1`), and kept under 3 KB.
- **Never** contains the address or coordinates (spec §S1).
- Written by the client on each change; validated with zod whenever the server reads it.

---

## 4. Shared plumbing

### 4.1 Address → districts (S1)

**Service:** NYC Geoclient API (free; needs a key from the NYC API Developers Portal). **[DECIDED: B6]**

| Step | Detail |
|---|---|
| Autocomplete | Keep **NYC GeoSearch** (`geosearch.planninglabs.nyc`, free, no key) for type-ahead suggestions. It's fast and NYC-biased. *Geoclient doesn't autocomplete* **[PROPOSED]** |
| Resolve | On selection, a server action `resolveAddress(text)` calls Geoclient's address/search endpoint. It reads the **council district, state senate district, assembly district, congressional district, NTA code + name** and borough. *Confirm exact field names against the Geoclient docs at build time* |
| Persist | Returns district + NTA IDs only. Signed-in users → `user_places` (recommendations plan §3.3). Guests → `onb_ctx` cookie |
| Privacy | The address is held only in memory for the request: **not logged, not stored, scrubbed from error reports and analytics** (spec §S1, §14) |
| Rate limit | Reuse the existing Upstash `geocodeRateLimit`, keyed by session ID for guests |
| Outside NYC (B4) | Geoclient finds nothing → GeoSearch's result shows a non-NYC US address → show the NYC-only note + StreetEasy link (no user data in the URL) and continue with the Popular NYC feed |
| Other errors | Non-US, unresolvable, service down → the spec §S1 states, with Skip always available |
| Replaces | `lookupAddressDistrict` in `src/app/actions/profile.ts`. The profile's Council Member Finder moves to the new action |

New env var: `NYC_GEOCLIENT_KEY` (server only).

### 4.2 Neighborhoods (NTA 2020)

A new **`neighborhoods`** table is needed for S2's "Add another neighborhood" search, for Geoclient's NTA codes, and for tagging neighborhood content.

| Column | Notes |
|---|---|
| `nta_code` (PK), `name`, `borough` | From NYC Open Data "2020 Neighborhood Tabulation Areas" |
| `aliases` text[] | Colloquial names, e.g. "DUMBO", "Park Slope" (spec §3). Seeded by hand for the best-known ones |
| `geometry` | Polygon, for tagging content (§4.8) and the "Nearby" fallback (spec §7.1) |
| `adjacent_ntas` text[] | Precomputed neighbors in the same borough, for the "Nearby: [name]" fallback |

**[PROPOSED]** Enable **PostGIS** in Supabase for polygon matching (`ST_Intersects`) instead of hand-written point-in-polygon code.

### 4.3 Sign-in & carrying guest choices into the account

- **Methods:** Google OAuth + email magic link (B7). The sheet copy follows spec §8: "Save your feed" / "Sign in to take a stance on this bill," with an honest "Your choices won't be saved if you leave."
- **Gated actions:** stance, comment, bookmark and "save follow" open the sign-in sheet. The pending action is stored in a short-lived cookie `onb_pending` (action + item ID) and completed after sign-in (spec §8).
- **On first sign-in** (`src/app/auth/callback/route.ts`):
  1. Create the `user_profiles` row with an **auto-generated username** (B9): slugified name or email local part, plus digits if it's taken.
  2. Copy `onb_ctx` into `user_places`, `user_jurisdiction_follows`, `legislator_follows`, `topic_follows` and `user_interests`.
  3. Link the guest's `feed_impressions` / `analytics_events` rows (by session ID) to the new user.
  4. Complete `onb_pending`, then clear both cookies.
  5. Redirect back to where the user was, **not** to `/onboarding` as today.
- **Existing accounts** (B8): a dismissible "Build your feed" banner on the home page opens `/welcome` at S1, with any existing follows pre-loaded. Today's `council_member_id` on the profile maps to their council district.

### 4.4 Representatives data (S3)

| Rep | Source | Status |
|---|---|---|
| Council Member | `legislators` (Legistar sync) | ✅ Exists |
| Mayor | **One manual record** in `legislators` (B10), with `legislature_id` = NYC and a flag so the council sync doesn't deactivate it | Add in Phase B1 |
| State Senator, Assembly Member, U.S. Rep, Senators | — | "Coming soon" card (B3) |

Spec §S3's "Active in your jurisdictions" list comes from the recommendations engine (`GET /api/politicians/active`, recommendations plan §6.5).

### 4.5 Coverage registry: what counts as "Coming soon"

A small server function `getCoverage()` returns, per level (`federal`, `state`, `city`, `neighborhood`), whether it's **live**. A level is live when an enabled source in `sources` has at least one `content_items` row at that level. The S2 cards, S3 rep cards and banners all read it, so **a level lights up by itself** the day its adapter ships (B3).

### 4.6 Data interfaces (fixtures first)

All in `src/lib/onboarding/data/`, each with a fixture and a real implementation:

| Interface | Fixture until | Real implementation |
|---|---|---|
| `resolveAddress(text)` | Phase B1 | §4.1 |
| `searchNeighborhoods(query)` | Phase B1 | `neighborhoods` table |
| `getCoverage()` | Phase B1 | §4.5 |
| `getRepresentatives(places)` | Phase B1 | §4.4 |
| `getActivePoliticians(jurisdictions)` | Recs Phase 3 | `/api/politicians/active` |
| `resolveInterest(phrase)` | Recs Phase 2 | `/api/interests/resolve` |
| `getFeed(context, widgets, previousItemIds)` | Recs Phase 4 | `/api/feed` |

The fixtures reproduce the mockup's placeholder data (Park Slope / CD 39, the 12 sample items), so the screens can be built and demoed before the engine exists.

### 4.7 Analytics (B11)

**`analytics_events`**: `id`, `session_id`, `user_id` null, `name` (e.g. `onb_view`), `props` jsonb, `created_at`.
- Events and properties exactly as in spec §11. An allowlist in `track()` rejects any unknown property, so **no address or other PII can slip into `props`**.
- Inserts are batched from the client every few seconds and on page hide, through a rate-limited `POST /api/events`.
- Funnels are read with SQL or Metabase.

### 4.8 Neighborhood adapter: DOT/ULURP → `content_items` (B12)

This is a new adapter under the recommendations plan's adapter contract (§4.1 there). It reads the kept `local_proposals` table; it does **not** revive the abandoned branch's code.

| Field | Mapping |
|---|---|
| `external_id` | `local_proposals.source || ':' || source_id` |
| `item_type` | ULURP → `project` (land use); DOT → `project` (street/construction). `metadata.subtype` keeps the detail |
| `title`, `summary` | `title`; `ai_summary` → `description` |
| `jurisdiction_level` | `neighborhood` |
| `places` | **Precise geometry** (`geometry_precise = true`) → every NTA the geometry intersects (corridors get several, per spec §7.1) · **Imprecise** (district-centroid fallback) → **not tagged to a neighborhood**, so it can't appear in the wrong neighborhood's banner **[PROPOSED]** |
| `last_activity_at`, `stage` | `last_action_date`; `status` mapped to the recommendations plan's stages |

Cadence: a weekly cron (this data changes slowly). Keeping these tables fresh with new DOT/ULURP data is **out of scope** until a neighborhood source is rebuilt; this adapter only serves what's already there. See Q3.

---

## 5. Screens

Shared building blocks live in `src/components/onboarding/`: `StepShell` (progress, Skip, Back, "Explore my feed"), `LivePreview` (split view or peek card), `FeedBanner`, `FeedItemCard` (type · status, title, context label, "New ·" marker; the whole card links to the item page, no stance controls, spec §6.1), `ComingSoonCard`, `SignInSheet`.

| Screen | Build notes (behavior per spec; look per mockup) |
|---|---|
| **S0 Welcome** | "Build my feed" → S1; "Just show me what's popular" → S6 Popular. Footer "Already have an account? Sign in" |
| **S1 Address** | GeoSearch autocomplete → `resolveAddress`. Confirmation chip "Council District 39 · Park Slope". All §S1 states. **No** "Use my location" on web in v1 **[PROPOSED]** |
| **S2 Jurisdictions** | Each selection **adds a jurisdiction or neighborhood widget** to the preview. Cards from `getCoverage()`: NYC + Neighborhood live; Federal + State as `ComingSoonCard` (B3). "Yours" badges after an address resolves. "Select all of mine" selects live levels only. Neighborhood search via `searchNeighborhoods` |
| **S3 Politicians** | Following someone **adds their politician widget** to the preview. "Your representatives": Council Member + Mayor, then "Coming soon" cards for the others (B10). "Active in your jurisdictions": up to 8 cards with reason lines. "Find someone else" search. Party shown as a text label |
| **S4 Interests** | Each chip or typed interest **adds its own topic widget** to the preview. 12–16 chips (existing flat topics) + "Add your own…" → `resolveInterest`. A typed place is shown back ("housing legislation · California"); uncovered places show the widget as "Coming soon." Related topics as tap-to-add "+ Transit" (recommendations plan D18). Removable tray |
| **S6 Here's your page** | The home page (§6), with "Here's your page. You can customize it anytime." and a coach mark. The sign-in sheet appears once per session (spec §8) |
| **S5** | Not built (B2) |

**Live preview** (spec §6): two columns at ≥1024 px (survey 40%, feed 60%); a peek card with the top 2 items + count below that, expanding to a sheet with "Keep building." Shows the user's widgets in layout order (recommendations plan §7.2), 3 items each. Calls `getFeed` with `previousItemIds` to get "New ·" flags and the live-region text ("Added 3 items from New York City · 6 items"). Requests are debounced at 150 ms; the latest request wins.

---

## 6. Home page (widget layout)

Flag on: `src/app/page.tsx` renders the widget page for **everyone**: signed-in users from their saved context, guests from `onb_ctx`, and empty context as the Popular feed (spec §7.3).

| Order | Widget | Notes |
|---|---|---|
| 1 | Jurisdiction widgets: State → City (Federal when live) | Shared rankings; 5 items + "See all" |
| 2 | Neighborhood widgets | Shared; "Nearby" top-up when thin |
| 3 | Topic widgets (chips and typed interests) | Shared; titled by name only ("Housing"), spec §6.1 |
| 4 | Politician widgets | Shared |
| 5 | Tracked | Signed-in only |
| 6 | Trending | Everyone |
| 7 | Friend activity | Signed-in users who follow someone |

There is **no "Top for you"** (recommendations plan D23). Order per recommendations plan §7.2.

- One `getFeed` call per page load (recommendations plan §7.1).
- Today's "For You" and "Trending" sections are retired when the flag is on; the code stays until the flag is removed.
- A "Customize" button links to `/welcome` at S2 for now. The real widget editor is the later plan.
- Guests see a "Save your feed" banner; signed-out visitors with an empty context see "Popular right now · Personalize."

---

## 7. Visual system (B5)

- **Scoped theme:** the mockup's tokens defined as CSS variables under a `.theme-civic` class applied to `/welcome` and the home page only:
  `--civic-bg #F6F5F1 · --civic-surface #FFFFFF · --civic-ink #15171C · --civic-muted #4A4F5A · --civic-border #DAD8D1 · --civic-accent #0B6B5D · --civic-accent-soft #E3F0EC · --civic-badge-bg #FBEBDD · --civic-badge-ink #9A4A0C`
- **Fonts:** Inter (body) and Space Grotesk (headings) via `next/font`, loaded only on these routes.
- **Header/nav:** `/welcome` is full-screen with its own minimal bar (logo, "Step n of 4", Skip). **The home page uses the design export's civic header** (logo, Home / Search / Watchlist, avatar), wired to the existing routes; every other page keeps today's NYC header until the app-wide restyle. **[DECIDED 2026-11-22]** **[OPEN] Q1** for the rest of the app.
- **Design source:** `design/civic-app-onboarding.html` (iPhone flow, web S2 split view, web S6). Where it differs from this plan, the export wins and the spec (v1.2 §6.1) follows it.
- The mockup still needs: a web S6, topic and politician widgets on S6, and widgets (not re-ranked banners) appearing as S3/S4 selections are made (recommendations plan Q6). Remove the "Top for you" peek idea.

---

## 8. Accessibility & performance

- WCAG 2.2 AA per spec §10: real buttons and toggles (`aria-pressed`), focus moves to each step's heading, 44 px targets, contrast checked on the teal palette, party as text.
- A polite live region for preview changes; animations off under `prefers-reduced-motion`, keeping a brief highlight.
- Budgets from spec §6: toggle ≤ 300 ms, free text ≤ 800 ms, address ≤ 1.5 s (p95). Fixtures add an artificial delay so loading states get built and tested.

---

## 9. Testing

| Layer | Tests |
|---|---|
| Unit | Guest-cookie schema, username generator, coverage registry, analytics allowlist (rejects PII keys) |
| Integration | `resolveAddress` against recorded Geoclient responses (NYC, outside NYC, unresolvable); sign-in carry-over of every guest field |
| End-to-end (Playwright) | (1) skip everything → Popular feed; (2) full flow as a guest → sign in from a gated stance → stance saved and choices carried over; (3) outside-NYC address; (4) mobile peek card; (5) keyboard-only run |
| Privacy check | E2E asserts the address string never appears in network payloads to `/api/events`, in cookies or in server logs |
| Accessibility | axe checks on every step in E2E |

---

## 10. Phased delivery (alongside the recommendations plan)

| Phase | Deliverable | Depends on | Runs in parallel with |
|---|---|---|---|
| **B0. Prep** | Update the mockup (recs Q6: topic/politician widgets, web S6, tap-to-add); get the Geoclient key; enable PostGIS | — | Recs Phase 1 cleanup |
| **B1. Plumbing** | `resolveAddress` (Geoclient), `neighborhoods` table + seed, Mayor record, coverage registry, guest cookie, flags, `analytics_events`, sign-in carry-over + auto-username | Recs Phase 1 (`user_places` etc.) | Recs Phase 2 |
| **B2. Screens on fixtures** | S0–S4, live preview, sign-in sheet, S6 + widget home page, all reading fixtures | B0 mockup update, B1 | Recs Phase 3 |
| **B3. Neighborhood adapter** | DOT/ULURP → `content_items` with NTA tags | Recs Phase 1, B1 (`neighborhoods`) | Recs Phase 2–3 |
| **B4. Integration** | Swap fixtures for the real `resolveInterest`, `getActivePoliticians`, `getFeed` | Recs Phases 2–4 | — |
| **B5. Launch** | E2E + accessibility pass on a Vercel preview → flip `NEXT_PUBLIC_FLAG_NEW_ONBOARDING` → monitor funnels → remove old home code after 2 stable weeks | B4 | Recs Phase 5 |

**Overall order across both plans:**
```
Recs P1 ─► Recs P2 ─► Recs P3 ─► Recs P4 ─► Recs P5
  │           │          │          │
  └► B0, B1 ──┴► B2, B3 ─┴──────────┴► B4 ─► B5 (launch)
```

---

## 11. Changes to `onboarding-spec.md` this plan implies

| Spec section | Change |
|---|---|
| §2 Platforms | Web first; iOS later (B2) |
| §2 Sign-up methods | Google + email magic link; Apple with the iOS app (B7) |
| §S1 Outside NYC | Federal/state districts not resolved yet; Popular NYC feed instead (B4) |
| §S1 "Use my current location" | Not on web in v1 |
| §S2 / §S3 | Federal and State shown as "Coming soon" until their data exists (B3, B10) |
| §S5 | Deferred with iOS |
| §11 Events | Stored in Supabase `analytics_events` (B11) |
| New | Username auto-generated; the username step is removed (B9) |

---

## 12. Open questions

| # | Question | Why it matters |
|---|---|---|
| Q1 | When does the rest of the app move to the mockup's look (header, legislation pages, profile)? | Until then there's a style jump between home and other pages |
| ~~Q2~~ | ~~Confirm Geoclient's response fields~~ **Resolved in B1:** v2 returns `cityCouncilDistrict`, `stateSenatorialDistrict`, `assemblyDistrict`, `congressionalDistrict`, `nta2020` (matches `places`) and `communityDistrict` | — |
| Q3 | Who keeps DOT/ULURP data fresh after launch? The adapter only serves what's in `local_proposals` today | Neighborhood banners go stale over time without a refresh source |
| ~~Q4~~ | ~~Schema drift~~ **Resolved in B1:** 026 adds `council_member_id`, `community_board`, `notification_preferences` and `terms_accepted_at` with `if not exists` | — |
| Q5 | ~~Approve the [PROPOSED] items~~ **Approved 2026-11-22:** session cookie (§3.3), GeoSearch autocomplete (§4.1), env-var flags (§3.2), no geolocation on web (§5). PostGIS was already enabled. Still open: imprecise proposals excluded from neighborhoods (§4.8), decide in B3 | — |

---

## 13. Done log

One short section per finished phase: what shipped, decisions made during the build that this plan didn't cover, and anything left open.

### Phase B1 — Plumbing ✅ (2026-11-22)

**Shipped:** migration `026_onboarding_plumbing.sql` (applied): `neighborhoods` (geometry + adjacency), `upsert_neighborhoods`, `refresh_neighborhood_adjacency`, `search_neighborhoods`, `coverage_levels`, `legislators.is_manual` + `term_start`, the Mayor record (Zohran Mamdani, term from 2026-01-01) with a `manual:zohran-mamdani` external ID, `analytics_events`, and the Q4 drift columns. `npm run seed:neighborhoods` loads NTA polygons from Open Data and computes adjacency. `src/lib/geo/geoclient.ts` (Geoclient v2). `src/lib/onboarding/`: guest cookie schema (`guest.ts`), session/pending cookies (`session.ts`), browser writers (`client-cookies.ts`), username generator, sign-in carry-over, and `data/` (`resolveAddress`, `searchNeighborhoods`, `getCoverage`, `getRepresentatives`), exposed as server actions in `src/app/actions/onboarding.ts`. `src/lib/analytics/` (allowlist + client batcher) and `POST /api/events`. `src/lib/flags.ts`. New auth callback; middleware session cookies and the flagged `/` → `/welcome` redirect. 35 new tests (119 total).

**Decisions made during the build (product-owner answers unless noted):**
- **Outside-NYC detection:** GeoSearch only knows NYC (it turns "10 Main St Hoboken NJ" into a Brooklyn address) and Geoclient rejects a Hoboken address and gibberish the same way. So **any rejection gets one combined message**: "couldn't place that address" plus the NYC-only note and StreetEasy link. `onb_address_result` is `success | failed | unavailable` (no `outside_nyc` / `non_us`).
- **`neighborhoods` is geometry-only:** `nta_code` (FK to `places`), `borough`, `geometry`, `adjacent_ntas`. Names and aliases stay in `places`. Adjacency = same borough within ~10 m. `search_neighborhoods` also expands areas ("Harlem" → its NTAs).
- **Coverage:** Neighborhood counts as live only with **NTA-tagged** items, so it shows "Coming soon" until B3 (the 949 Land Use items are tagged to council districts). Live today: City only.
- **Mayor widget = mayoral actions:** the adapter attaches the Mayor as `actor` on items whose history has an action ending "by Mayor" (signed, vetoed, hearing held, withdrawn), credited to the mayor in office on that date (`term_start`). **"Returned Unsigned by Mayor" is excluded** (product decision: bills that became law without his signature aren't his actions). Since 2026-01-01 that leaves 1 veto. The politician widget's ×0.6 non-primary factor applies to every actor item alike, so their order is unchanged. Party is null like every council member's.
- **Rate limit:** address lookups are keyed by user ID, or IP for guests, at **20/hour** (was 5, signed-in only).
- *(Mine)* **Session ID:** a separate `sid` session cookie set by middleware on every page, used by `analytics_events` / `feed_impressions`. `onb_session` stays a plain "has seen /welcome" marker, so a guest who lands on a bill page first still gets sent to S0 at `/`.
- *(Mine)* **Guest cookie caps:** 12 politicians, 15 topics, 10 interests. JSON's structural characters stay unescaped to fit 3 KB; `writeGuestContext` returns false over the cap so the UI can say so.
- *(Mine)* **Pending actions:** stance and save (follow) only. Comment text never goes in a cookie; the sheet returns the user to the bill instead.
- *(Mine)* **Carry-over** runs on any sign-in with a guest cookie, not only the first: follows are added, resolved places replace the account's. It also fills `council_member_id` when the profile has none. Missing IDs are skipped; each step logs and never blocks sign-in.
- *(Mine)* **Terms:** new accounts still pass through `/terms/accept` (they did before via the protected `/onboarding` route).
- *(Mine)* **`/onboarding`** is now a route that creates a generated profile for a signed-in account without one (1 exists), then redirects. Auto-usernames are not behind the flag.
- *(Mine)* `auth_success` has a `new_account` prop, so sign-ups and returning sign-ins can be told apart.
- *(Mine)* The callback's `next` is restricted to same-site paths (it allowed `@host` before).

**Left open:**
- **Ran:** `seed:neighborhoods` (262 polygons; 3 islands/water NTAs have no neighbor), `backfill:content` (Mayor attached to 1 item, the Int 0175-2026 veto), `rank:widgets` (88 widgets).
- Not exercised end-to-end: the auth callback (needs OAuth/magic link on a preview), `/api/events` and `resolveAddress` over HTTP (no local `KV_REST_API_*`). Smoke-test on the Vercel preview.
- Fixtures for the four B1 interfaces weren't built (they're real now); B2 adds fixtures for `getActivePoliticians`, `resolveInterest`, `getFeed`.
- GeoSearch autocomplete rewrites non-NYC addresses to NYC ones, so S1 must let users submit what they typed rather than force a suggestion (B2).
- Existing gap, not changed: `/terms/accept` accepts `next=//host`.

### Phase B2 — Screens (2026-11-22, on real data; not yet on a preview)

**Shipped:** `/welcome` (S0–S4, full-screen, step in the URL), the live preview (split view ≥1024 px; peek card + sheet below), the sign-in sheet (Google + magic link), and the widget home page at `/` (S6) with "See all" pages at `/section/[key]`. Everything sits behind `NEXT_PUBLIC_FLAG_NEW_ONBOARDING`; with it off, `/welcome` 404s and `/` is today's page. Components in `src/components/onboarding/` (flow in `flow/`), civic tokens in `globals.css`, Inter + Space Grotesk via `next/font` on civic pages only. Verified with a production build + `next start` and headless-Chrome screenshots of each step against the design export; S1 resolved a real address through Geoclient.

**Decisions made during the build (product-owner answers unless noted):**
- **Real data instead of fixtures:** recs Phase 4's `getFeed` + `POST /api/feed` were built first (see the recommendations plan's Done log), so the screens never used fixtures. `resolveInterest` and `/api/politicians/active` were already real.
- **The design export wins** where it differs from this plan; spec v1.2 §6.1 was updated to match (section titles are names only, cards link to the item page with no stance controls).
- **`/welcome` is full-screen** with its own bar; **the home page uses the export's civic header**; other pages keep the NYC header (`SiteChrome` hides the global header/footer on civic pages).
- **Topics left as they are** (duplicates included); S4 shows the 16 topics with the most live items.
- *(Mine)* **Card titles use the AI `short_summary` headline** when present (93% of live items), else the official title, so cards read like the export.
- *(Mine)* **Guests see Tracked and Friend activity with the export's empty states**; Trending is hidden while it's empty (no engagement in the last 7 days).
- *(Mine)* **Neighborhood stays "Coming soon"** per the coverage registry, so S2's Park Slope card is disabled and "Add another neighborhood" is hidden until B3. Federal/State cards keep "Yours" and districts, as in the export.
- *(Mine)* **S3 order follows the export:** Council Member and Mayor first, then the "Coming soon" offices; "You follow" lists follows outside both lists. The active list got `title` and an optional `limit` (for "See more"), and its fallback heading is now "Active in New York City".
- *(Mine)* **Signed-in users in `/welcome`** start from their saved follows (council member → district for old accounts) and save on exit; only what they turned off is removed, so follows made elsewhere aren't lost and the cookie caps don't apply.
- *(Mine)* **Gated actions on item pages:** with the flag on, signed-out stance/follow clicks open the sign-in sheet and complete after sign-in; with it off they stay disabled.
- *(Mine)* No "Use my current location" on web (Q5); the coach mark is a small dismissible note under Customize.
- *(Mine)* **Local runs:** `next.config.ts` pins `turbopack.root` (a `package-lock.json` in the home folder made dev hang watching `~`), and rate limits pass through when there are no Upstash keys and it isn't Vercel.

**Left open:**
- Smoke-test on a Vercel preview with the flag on: sign-in from the sheet (Google and magic link), carry-over, a gated stance, `/api/events`.
- Playwright E2E + axe (§9) not written yet; only unit tests and manual screenshots so far.
- The 7% of items without a headline show the long official title.
- Mobile home page reuses the desktop header (wraps to two lines); the export only has a web S6.

### Phase B3 — Neighborhood adapter (2026-11-22, built; migration not applied, source disabled)

**Shipped:** migration `027_neighborhood_adapter.sql` (**written, not applied**): `local_proposal_rows(p_after, p_limit)`, a service-role read that pages `local_proposals` with the NTA codes its geometry intersects (`ST_Intersects` against `neighborhoods`), the latest history milestone and the ULURP/DOT detail rows; plus the `nyc-local-proposals` source row, **created disabled**. `src/lib/ingest/adapters/nyc-local-proposals.ts` maps rows per §4.8. `src/lib/ingest/index.ts` now groups adapters by cron: `ingestAllSources` (daily, Legistar) and `ingestNeighborhoodSources` (weekly). `/api/cron/ingest-neighborhood` on Mondays 07:30 UTC (after ingest-content, before embed-content and rank-widgets). `npm run backfill:neighborhood`. 17 new tests (145 total). Nothing in the feed, ranking or coverage code changed: `coverage_levels()` and the precompute's per-NTA widgets pick the items up as soon as they exist.

**Decisions made during the build (mine, pending review):**
- **Ships disabled.** Q8 and the Q5 remainder (below) change what gets written, so the runner skips the source until `update sources set enabled = true where slug = 'nyc-local-proposals'`.
- **Precision follows the plan literally:** only `geometry_precise = true` rows get neighborhood tags, in one function (`hasPreciseGeometry`) so it's a one-line change. Imprecise rows are still ingested as neighborhood-level items with no places (they can still surface in topic/interest widgets via embeddings).
- **Stages:** ZAP Filed / Noticed → `introduced`; In Public Review → `in_committee`; Completed → `enacted` (ZAP doesn't say whether a completed review was approved or withdrawn, so not `dead`); DOT Completed Project / Substantial / Final Completion → `enacted`. Nothing is `is_dead`.
- **Summary** = `ai_summary` → `description` (DOT descriptions are just the project type, e.g. "CAPITAL RECONSTRUCTION"). **`last_activity_at`** = latest past date of `last_action_date`, latest milestone, `filed_date`; else the row's `created_at`.
- **DOT URL:** DOT rows have no `source_url`, and `content_items.url` is required; they link to the dataset page (`data.cityofnewyork.us/d/jvk9-k4re`). There's no in-app proposal page on this branch.
- **No council-district places or topic tags** (the plan's mapping has neither). `cc_district`, community districts, ULURP actions and DOT streets go in `metadata`.
- **Migration numbering:** live DB has 014–019 (neighborhood-map) and 020–026; next free is `027`. The function is plpgsql because the `local_proposals` tables exist only in the live DB, not in this branch's migrations.

**Live data (read-only, 2026-11-22):** 1,575 proposals. ZAP ULURP 1,391 (136 precise, all point geometry, each in 1 NTA; 1,255 at the district-centroid fallback); DOT 184 lines, 23 crossing 2–3 NTAs, **all `geometry_precise = false`**, and all completed projects from 2015–2025. Neighborhoods reached: 65 NTAs with precise-only (57 counting only open reviews, 101 items), 148 if DOT counts as precise, 155 if everything is tagged. Only 25 rows have an `ai_summary`.

**Left open (need product-owner decisions):**
- **Q8 (recs plan):** Land Use items vs `local_proposals`. A rough title match finds 167 proposals (32 precise) with a matching Council LU item, out of 919 LU items. `ulurp_proposal_details.ulurp_numbers` holds only "ULURP"/"Non-ULURP", not application numbers, so linking needs name matching or a new ZAP field. Today LU items carry council districts only, so they don't appear in neighborhood widgets and there are no duplicates *there* yet; they would duplicate in topic/interest widgets.
- **Q5 remainder:** exclude imprecise proposals from neighborhoods (built), or tag them some other way (e.g. to every NTA in their community district).
- **DOT precision:** migration 019 says "DOT rows always have real source geometry", but the flag was left at its default (false). Either set `geometry_precise = true` for DOT rows in `local_proposals` or treat DOT as precise in the adapter; otherwise no DOT item reaches a neighborhood. Also whether 2015–2025 completed DOT projects belong in the feed at all.
- **Q3:** who refreshes `local_proposals` (no sync on this branch; data ends mid-2026).
- **District → NTA crosswalk** for Land Use items (Phase 3 note): depends on Q8.
- After approval: apply 027, enable the source, run `backfill:neighborhood`, then `backfill:embeddings` (or wait for the cron) and `rank:widgets`. Neighborhood then shows as live in `getCoverage()`.

