# Onboarding Specification — Civic Engagement App (name TBD)

**Status:** Draft v1.2 · 2026-11-22 · **v1.2:** aligned with the "Civic App Onboarding" design export (`design/civic-app-onboarding.html`): every pick adds a section titled by name only, cards are links with no stance controls (§6.1). Remaining TBDs: topic-list owner (launch blocker), metric targets (post-launch).
**Source:** Meeting notes "civic engagement platform: onboarding flow and core features" (2026-11-08), plus product-owner interview answers.
**Scope:** First-run experience from app open to "Here's your page", including the deferred account prompt. Covers Web (responsive) and iOS.

> Conventions: **MUST / SHOULD / MAY** are requirement levels. Items marked **[DECIDED]** came from the product owner. All former proposals were approved by the product owner on 2026-11-08. Items marked **[OPEN]** are unresolved and listed in §13.

---

## 1. Problem & intent

Third Rail asked for email/password *before* personalization. That put friction ahead of any value. This onboarding flips the order. The user builds a feed in a short, interactive survey, **watches it fill in as they answer**, and can stop at any point to explore. Account creation is deferred until they want to save or engage.

**Design principles**
1. **Value before commitment.** No account, email or permission gate before the feed. **[DECIDED]**
2. **Suggest, never assume.** Nothing is followed unless the user explicitly picks it. Some users come with one narrow focus and must control what they follow. **[DECIDED]**
3. **Every step is skippable.** Skipping everything still lands on a useful "most popular" feed. **[DECIDED]**
4. **Show the consequence of each answer.** Every selection visibly changes the live feed. **[DECIDED]**
5. **Civic neutrality.** Suggestions MUST NOT favor a party or ideology through ordering, labeling or defaults. **[DECIDED]**
6. **Minimal data retention.** The address is used to resolve districts and then discarded. **[DECIDED]**
7. **Refinement later, not upfront.** A "round two" of personalization lives in the feed (persistent suggestions), not in onboarding. **[DECIDED]**

## 2. Launch constraints

| Dimension | Decision |
|---|---|
| Geography | **Full coverage (City + Neighborhood) in NYC only.** **Federal + their own state's legislature for any US address.** This requires ingesting all 50 state legislatures at launch, a data-ingest dependency. **[DECIDED]** |
| Platforms | **Web (responsive) + iOS** **[DECIDED]** |
| Language | **English only.** All strings externalized and i18n-ready. **[DECIDED]** |
| v1 onboarding scope | **All 4 survey steps ship in v1** (Address, Jurisdictions, Politicians, Interests). Politician following and interest-based ranking therefore move up from meeting Tiers 2/3 into v1, at least far enough to support following and feed injection. Full politician profile pages stay out of scope. **[DECIDED]** |
| Sign-up methods | **Sign in with Apple, Google.** Users can also skip and continue without saving. **[DECIDED]** |
| Guest persistence | **Session only.** Selections are lost when the app/tab closes unless the user signs up. **[DECIDED]** |
| Accessibility | WCAG 2.2 AA; iOS Dynamic Type + VoiceOver. **[DECIDED]** |

## 3. Jurisdiction model (NYC launch)

| Level | Legislative body / source | Followable unit | Resolved from address |
|---|---|---|---|
| Federal | U.S. Congress | "Federal" | Congressional district → U.S. Rep; 2 U.S. Senators |
| State | NY State Legislature | "New York State" | State Senate district, Assembly district |
| City | NYC Council (+ Mayor/agencies) | "New York City" | Council district → Council Member |
| Neighborhood | *No legislative body.* Aggregates projects, agency announcements, budget items and news that are geo-tagged to the area | Named neighborhood (e.g., "Park Slope") | Neighborhood containing the address |

- "Neighborhood" means **named neighborhood** only. Council districts, community boards and boroughs are not separately followable at launch. **[DECIDED]**
- Boundary source for named neighborhoods: NYC Neighborhood Tabulation Areas (NTA 2020) as the canonical polygon set, with colloquial aliases (e.g., "DUMBO") on top. **[DECIDED]**
- Users MAY follow neighborhoods other than their own, via search. **[DECIDED, from notes: "you can add others"]**

**Outside NYC [DECIDED]:** Only two levels apply. **Federal** is the user's Congressional district plus their 2 U.S. Senators. **State** is the user's own state legislature (upper and lower chamber districts). City and Neighborhood levels are unavailable. Non-NYC users MAY still follow NYC jurisdictions via search.

## 4. Flow overview

```
App open
  └─ S0 Welcome ─────────────────────────────── [Skip all → S6 with Popular feed]
       └─ S1 Address  ───────────────┐ (skip → no district suggestions)
            └─ S2 Jurisdictions ─────┤ (skip → none selected)
                 └─ S3 Politicians ──┤ (skip → none followed)
                      └─ S4 Interests┤ (skip → none)
                           └─ S6 "Here's your page"
                                └─ Account prompt (deferred, see §8)
                                     └─ on sign-up (iOS) → S5 Notifications

S5 is shown only to signed-in users, never to guests.

At every step: the live preview is visible, and an "Explore my feed" exit leads to S6 with current selections.
```

Progress indicator: "Step n of 4" across S1–S4. S0, S5 and S6 are not counted. **[DECIDED]**

## 5. Screen specifications

### S0 — Welcome
- **Purpose:** Set expectations in a single screen.
- **Content:** Value proposition (one line), "Takes about a minute" **[DECIDED]**, primary CTA **"Build my feed"**, secondary **"Just show me what's popular"**.
- **No** sign-in button above the fold. A small "Already have an account? Sign in" link MAY sit in the footer for returning users. **[DECIDED]**
- Secondary CTA → S6 with the Popular feed (§7.3).

### S1 — Address
- **Prompt:** "Where do you live?" Helper text: *"We use this to find your representatives and neighborhood, then we discard it. We only keep your districts."* **[DECIDED]**
- **Input:** A single street-address field with US-wide autocomplete, biased toward NYC. On iOS, an optional "Use my current location" button that triggers the location permission prompt only when tapped. **[DECIDED]**
- **Resolution:** On selection, geocode server-side to {congressional, state upper chamber, state lower chamber, council district, neighborhood}. The last two resolve only inside NYC. Persist **only the district IDs and neighborhood ID**. The raw address and lat/long MUST NOT be stored or logged, and MUST be removed from analytics payloads and error reports. **[DECIDED]**
- **States:**
  - *Loading:* inline spinner in the field; preview shows skeleton banners.
  - *Success:* a confirmation chip, e.g., "Council District 39 · Park Slope". Tap to edit.
  - *Outside NYC (US address):* Resolve federal + state districts and continue the flow normally. The confirmation chip reads e.g. "NY-1 · Ohio Senate District 3". Show an inline, dismissible note: *"Local coverage is NYC-only for now, but your federal and state feeds are ready. Thinking about moving? [Find a place on StreetEasy ↗]"*. **[DECIDED]** The link opens externally, carries no user data and no address in the URL, and is not a partner/affiliate placement.
  - *Non-US address:* "We only cover the US right now." [Try another address] [Skip].
  - *Unresolvable / ambiguous:* "We couldn't place that address." [Try again] [Skip].
  - *Geocoder down:* fall back to Skip behavior and show a non-blocking toast.
- **Skip:** "Skip". The user then gets no "yours" badges and no district-specific suggestions in S2/S3.
- **Edit later:** Address is editable from Profile **once the user has an account**. Editing re-resolves districts. **[DECIDED]**

### S2 — Jurisdictions
- **Prompt:** "What do you want to keep up with?"
- **Prompt helper:** "Pick any. Each one adds a section to your feed."
- **Options:** Toggle cards: Federal, New York State, New York City, and the resolved neighborhood (e.g. "Park Slope"). The neighborhood card appears **only after an address resolves**. **All start unselected.** **[DECIDED: suggest only, opt-in]** Levels without data yet show as disabled "Coming soon" cards that still carry the "Yours" badge and the user's districts.
- **Outside NYC:** Two cards: Federal and [User's state]. City and Neighborhood cards are hidden. An "Add NYC" search remains available.
- If an address was resolved, cards carry a **"Yours"** badge and show the user's district, e.g., "NY State · Senate District 20, Assembly District 44".
- **"Add another neighborhood"** search opens a typeahead over NYC neighborhoods. It supports multiple selections.
- **Select-all affordance:** A "Select all of mine" text button, shown once an address resolves, so users can opt in quickly without being defaulted in. It selects live levels only. **[DECIDED]**
- **Live preview:** Each selected level adds its own section to the preview (§6).
- **Skip:** Allowed. With zero jurisdictions selected, the feed falls back to Popular at all levels.

### S3 — Politicians
- **Prompt:** "Who do you want to follow?"
- **Suggestion groups (in this order):**
  1. **Your representatives** (if address resolved): U.S. Senators ×2, U.S. Rep, State Senator, Assembly Member, Council Member, Mayor. Outside NYC, this is the federal delegation plus their two state legislators, using that state's chamber titles. Ordered by level (federal → local), never by party. **[DECIDED]**
  2. **Active in [selected jurisdictions]:** politicians ranked by the relevance engine's activity score (bills introduced, upcoming votes, news volume). **[DECIDED: keep trending suggestions]**
     Neutrality guardrails **[DECIDED]**:
     - The ranking uses activity signals only. Party, ideology and users' stance sentiment are never inputs.
     - Each card says why it's suggested, e.g., "Introduced 4 bills this month" or "Vote on Thursday", so the suggestion is explainable.
     - Suggestions are capped at about 8, with a "See more" link, so no single list dominates.
     - Run a periodic audit of the party mix in trending suggestions against the party mix in each legislative body. Flag large skews for review, but don't auto-correct them.
- **Card:** Photo, name, office, district, party (text label, not color-coded) **[DECIDED]**, and a one-line "recent activity" hook. The follow toggle is **off by default**.
- **Search:** "Find someone else" covers any politician in coverage.
- **Prompt helper:** "Each person you follow adds their own section to your feed."
- **Representatives layout:** Council Member and Mayor with Follow toggles, then one disabled "Coming soon" card per state/federal office (State Senator, Assembly Member, U.S. Representative, two U.S. Senators). The "Active…" heading reads "Active in your jurisdictions" once a jurisdiction is selected, else "Active in New York City".
- **Live preview:** Following someone adds a section titled "[Name] · [Office]" holding their items.
- **Skip:** Allowed.
- **Ships in v1.** **[DECIDED]** A `onboarding.step.politicians` flag exists only as an operational kill switch (on by default).

### S4 — Interests
- **Prompt:** "What issues do you care about?"
- **Suggested chips:** ~12–16 chips ranked by (a) topics that are active in the user's selected jurisdictions and followed politicians' bills, then (b) platform-wide popularity. Chips are neutral nouns ("Housing", "Transit", "Public health"), never stance-laden ("Stop X"). **[DECIDED]**
- **Free text:** "Add your own…" accepts any phrase (e.g., "high-speed rail", "COVID", "LGBTQ rights"). Matches resolve to topics in real time (see §7.2 for the performance design). **[DECIDED: chips + free text, must scale]**
- **Prompt helper:** "Each topic adds its own section to your feed." Under "Add your own": "Add a place to narrow it, e.g. 'housing legislation in California'."
- **Adjacency feedback:** After a free-text add, a result box shows the section's title ("bike lanes · Park Slope") and "Matched N items. Added as its own section." (or "No matches yet…"). An uncovered place shows "Coming soon" and "We don't cover California yet. We added the section; it fills in once we do." Related topics appear as tap-to-add buttons ("+ Transit"), never auto-added. **[DECIDED]**
- **Selected chips** stay highlighted in the chip list; typed interests join it as selected chips with a × to remove.
- **Live preview:** Each chip or typed interest adds its own section, titled by the topic name.
- **Skip:** Allowed.
- **Ships in v1.** **[DECIDED]** A `onboarding.step.interests` flag exists only as an operational kill switch (on by default). This makes the §7.2 topic graph and embedding index a v1 dependency.

### S5 — Notifications (iOS only, signed-in users only)
- **Eligibility:** Shown **only to signed-in users**. Guests never see it, because their follows don't outlast the session and there would be nothing to notify them about. **[DECIDED]**
- **Timing:** Shown once, immediately after the user's first successful sign-up. If sign-up was triggered by a gated action (§8), the pending action completes first, then S5 appears. **[DECIDED]** If the user dismisses it, the contextual ask (e.g., on following a bill with an upcoming vote) is the next chance.
- **Pre-permission explainer** (custom screen, shown before the system prompt): "Get notified before votes on bills you follow." CTAs: [Turn on notifications] → system prompt; [Not now] → return to the feed.
- MUST NOT trigger the system prompt without the explainer. A denial at the explainer stage leaves the one-time system prompt unused for a later contextual ask. **[DECIDED]**
- Web: no push notifications and no notification prompt in v1. S5 is iOS-only. **[DECIDED]**

### S6 — "Here's your page"
- **Headline:** "Here's your page", subline "You can customize it anytime.", and a **Customize** button. **[DECIDED copy, from notes]** With nothing selected: "Popular right now", "Personalize it in about a minute." and a **Personalize** button that re-enters at S1.
- The user's sections (5 items each, "See all"), then **Tracked** ("Nothing tracked yet: open any item and follow it or take a stance there"), **Trending**, and **Friend activity** ("No friend activity yet"). On web each section has a small uppercase kind label (Jurisdiction, Neighborhood, Topic, Politician, Your list, Everyone) and sections sit in a responsive grid. A "Coming soon" strip notes that Federal and New York State join automatically once covered.
- A dismissible coach mark points at the customize entry point.
- **Account prompt** appears here as a non-blocking banner/sheet (§8).

## 6. Live preview (the "feed builds as you go" mechanic)

**Layout [DECIDED: split view / peek]**
- **Web ≥1024px:** Two columns. Survey on the left (~40%), live feed on the right (~60%), scrolling independently. The feed is interactive but read-only (no engagement before S6).
- **Web <1024px and iOS:** A **peek card** pinned under each question shows the top 2–3 feed items and a count ("14 items in your feed"). Tapping it, or dragging the handle up, expands the full feed as a sheet. A persistent CTA in the sheet, **"Keep building"**, returns to the survey at the same step. **"Explore my feed"** exits to S6.

**Structure:** The preview shows the user's **sections** in home-page order: jurisdictions, neighborhoods, topics, politicians (§6.1). Each shows its top 3 items. With none selected, the Popular feed shows ("Showing what's popular · N items").

**Change feedback**
- Newly inserted items animate in (fade + 8px slide, 200ms). Respect `prefers-reduced-motion` / iOS Reduce Motion by disabling the motion and keeping a brief highlight. **[DECIDED]**
- Changes are announced to screen readers through a polite live region, e.g., "Added 3 items from New York City · 2 sections · 6 items." **[DECIDED]**
- Newly added items are outlined and labeled "New ·". The mobile peek card shows the first 2 items, each tagged with its section name.

### 6.1 Sections and cards (v1.2, from the design export)
- **Section titles are the name only:** "New York City", "Park Slope", "Housing", "bike lanes · Park Slope", "[Name] · Council Member". No "Because you follow" text anywhere, on sections or items.
- **Item cards** show type · status, the title, and an optional context label ("Hearing Thursday", "Passed committee", "Trending", "42 people weighed in"). **No stance or engagement controls on cards.** The whole card is a link to the item's full page, where stances and comments happen.
- A section for an uncovered place shows "Coming soon" with "We don't cover [place] yet. This section fills in automatically once we do."

**Performance budgets [DECIDED]**
| Trigger | p95 preview update |
|---|---|
| Toggle jurisdiction / politician / chip | ≤ 300 ms |
| Free-text interest add | ≤ 800 ms |
| Address resolution | ≤ 1.5 s |

## 7. Content & ranking behavior

### 7.1 Content in preview
MVP content unit = **bills** in the selected legislative bodies (meeting MVP scope). **Neighborhood banners are populated at launch** with geo-tagged projects, agency announcements and budget items from ingest. **[DECIDED]**

Requirements this creates for ingest **[DECIDED]**:
- Every neighborhood item MUST carry one or more neighborhood IDs, from the same neighborhood boundary set as §3, so it matches the user's resolved neighborhood.
- Items that cover several neighborhoods (e.g., a corridor project) are tagged to each one they touch.
- If a particular neighborhood has no items, its banner shows nearby neighborhoods' items labeled "Nearby: [name]" rather than an empty banner. The fallback stays within the same borough.

### 7.2 Interest mapping at scale (e.g., 300k+ bills) **[DECIDED]**
Goal: real-time adjacency matching with **zero LLM calls per bill at query time** and near-zero tokens per onboarding.

1. **Offline, at ingest (once per bill version):** Generate an embedding for each bill (title + summary). Assign 1–5 canonical topic IDs from a curated **topic graph** of ~300–1,000 nodes, each with aliases and "adjacent" edges. Use the existing Third Rail relevance-scoring pipeline where possible. The cost is paid once and amortized; re-run only on bill text changes.
2. **Chip tap (onboarding):** The chip *is* a topic ID, so selection is a pure index lookup (topic → bills ∩ selected jurisdictions, ordered by relevance score). **No model call.**
3. **Free-text phrase:**
   a. Normalize, then check the **alias/phrase cache** (e.g., "hsr", "high speed rail" → `topic:high_speed_rail`). A cache hit means no model call.
   b. On a miss: make **one embedding call** for the phrase (tens of tokens), then run nearest-neighbor search over **topic-node embeddings** (≤1k vectors, which is trivial). Map to the top-k topics and fetch bills through the index, as in step 2.
   c. Optionally, also run ANN over bill embeddings, **pre-filtered by the user's jurisdictions**, to catch long-tail bills without a topic tag.
   d. **Asynchronously** (not blocking the UI), an LLM MAY review novel phrases offline to add aliases and edges to the topic graph. Low-confidence matches are logged for curation.
4. **Topic list curation workstream [DECIDED: needed before launch; owner TBD]:**
   - **Starting topics:** A curated starting list of topics, with related-topic links, exists before launch. Every ingested bill is tagged against it. AI MAY draft the list, but a person reviews it for gaps and neutral wording (e.g., "Immigration", not "Border crisis").
   - **User-suggested topics:** Users can type their own topic. The AI makes a best guess and maps it to existing topics. Phrases it isn't confident about are logged for review.
   - **Ongoing review:** Someone regularly reviews that log and either adds each phrase as a new topic or attaches it as an alias of an existing one.
   - **Owner:** TBD. This is a launch blocker: interest matching depends on it.
5. **Cost envelope:** ≤1 embedding call per free-text term; 0 LLM generation calls in the request path. The vector index lives in the data store (e.g., pgvector or an equivalent). Final choice belongs to the data-ingest workstream.

### 7.3 Popular feed (zero-selection fallback) **[DECIDED]**
Shown when the user skips everything, or skips S2 with no other selections. Banners: Federal, NY State, NYC. Each shows the top items by platform-wide relevance (signals from the meeting: news volume, co-sponsor count, upcoming votes, on-platform engagement). Header: "Popular right now" plus an inline "Personalize" CTA that re-enters onboarding at S1.

## 8. Account creation (deferred)

**When it's offered [DECIDED: guest mode, prompt later]**
1. At **S6**, as a non-blocking sheet: "Save your feed." [Continue with Apple] [Continue with Google] [Not now].
2. **At the first gated action** (stance, like, comment, saving a follow beyond the session), which happens **on the item's full page** since cards carry no engagement controls (§6.1): a contextual sheet, "Sign in to take a stance on this bill." The pending action completes after sign-in. **[DECIDED]**

**Rules**
- "Not now" is always available. Guests keep browsing and their selections last for the session. **[DECIDED]**
- Guest state is **session-only**: closing the tab/app loses it. The S6 sheet MUST say so honestly: "Your choices won't be saved if you leave." **[DECIDED]**
- On sign-up, the guest session's selections (district IDs, jurisdictions, follows, interests) attach to the new account. No re-onboarding.
- Sign in with Apple MUST be offered on iOS (App Store guideline 4.8, because Google login is offered).
- On iOS, a successful first sign-up hands off to S5 (notifications explainer).
- A returning signed-in user never sees onboarding again. Customization lives in Settings → "My feed".
- Do not re-show the S6 save sheet more than once per session after dismissal. **[DECIDED]**

## 9. Post-onboarding refinement ("round two")
Persistent, dismissible recommendation cards inline in the feed, modeled on LinkedIn's "people you may know": suggested politicians, topics and neighboring jurisdictions. These are not part of onboarding but are the planned alternative to a longer survey. Frequency cap: ≤1 suggestion card per ~10 feed items. **[DECIDED]**

## 10. Accessibility & inclusive design **[DECIDED]**
- WCAG 2.2 AA. Tap targets ≥44×44pt. Contrast ≥4.5:1 for text.
- Fully keyboard-operable on web. Focus moves to each step's heading on advance.
- Party affiliation is shown as text; never rely on red/blue alone.
- Plain-language copy at roughly a grade 6–8 reading level. Spell out acronyms on first use.
- Reduced-motion support for the live preview (§6).

## 11. Analytics & success metrics

**Success metrics [DECIDED]:** onboarding completion rate, time to first engagement, sign-up conversion, D7 retention. Numeric targets are **TBD [DECIDED]**. They will be set once post-launch baseline data exists.

| Metric | Definition |
|---|---|
| Completion rate | % of S0 viewers who reach S6, through the survey *or* "Explore my feed" *or* "Just show me what's popular" (reported by path) |
| Time to first engagement | Median time from S0 view to first stance/like/comment |
| Sign-up conversion | % of guests who create an account within the session, split by trigger (S6 sheet vs. gated action) |
| D7 retention | % of signed-up users active on day 7. Report guests separately via anonymous device ID where permitted |

**Events [DECIDED]:** `onb_view{step}`, `onb_skip{step}`, `onb_explore_exit{step}`, `onb_address_result{success|outside_nyc|non_us|failed, state}` (no address payload), `onb_streeteasy_click`, `onb_select{type, id, source: suggested|search|freetext}`, `onb_freetext_match{cache_hit, latency_ms, topics_count}`, `onb_preview_expand`, `onb_notif{explainer_accept|explainer_decline|system_grant|system_deny}`, `onb_complete{path}`, `auth_prompt{trigger}`, `auth_success{method}`.

## 12. Out of scope (this spec)
Engagement mechanic design (stance format is TBD per the meeting), gamification (streaks, leaderboards, Wrapped-style recap), politician profile pages, ranking-model internals, multi-language, city/neighborhood coverage beyond NYC.

## 13. Open questions

| # | Question | Why it matters |
|---|---|---|
| ~~Q1~~ | ~~Phasing of S3/S4~~ **Resolved 2026-11-08:** all 4 steps ship in v1 (see §2). | — |
| ~~Q2~~ | ~~Neighborhood content at launch~~ **Resolved 2026-11-08:** yes. Projects, agency announcements and budget items will be geo-tagged at launch (see §7.1). | — |
| ~~Q3~~ | ~~Notifications vs. session-only guests~~ **Resolved 2026-11-08:** S5 is shown to signed-in users only, right after first sign-up (see S5). | — |
| ~~Q4~~ | ~~Neutrality of trending politicians~~ **Resolved 2026-11-08:** keep trending suggestions in S3, with the guardrails listed there. | — |
| ~~Q5~~ | ~~Outside-NYC addresses~~ **Resolved 2026-11-08:** show federal + their own state's legislature, plus a playful StreetEasy "move to NYC" link (see S1). | — |
| ~~Q6~~ | ~~Web push in v1~~ **Resolved 2026-11-08:** no. Push is iOS only in v1. | — |
| Q7 | **Owner TBD** for the topic list curation workstream (starting topics + review of uncertain user-suggested topics). The workstream is **required before launch** (see §7.2 item 4). | Interest matching degrades without it |
| Q8 | Numeric targets for the four success metrics: **TBD**, to be set after a post-launch baseline. Not a launch blocker. | Tracking only until then |

## 14. Acceptance criteria (summary)
- [ ] A user can reach a populated feed from S0 with zero inputs.
- [ ] Every step S1–S5 has a working Skip, and every step S1–S4 has an "Explore my feed" exit.
- [ ] Nothing is followed or selected without an explicit user action.
- [ ] The raw address never appears in the DB, logs, analytics or crash reports. Only district and neighborhood IDs persist, and only after sign-up.
- [ ] Each selection updates the live preview within the §6 budgets, and the change is announced to assistive tech.
- [ ] Chip selections make zero model calls. Free-text makes at most one embedding call and no LLM generation in the request path.
- [ ] Sign-up offers Apple + Google with "Not now". Guest selections carry into the new account.
- [ ] The iOS notification system prompt is only ever triggered from the explainer's accept CTA.
- [ ] Guests never see S5. Signed-in users see it at most once, after first sign-up.
- [ ] All §11 events fire with no PII.
- [ ] The starting topic list is reviewed and loaded, all bills are tagged against it, and the review log for uncertain user-suggested topics is live with an assigned owner.
