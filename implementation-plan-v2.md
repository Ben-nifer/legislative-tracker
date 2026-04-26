# Implementation Plan v2

> Generated: 2026-04-04
> Domain confirmed: `noreply@legislative-tracker.com`

---

## Key Decisions

- Hashtag tags: deferred to later
- Resolutions: hidden everywhere, not filterable
- Watching stance: removed, absorbed into "Following" (legislation_follows)
- Bookmarks + legislation_follows + watching → single legislation_follows table ("Following")
- Calendar: section within Following page, shows hearings + votes from events table
- Council member data sources: council.nyc.gov/districts/ scrape, GitHub CDN photos, Legistar API for committees
- Social platforms: Twitter/X, Instagram, LinkedIn, Facebook, Substack, personal website
- Terms & Conditions: must accept on sign-up, stored in DB
- Find my council member: address lookup via NYC geocoding API, user prompted to save result
- Magic link email: noreply@legislative-tracker.com
- "For You" section: simple v1 using interest tags → committees → legislation

---

## Execution Order

```
Phase 1   → DB migrations (run in Supabase SQL editor)
Phase 1.5 → Fix Legistar links (bug fix, unblocks everything)
Phase 2   → Hide resolutions + committees filter (same files, do together)
Phase 3a  → Following: server actions + stats function
Phase 3b  → Following: UI components
Phase 3c  → Following: page + routing
Phase 3d  → Following: navigation
Phase 4   → Cards: remove dropdown + short summary title
Phase 5a  → Council sync: photos + committees
Phase 5b  → Council sync: district scraper
Phase 5c  → Council sync: cron + admin UI
Phase 6   → Council member profile UI
Phase 7a  → Profile: edit inline + social links + notifications
Phase 7b  → Profile: find my council member
Phase 8   → Homepage: separate experiences + For You
Phase 9   → Following page + calendar
Phase 10  → Legislation page: social context + comments verification
Phase 11a → Auth: Google sign-in (requires external setup first)
Phase 11b → Auth: white label email (requires external setup first)
Phase 12a → Admin: skip synced sponsorships
Phase 12b → Terms & conditions
```

Phases 5–12 have no strict dependencies on each other and can be run in any order once Phases 1–4 are complete.

---

## Phase 1 — Complete DB Migrations

*All schema changes in one place. Run in Supabase SQL editor before any other phase.*

**Prompt:**
```
Run the following database migrations. Check the existing schema first using:
  SELECT column_name FROM information_schema.columns WHERE table_name = 'legislators';
  SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles';
  SELECT column_name FROM information_schema.columns WHERE table_name = 'legislation';
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
Only add columns/tables that don't already exist.

--- LEGISLATION ---
ALTER TABLE legislation ADD COLUMN IF NOT EXISTS short_summary TEXT;

--- LEGISLATORS ---
ALTER TABLE legislators ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE legislators ADD COLUMN IF NOT EXISTS neighborhoods TEXT[];
ALTER TABLE legislators ADD COLUMN IF NOT EXISTS community_boards TEXT[];
ALTER TABLE legislators ADD COLUMN IF NOT EXISTS caucuses TEXT[];
ALTER TABLE legislators ADD COLUMN IF NOT EXISTS photo_url TEXT;

--- USER PROFILES ---
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"hearing_alerts":true,"bill_updates":true,"comment_engagement":true,"new_followers":true}'::jsonb;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS council_member_id UUID REFERENCES legislators(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS community_board TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

--- COMMITTEES TABLE ---
CREATE TABLE IF NOT EXISTS committees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  legistar_body_id INTEGER UNIQUE,
  legislature_id UUID REFERENCES legislatures(id)
);

--- LEGISLATOR COMMITTEE MEMBERSHIPS ---
CREATE TABLE IF NOT EXISTS legislator_committee_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legislator_id UUID NOT NULL REFERENCES legislators(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  is_chair BOOLEAN DEFAULT false,
  start_date DATE,
  end_date DATE,
  UNIQUE(legislator_id, committee_id)
);

--- FOLLOWING CONSOLIDATION ---
-- Step 1: Migrate bookmarks into legislation_follows
INSERT INTO legislation_follows (user_id, legislation_id, notify_updates, notify_hearings, notify_amendments, created_at)
SELECT b.user_id, b.legislation_id, false, false, false, b.created_at
FROM bookmarks b
WHERE NOT EXISTS (
  SELECT 1 FROM legislation_follows lf
  WHERE lf.user_id = b.user_id AND lf.legislation_id = b.legislation_id
);

-- Step 2: Migrate watching stances into legislation_follows
INSERT INTO legislation_follows (user_id, legislation_id, notify_updates, notify_hearings, notify_amendments, created_at)
SELECT us.user_id, us.legislation_id, false, false, false, us.created_at
FROM user_stances us
WHERE us.stance = 'watching'
AND NOT EXISTS (
  SELECT 1 FROM legislation_follows lf
  WHERE lf.user_id = us.user_id AND lf.legislation_id = us.legislation_id
);

-- Step 3: Delete watching stances (after migration confirmed)
DELETE FROM user_stances WHERE stance = 'watching';

-- Step 4: Update the stance enum to remove 'watching'
-- Check current enum first:
SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'stance_type');
-- If 'watching' is in the enum, remove it (only run if watching is present):
ALTER TYPE stance_type RENAME TO stance_type_old;
CREATE TYPE stance_type AS ENUM ('support', 'oppose', 'neutral');
ALTER TABLE user_stances ALTER COLUMN stance TYPE stance_type USING stance::text::stance_type;
DROP TYPE stance_type_old;

--- UPDATE refresh_legislation_stats FUNCTION ---
-- watching_count now counts legislation_follows rows, not watching stances.
CREATE OR REPLACE FUNCTION refresh_legislation_stats()
RETURNS void AS $$
BEGIN
  INSERT INTO legislation_stats (
    legislation_id,
    support_count,
    oppose_count,
    neutral_count,
    watching_count,
    comment_count,
    bookmark_count,
    trending_score,
    engagement_24h,
    engagement_7d
  )
  SELECT
    l.id,
    COUNT(CASE WHEN us.stance = 'support' THEN 1 END),
    COUNT(CASE WHEN us.stance = 'oppose' THEN 1 END),
    COUNT(CASE WHEN us.stance = 'neutral' THEN 1 END),
    (SELECT COUNT(*) FROM legislation_follows lf WHERE lf.legislation_id = l.id),
    (SELECT COUNT(*) FROM comments c WHERE c.legislation_id = l.id AND c.is_hidden = false),
    (SELECT COUNT(*) FROM legislation_follows lf2 WHERE lf2.legislation_id = l.id),
    (SELECT COUNT(*) FROM engagement_events ee WHERE ee.legislation_id = l.id AND ee.created_at > NOW() - INTERVAL '7 days') * 2 +
    (SELECT COUNT(*) FROM engagement_events ee2 WHERE ee2.legislation_id = l.id AND ee2.created_at > NOW() - INTERVAL '30 days'),
    (SELECT COUNT(*) FROM engagement_events ee3 WHERE ee3.legislation_id = l.id AND ee3.created_at > NOW() - INTERVAL '24 hours'),
    (SELECT COUNT(*) FROM engagement_events ee4 WHERE ee4.legislation_id = l.id AND ee4.created_at > NOW() - INTERVAL '7 days')
  FROM legislation l
  LEFT JOIN user_stances us ON us.legislation_id = l.id
  GROUP BY l.id
  ON CONFLICT (legislation_id) DO UPDATE SET
    support_count = EXCLUDED.support_count,
    oppose_count = EXCLUDED.oppose_count,
    neutral_count = EXCLUDED.neutral_count,
    watching_count = EXCLUDED.watching_count,
    comment_count = EXCLUDED.comment_count,
    bookmark_count = EXCLUDED.bookmark_count,
    trending_score = EXCLUDED.trending_score,
    engagement_24h = EXCLUDED.engagement_24h,
    engagement_7d = EXCLUDED.engagement_7d;
END;
$$ LANGUAGE plpgsql;
```

---

## Phase 1.5 — Fix Legistar Legislation Links

*Bug fix. Do this before any UI work so links work correctly.*

**Prompt:**
```
The links to Legistar legislation pages are broken. Investigate and fix.

The legislation table has a legistar_url column. On the legislation detail page
(src/app/(public)/legislation/[slug]/page.tsx), there should be a link to the
official Legistar page.

Steps:
1. Read src/app/(public)/legislation/[slug]/page.tsx and find where legistar_url
   is used (or should be used).
2. Query a few rows from the legislation table to see what legistar_url values
   look like — are they null, malformed, or pointing to wrong URLs?
3. Check src/lib/legistar/sync.ts to see how legistar_url is being set during sync.
   The correct Legistar URL format for NYC is:
   https://legistar.council.nyc.gov/LegislationDetail.aspx?ID={MatterID}&GUID={MatterGUID}
   where MatterID and MatterGUID come from the Legistar API response.
4. If the URL is being stored incorrectly, fix the sync function to store the correct URL.
5. If the URL is correct in the DB but the link is broken in the UI, fix the component.
6. Also check: on the legislation browse page and cards, if there are any direct
   Legistar links, verify they use the correct stored URL.
7. Test with a known bill (e.g., search for a recent intro and verify the link opens
   the correct Legistar page).
```

---

## Phase 2 — Hide Resolutions + Replace Topics with Committees

*Combined because both edits touch the same files.*

**Prompt:**
```
Make two related changes to the legislation browse page. Do them together since
they touch the same files.

Files: src/app/(public)/legislation/page.tsx, src/components/legislation/LegislationFilters.tsx,
src/app/page.tsx, src/app/(public)/trending/page.tsx

--- CHANGE 1: Hide resolutions everywhere ---
Add .eq('type', 'introduction') to every Supabase query that fetches legislation
for display. Specifically:
- src/app/(public)/legislation/page.tsx — main browse query
- src/app/page.tsx — trending query, recently introduced query, and the
  "from people you follow" feed
- src/app/(public)/trending/page.tsx — main query

Also remove the "Type" filter dropdown from LegislationFilters.tsx entirely
(no toggle to show resolutions — they are simply hidden).

--- CHANGE 2: Replace topics filter with committees filter ---
In src/app/(public)/legislation/page.tsx:
- Remove the topic-based filter logic (the part that queries legislation_topics)
- Add committee filtering: when a committee URL param is set, add
  .eq('committee_id', committeeId) to the main query
- Fetch the list of committees server-side:
  SELECT DISTINCT c.id, c.name FROM committees c
  JOIN legislation l ON l.committee_id = c.id
  WHERE l.type = 'introduction'
  ORDER BY c.name
- Pass the committees list as a prop to LegislationFilters

In src/components/legislation/LegislationFilters.tsx:
- Replace the Topic <select> with a Committee <select>
- Accept committees as a prop: { id: string, name: string }[]
- Use 'committee' as the URL param name
- Keep the same visual style as the existing filters

Keep the topics table and legislation_topics data in the database — just remove
from UI.
```

---

## Phase 3a — Following Consolidation: Server Actions + Stats

**Prompt:**
```
Update server actions to reflect the new Following system (no more bookmarks or
watching stance). DB migrations from Phase 1 must be complete before this.

--- src/app/actions/engagement.ts ---
- Remove the toggleBookmark function entirely
- Remove all references to the bookmarks table
- Update the Stance type to: 'support' | 'oppose' | 'neutral' (no 'watching')
- In setStance(), remove any handling of stance='watching'
- In the stats recalculation after setStance(), ensure watching_count is NOT
  recalculated from stances — leave it as-is (it now comes from legislation_follows)

--- src/app/actions/social.ts ---
- Verify followLegislation(legislationId) and unfollowLegislation(legislationId)
  exist and work correctly against the legislation_follows table
- After follow/unfollow, update legislation_stats.watching_count immediately
  (increment or decrement by 1) using the service client, same pattern as
  setStance does for stance counts
- revalidatePath('/legislation') and revalidatePath('/') after follow/unfollow

--- Types ---
- Find and update the Stance type definition wherever it lives.
  Remove 'watching' from the union type.

After these changes, run the admin "Refresh Stats" job to resync all counts.
```

---

## Phase 3b — Following Consolidation: UI Components

**Prompt:**
```
Update legislation UI components to replace bookmark/watching with a unified
Follow button. Phase 3a server actions must be complete first.

--- src/components/legislation/EngagementSection.tsx (or StanceButtons.tsx) ---
- Remove the "Watching" stance button from the stance row
- Stance buttons are now only: Support, Oppose, Neutral
- Add a separate "Follow" / "Following" toggle button:
  - Not following: outlined button with bookmark/bell icon, text "Follow"
  - Following: filled blue-500 button, text "Following"
  - Hover when following: shows "Unfollow"
  - Calls followLegislation() / unfollowLegislation() from social.ts
  - Shows following count from legislation_stats.watching_count
  - Disabled if not logged in
- Update tally cards: remove Watching card, replace with Following card
  showing watching_count with a Users or Bookmark icon

--- src/components/legislation/LegislationCard.tsx ---
- Remove the bookmark button and all bookmark state (initialBookmarked prop, etc.)
- Add a Follow toggle button in the same position
  - Same Follow/Following states as above
  - Uses followLegislation/unfollowLegislation
  - Accept initialFollowing: boolean prop
  - Use e.stopPropagation() so clicking Follow doesn't navigate to detail page
```

---

## Phase 3c — Following Consolidation: Following Page

**Prompt:**
```
Replace the bookmarks page with a Following page.

1. Create src/app/(auth)/following/page.tsx:
   - Protected route (redirect to login if not authenticated)
   - Fetches user's followed legislation from legislation_follows (not bookmarks)
   - Same data shape as current bookmarks page — join legislation_follows with
     legislation, legislation_stats, sponsorships, legislation_history
   - Pass initialFollowing={true} to LegislationCard
   - Same 3-column grid layout
   - Empty state: "You aren't following any bills yet. Browse legislation to
     find bills to follow."
   - Page title: "Following"

2. Replace src/app/(auth)/bookmarks/page.tsx content with a redirect:
   import { redirect } from 'next/navigation';
   export default function BookmarksRedirect() { redirect('/following'); }

3. Ensure /following is in the middleware's protected routes list.
```

---

## Phase 3d — Following Consolidation: Navigation

**Prompt:**
```
Update navigation to add "Following" tab and remove "Bookmarks".

--- src/components/layout/Header.tsx ---
- Update NAV_LINKS:
  - Remove any "Bookmarks" entry
  - Add { label: 'Following', href: '/following' } — show only when logged in
  - Final nav (logged in): Legislation | Council Members | Following
  - Final nav (logged out): Legislation | Council Members
- Split NAV_LINKS into public and auth-required arrays if needed, and
  conditionally render auth-required links based on user session.


--- src/components/layout/MobileNav.tsx ---
- Apply the same nav changes to the mobile drawer

--- Everywhere else ---
- Search codebase for href="/bookmarks" → update to href="/following"
- Search for UI text "Bookmarks" → update to "Following"
- Search for UI text "Saved" (when referring to legislation) → update to "Following"
- Search for UI text "Watching" → update to "Following"
```

---

## Phase 4 — Legislation Cards: Remove Dropdown + Short Summary Title

**Prompt:**
```
Two changes to src/components/legislation/LegislationCard.tsx.
Phase 3b must be complete first.

--- CHANGE 1: Remove dropdown, make card clickable ---
- Remove all expand/collapse state (isExpanded, chevron button, grid animation)
- Remove the Level 2 content block entirely (committee/sponsor/date dropdown)
- Wrap the card content in a Next.js <Link href={`/legislation/${slug}`}>
- The Follow button must use e.stopPropagation() and e.preventDefault() to
  prevent the link from firing when clicking Follow
- Keep all Level 1 content: status badge, file number, title/summary,
  engagement stats

--- CHANGE 2: Show short_summary as card title ---
- Fallback chain: short_summary → first 10 words of ai_summary + "..." → title
- Below the title, show ai_summary (or official_summary) clamped to 2 lines
- Update LegislationCardData type to include short_summary: string | null
- Update all queries that build LegislationCardData to select short_summary

--- ADMIN: Generate short summaries ---
In src/app/actions/admin.ts, add generateShortSummaries():
- Fetch 25 legislation rows where short_summary IS NULL and ai_summary IS NOT NULL
  and type = 'introduction'
- For each, call Anthropic API (claude-sonnet-4-20250514):
  prompt: "Summarize this legislation in 5-10 words using plain language. Return
  only the summary, no punctuation at the end: [ai_summary]"
- Save result to short_summary
- Return { processed, total, done }

Add a job card for this on src/app/(admin)/admin/sync/page.tsx following the
same pattern as existing job cards (Run Once / Run All / Stop / log display).
```

---

## Phase 5a — Council Sync: Photos + Committee Memberships

**Prompt:**
```
Update src/lib/legistar/sync.ts with two additions:

--- PHOTOS ---
In syncCouncilMembers(), after building each legislator record, set photo_url to:
`https://raw.githubusercontent.com/NewYorkCityCouncil/districts/master/thumbnails/district-${String(district).padStart(2, '0')}.jpg`
where district is the legislator's district number.
Only set this if the legislator has a district number.

--- COMMITTEE MEMBERSHIPS ---
Add exported function syncCommitteeMemberships():

1. Fetch all active legislators from DB (select id, legistar_person_id, slug)
2. For each legislator, call Legistar API:
   GET /v1/nyc/persons/{legistar_person_id}/officerecords
   (filter for committee-type body records)
3. For each office record:
   - Extract BodyName, MemberTitle, BodyId, StartDate, EndDate
   - Look up or create committee:
     SELECT id FROM committees WHERE legistar_body_id = {BodyId}
     If not found: INSERT into committees (name, slug, legistar_body_id)
   - Upsert into legislator_committee_memberships:
     (legislator_id, committee_id, is_chair, start_date, end_date)
     is_chair = MemberTitle contains 'Chair' (case insensitive)
4. Return { processed, membershipsFound, committeesCreated }

Add admin action runSyncCommitteeMemberships() in src/app/actions/admin.ts.
Add a job card on the admin sync page.
```

---

## Phase 5b — Council Sync: District Scraper

**Prompt:**
```
Build a scraper to pull district data from council.nyc.gov/districts/.

Create src/lib/council/scrape-districts.ts:

For each district (1–51), fetch council.nyc.gov/district-{N}/ and parse:
- Neighborhoods (comma-separated list or dedicated section)
- Community Boards ("Community Board X" entries)

Implementation:
1. Use fetch() to retrieve each district page
2. Parse HTML with regex or basic string parsing to extract the fields
3. Look up the legislator in DB by district number
4. UPDATE legislators SET neighborhoods = $1, community_boards = $2
   WHERE district = $3

Export scrapeAndSyncDistrictData() — processes all 51 districts sequentially
with a 500ms delay between requests to avoid rate limiting.

Add admin action runScrapeDistrictData() in src/app/actions/admin.ts.
Add a job card on the admin sync page.

Note: if scraping fails for a district, log the error with the district number
so it can be filled in manually — do not abort the whole run.
```

---

## Phase 5c — Council Sync: Cadence + Cron

**Prompt:**
```
Add automated refresh scheduling for council member data.

1. In src/app/(admin)/admin/sync/page.tsx, add a "Sync Council Members" card that:
   - Runs syncCouncilMembers() then syncCommitteeMemberships() sequentially
   - Shows combined log output
   - Uses Run Now / Stop pattern

2. Add a weekly cron job:
   Create src/app/api/cron/sync-council/route.ts
   - Calls syncCouncilMembers() and syncCommitteeMemberships()
   - Protected by CRON_SECRET header check (same pattern as existing cron routes)

   In vercel.json, add:
   { "path": "/api/cron/sync-council", "schedule": "0 2 * * 1" }
   (runs at 2am every Monday)

3. The district scraper (Phase 5b) stays manual-only — add it to the admin page
   but do NOT add it to the cron.
```

---

## Phase 6 — Council Member Profile UI

**Prompt:**
```
Update the council member list and profile pages to show new data.

--- src/app/(public)/council-members/page.tsx ---
Change the subtitle under each council member's name from their title
(e.g., "Council Member", "Majority Whip") to "District [N]":
  district ? `District ${district}` : title

--- src/app/(public)/council-members/[slug]/page.tsx ---
Update the data query to also fetch:
- legislator_committee_memberships with committees(name, slug)

Add a section below the existing content (only show fields with data):
- Borough (confirm it's visible; add if missing)
- Party
- Neighborhoods: comma-separated, label "Neighborhoods"
- Community Boards: comma-separated, label "Community Boards"
- Website: "Official Website →" link, opens in new tab (only if website_url set)
- Committees: list of committee names. If is_chair=true, add a small amber-500
  "Chair" badge next to the name.
- Caucuses: comma-separated (from caucuses[] column)

Keep dark theme and existing layout structure.
```

---

## Phase 7a — Profile: Edit Inline + Social Links + Notification Preferences

**Prompt:**
```
Overhaul the user profile page. Three sub-tasks:

--- RENAME ---
Find all UI text "Public Profile" → change to "Profile".

--- EDIT PROFILE INLINE ---
Profile page shows view mode by default with an "Edit Profile" button.
When clicked, fields become editable in place (no URL change).
Use isEditing boolean state in a client component wrapper.
View mode: bio, links, interest tags as static text/chips.
Edit mode: existing ProfileEditor form, AvatarUploader, InterestTagsEditor.
Save button submits and returns to view mode.
If a separate /profile/edit route exists, redirect it to /profile.

--- SOCIAL MEDIA LINKS ---
user_profiles.links is JSONB: [{platform: string, url: string}]
In edit mode, add "Social Links" section with labeled inputs for:
  Twitter/X, Instagram, LinkedIn, Facebook, Substack, Personal Website
Each shows a platform icon + URL text input.
Only save non-empty values.
In view mode, show filled-in links as icon buttons opening in a new tab.
Update the profile server action to save the links array.

--- NOTIFICATION PREFERENCES ---
In edit mode, add "Notifications" section with toggles for:
- Upcoming hearings on bills you follow (hearing_alerts)
- Updates to bills you follow (bill_updates)
- Engagement on your comments (comment_engagement)
- New followers (new_followers)
Maps to notification_preferences JSONB column (added in Phase 1).
Save via updateNotificationPreferences(prefs) in src/app/actions/profile.ts.
```

---

## Phase 7b — Profile: Find My Council Member

**Prompt:**
```
Add a "My Council Member & Community Board" section to the profile page.
Build as a self-contained section, separate from the Phase 7a edit flow.

--- UI ---
Always visible on the profile page (not just in edit mode).

If council_member_id is set:
  Show council member name, district, borough, photo, link to their profile.
  Show community board value.
  Show an "Update" button.

If council_member_id is null:
  Show prompt: "Find your council member by entering your address."
  Show a "Find" button.

When Find/Update is clicked:
  Show an address input (street address) and "Look Up" button.

--- Server Action ---
Create lookupAddressDistrict(address: string) in src/app/actions/profile.ts:
1. Call NYC Planning Labs Geocoding API:
   GET https://geosupport.planninglabs.nyc/geocode?input={encodeURIComponent(address)}
   Parse response for cityCouncilDistrict and communityDistrict.
2. Look up legislator: SELECT * FROM legislators WHERE district = {n} AND is_active = true
3. Return { legislator, communityBoard, error? }

--- Result UI ---
Show result:
  "Your council member is [Name], District [N]"
  "Your community board is [X]"
  Buttons: "Save to my profile" and "Cancel"

On Save, call saveCouncilMember(legislatorId, communityBoard):
  UPDATE user_profiles SET council_member_id = $1, community_board = $2
  WHERE id = current_user_id

Handle errors with clear messages ("Address not found", "Could not determine
district") and a suggestion to try a more specific address.
```

---

## Phase 8 — Homepage: Separate Experiences + "For You"

**Prompt:**
```
Update src/app/page.tsx for distinct logged-in/out experiences and a For You section.

--- LOGGED-OUT ---
- Keep: Hero, Trending (introductions only), Recently Introduced (introductions only)
- Replace "New from people you follow" with a sign-in CTA:
  "Join to follow legislation, track your council member, and connect with
  fellow New Yorkers." with Sign Up and Sign In buttons.

--- LOGGED-IN ---
- Replace hero with minimal greeting: "Welcome back, [name]"
- Section order: For You → New from People You Follow → Trending
- Hide "Recently Introduced"

--- FOR YOU SECTION (v1) ---
Show up to 6 introduction bills the user hasn't followed or taken a stance on.

Server function getForYouLegislation(userId):

Step 1 — Get user's engaged committee IDs:
  SELECT DISTINCT l.committee_id
  FROM user_stances us JOIN legislation l ON l.id = us.legislation_id
  WHERE us.user_id = $userId AND l.committee_id IS NOT NULL

Step 2 — Get legislation IDs to exclude (already engaged):
  SELECT legislation_id FROM user_stances WHERE user_id = $userId
  UNION
  SELECT legislation_id FROM legislation_follows WHERE user_id = $userId

Step 3 — Fetch candidates:
  SELECT l.*, ls.* FROM legislation l
  JOIN legislation_stats ls ON ls.legislation_id = l.id
  WHERE l.type = 'introduction'
  AND l.committee_id = ANY($engagedCommitteeIds)
  AND l.id NOT IN ($excludedIds)
  ORDER BY ls.trending_score DESC
  LIMIT 6

Backfill with trending introductions if fewer than 6 results.

If user has no prior engagement, show trending introductions with prompt:
"Follow topics or council members to get personalized recommendations."

// TODO: v2 — incorporate interest tags and followed users' activity
```

---

## Phase 9 — Following Page + Calendar Section

**Prompt:**
```
Expand src/app/(auth)/following/page.tsx (created in Phase 3c) with a calendar section.

--- SECTION 1: UPCOMING ---
Heading: "Upcoming"

Query:
  SELECT e.*, l.file_number, l.short_summary, l.slug, l.title
  FROM events e
  JOIN legislation l ON l.id = e.legislation_id
  JOIN legislation_follows lf ON lf.legislation_id = e.legislation_id
  WHERE lf.user_id = $userId
  AND e.event_date >= CURRENT_DATE
  ORDER BY e.event_date ASC
  LIMIT 20

Display as chronological list grouped by date.
Date heading format: "Tuesday, April 8"
Each event:
- Event type badge (Hearing = blue, Vote = amber)
- Bill: file number + short_summary (or truncated title), linked to /legislation/[slug]
- Time and location if available

Empty state: "No upcoming hearings or votes for bills you follow."

--- SECTION 2: BILLS YOU FOLLOW ---
Heading: "Bills You Follow"
Grid of LegislationCard components from legislation_follows.
Same query as Phase 3c, pass initialFollowing={true}.

--- LAYOUT ---
Both sections stacked vertically on same page. No tabs needed.
```

---

## Phase 10 — Legislation Page: Social Context + Comments Check

**Prompt:**
```
Add follower context to src/app/(public)/legislation/[slug]/page.tsx.

--- FOLLOWER COUNT ---
Below the tally cards, add a social context line:

All users: "X following"  (legislation_stats.watching_count)

Logged-in users additionally: "· Y people you follow"
  Query:
  SELECT COUNT(*) FROM legislation_follows lf
  JOIN user_follows uf ON lf.user_id = uf.following_id
  WHERE lf.legislation_id = $legislationId
  AND uf.follower_id = $currentUserId

Style as muted slate-400 text: "142 following · 3 people you follow"

If Y > 0, show a tooltip or small popover listing up to 5 names/avatars
when hovering or clicking "Y people you follow".

--- VERIFY COMMENTS ---
Check that the following work and fix anything broken:
1. Comments visible to logged-out users (read-only)
2. Logged-out users see "Sign in to leave a comment" prompt
3. Sort toggle (Latest / Most Engaged) functions correctly
4. Replies display indented under parent comments
5. Upvote/downvote buttons show and update vote score

Do not refactor working code — only fix what is broken.
```

---

## Phase 11a — Auth: Google Sign-In

**Prompt:**
```
Fix Google OAuth sign-in.

PREREQUISITE CHECKLIST (complete in external dashboards before running this prompt):
□ Google Cloud Console: Create or confirm OAuth 2.0 credentials
□ Google Cloud Console: Add authorized redirect URI:
  https://[your-supabase-project-ref].supabase.co/auth/v1/callback
□ Supabase Dashboard → Authentication → Providers → Google:
  Enable Google, enter Client ID and Client Secret
□ Supabase Dashboard → Authentication → URL Configuration:
  Add production domain to Redirect URLs:
  https://legislative-tracker.com/auth/callback

Code checks:
1. Read src/app/(auth)/login/page.tsx — verify Google button calls:
   supabase.auth.signInWithOAuth({
     provider: 'google',
     options: { redirectTo: `${window.location.origin}/auth/callback?next=${next}` }
   })
   The redirectTo must match what's in Supabase URL Configuration exactly.

2. Read src/app/auth/callback/route.ts — verify it:
   - Calls supabase.auth.exchangeCodeForSession(code)
   - Creates a user_profiles row for new Google sign-ups if one doesn't exist
   - Redirects new users to /onboarding, returning users to the `next` param

3. Fix any mismatches. Add a comment in the callback route documenting the
   expected OAuth flow.
```

---

## Phase 11b — Auth: White Label Magic Link Email

**Prompt:**
```
Configure magic link email to send from noreply@legislative-tracker.com.

PREREQUISITE CHECKLIST (external steps — must be done before code changes):
□ Set up email sending for legislative-tracker.com
  (recommended providers: Resend, SendGrid, Postmark, or AWS SES)
□ Verify legislative-tracker.com domain with your email provider
□ Get SMTP credentials (host, port, username, password)
□ Supabase Dashboard → Project Settings → Auth → SMTP Settings:
  - Enable Custom SMTP
  - Host, Port, Username, Password from email provider
  - Sender email: noreply@legislative-tracker.com
  - Sender name: Legislative Tracker
□ Supabase Dashboard → Authentication → Email Templates:
  Update Magic Link template with app branding

Code changes:
1. Search codebase for any hardcoded Supabase email references and update
   to noreply@legislative-tracker.com
2. In src/app/(auth)/login/page.tsx, update the post-send confirmation message:
   "Check your email — we sent a sign-in link from noreply@legislative-tracker.com"
3. Add a comment above signInWithOtp documenting the SMTP configuration required.
```

---

## Phase 12a — Admin: Skip Already-Synced Sponsorships

**Prompt:**
```
Update sponsorship sync to skip legislation that already has sponsorships.

In src/lib/legistar/sync.ts (syncSponsorships or equivalent):
- Before the batch API call, fetch all legislation_ids already in sponsorships:
  SELECT DISTINCT legislation_id FROM sponsorships
- Filter the current batch to only include IDs NOT in that set
- Add a 'skipped' counter to the return value

In src/app/actions/admin.ts (runSyncSponsorships):
- Pass through the skipped count in returned stats

In src/app/(admin)/admin/sync/page.tsx (SponsorshipsCard):
- Show "Skipped: X (already synced)" in the log

Also verify the Stop button works:
- The "Run All" loop's stop flag should be a useRef (not useState) so it's
  read synchronously between batches
- Confirm Stop button sets ref.current = true and the loop checks it before
  each iteration
```

---

## Phase 12b — Terms & Conditions

**Prompt:**
```
Add a Terms & Conditions page and acceptance gate.

--- STATIC PAGE ---
Create src/app/(public)/terms/page.tsx with placeholder T&C content:
1. Acceptance of Terms
2. Description of Service
3. User Accounts and Responsibilities
4. User-Generated Content
5. Privacy and Data
6. Disclaimers and Limitations
7. Changes to Terms
8. Contact

Style: dark theme, max-w-3xl centered, prose formatting consistent with app.

--- ACCEPTANCE PAGE ---
Create src/app/(auth)/terms/accept/page.tsx:
- Shows T&C summary with "Read full terms" link to /terms
- Checkbox: "I have read and agree to the Terms & Conditions"
- "Continue" button (disabled until checkbox checked)
- On submit, call acceptTerms() server action:
  UPDATE user_profiles SET terms_accepted_at = NOW() WHERE id = $userId
  Then redirect to `next` query param or / if none.

--- MIDDLEWARE GATE ---
In middleware.ts, after confirming authentication:
- Set a cookie 'terms_accepted=true' when user accepts (avoids a DB call on
  every request — check cookie instead of DB in middleware)
- If cookie is absent and route is protected, redirect to /terms/accept?next=[path]
- Exclude from check: /terms/accept, /terms, /auth/callback, /api/*, public routes

--- FOOTER LINK ---
In src/components/layout/Footer.tsx, add "Terms & Conditions" link to /terms.
```
