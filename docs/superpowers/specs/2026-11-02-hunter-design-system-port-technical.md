# Hunter design system port — technical doc

Companion to `2026-11-02-hunter-design-system-port-plan.md`. Covers
file-level impact, data flow, and component design for each in-scope item.

## 1. Sidebar redesign

**Files:** `dashboard/src/components/DashboardSidebar.tsx`,
`dashboard/src/components/DashboardLayout.tsx`, `dashboard/src/index.css`
(`.app-sidebar*` block, ~L899-929 — replace with the mockup's
`body.app .sidebar` block, hunter.css L863-934).

**New markup inside `<DashboardSidebar>`:**

- Brand (unchanged).
- Search box (`sb-search`): `<input>` that, on submit (Enter), navigates to
  `/jobs?q=<value>` via `useNavigate`. A `/` keydown listener (ignored while
  focused in an input/textarea) focuses the search input, matching the
  mockup's `<kbd>/</kbd>` hint.
- Nav list (unchanged items/icons), but the Applications link gets a badge:
  count of applications whose latest run status is `ready_for_approval`.
  Fetch via existing `GET /applications` list endpoint (same one
  `Applications.tsx` uses) on mount; this is a new fetch specific to the
  sidebar since it now renders on every app page, not just one.
- "Shortcuts" section: "Saved jobs" (`/jobs?saved=1` — count from
  `useSavedJobs()`, already a hook) and "Government jobs" (`/jobs?category=government`).
- "Next action" widget: shown only when the ready-for-approval count > 0;
  copy: `Review N generated cover letters`, links to `/applications`.
- User card: avatar/initials (existing `initialsFromEmail`), `resume.fullName
  ?? email`, profile completeness % (reuse the same calculation Dashboard.tsx
  does — `countFilledProfileFields` / `PROFILE_COMPLETENESS_FIELD_COUNT` —
  move that helper to a shared location, e.g.
  `dashboard/src/lib/profileCompleteness.ts`, and import it from both
  `Dashboard.tsx` and `DashboardSidebar.tsx` rather than duplicating it),
  theme toggle (existing `ThemeToggle`).

**Data fetching:** `DashboardSidebar` becomes a small data-fetching
component — on mount, `GET /profile` and `GET /applications`. This is new
(previously only `Dashboard.tsx` fetched these); acceptable duplication
since the sidebar is now persistent across 4 pages and those pages already
separately fetch the same data for their own needs — no shared cache layer
exists in this app and introducing one is out of scope here.

**Mobile:** replace `.app-sidebar-topbar` (horizontal link row) with the
mockup's `.mobile-tabs` (icon + label bottom tab bar), shown `<900px`,
mirroring the five sidebar nav links only (no search/shortcuts/next-action
on mobile, matching the mockup).

## 2. Apply-drawer rebuild

> **Amendment (mid-execution):** this section originally called for
> removing the automation-run/approve/submit UI entirely. The user later
> asked for both the automated pipeline and the new manual flow to stay
> available, switchable via tabs in the drawer — see the implementation
> plan's Task 5 (amended) for the current, authoritative design. The
> automation functions/state described as "removed" below were restored.

**File:** `dashboard/src/pages/JobDetail.tsx` (drawer JSX ~L359-461, state
~L42-121).

**State changes:**
- Drop `appState`'s automation-specific fields usage in the drawer render
  (`latestRun`, `approveRun`, `submitRun`, `runAutomation` stay as functions
  only if still used elsewhere — they're not, so delete them along with
  their buttons).
- Keep `startApplication`, but call it automatically from `openDrawer()`
  when `refreshApplication()` resolves to `phase: 'none'` — no user-facing
  button. This preserves the `Application` draft record so the Applications
  page keeps a row for this job.
- Keep `generateMaterials` / `materialsPreview` (cover letter), called
  automatically alongside the auto-start (or lazily on drawer open — either
  is fine, auto-call is simpler and matches "no direct apply system," since
  nothing is submitted, just drafted).
- New: `missingSkills` = `job.extractedRequirements.requiredSkills.filter(s
  => !flatProfileSkills.has(s.toLowerCase()))` where `flatProfileSkills` is
  built from `profile.resume.skillGroups.flatMap(g => g.skills)` (note: this
  replaces the current `matchedSkills` logic at JobDetail.tsx:218-222, which
  checks against `profile.cvText` raw text — switch to checking against
  `resume.skillGroups` since that's the data the PDF export actually reads,
  and it's the thing "Add" will mutate).
- New: `addSkill(skill: string)` — `PUT /profile` with
  `resume.skillGroups` updated by appending `skill` to a group whose
  `category === 'Additional skills'` (create that group if it doesn't exist
  yet), then update local `profile` state from the response so the UI
  re-renders with that skill removed from `missingSkills`. One skill added
  per click, so no batch logic needed.
- New: "Download CV" button — plain `<a href={`${API_BASE}/profile/cv/export`}>`
  (or a fetch-and-blob-download, matching whatever pattern
  `Profile.tsx:464-473` already uses for the same endpoint — reuse that
  exact function rather than reimplementing).
- New: copy-to-clipboard button next to the cover letter preview —
  `navigator.clipboard.writeText(materialsPreview)`, brief "Copied" state
  swap (mirrors `hunter.js` L140-145's pattern, matching `.btn` style with
  an icon swap, no need for the fallback `execCommand` path hunter.js uses
  since the app only needs to support current browsers).

**Removed:** `runAutomation`, `approveRun`, `submitRun` functions and their
buttons/status branches in the drawer. The `/automation/*` API routes
themselves are untouched — they remain in use by `Applications.tsx`.

**Drawer layout (new):**
```
Apply to {company}                                    [x]
──────────────────────────────────────────────────────
Cover letter (draft)                         [Copy]
<letter text>

Missing skills for this role
[Add] React Native     [Add] GraphQL     ...
(skills disappear from this list as you Add them)

──────────────────────────────────────────────────────
[Download tailored CV (PDF)]
```

## 3. Landing page additions

**File:** `dashboard/src/pages/Landing.tsx`. Insert four new `<section
className="band">` blocks using existing CSS classes (`.recheck-card`,
`.track-strip`, `.showcase`/`.cvdemo`, `.duo`/`.tilex` — all already defined
in `index.css`), positioned per the mockup's section order in `index.html`.
Copy should describe the real product (verification pipeline, application
tracking, CV parsing, remote/Bangladesh job split) — do not port the
mockup's score-formula or fake stats verbatim; reuse real copy patterns
already established elsewhere on the page (e.g. how the existing hero/stats
section describes the pipeline).

## 4. Job detail polish

**File:** `dashboard/src/pages/JobDetail.tsx`, `aside.evidence` area and
below `.prose`. Add:
- Related-roles grid (`.related` + `.jobcard` grid) — fetch via existing
  `GET /jobs` with the job's own extracted skills/category as a filter,
  limit ~3, excluding the current job.
- Compensation/visa `.ev-kv` card — from fields already on `Job`
  (`salaryMin`/`salaryMax`, `job.extractedRequirements` if it carries a visa
  flag; if it doesn't, show salary only and drop the visa row rather than
  inventing data).
- `.src-link` card — `job.sourceId` + `job.normalizedUrl`, "via {source}"
  (source label already derived in `Jobs.tsx`'s `src` rendering — reuse that
  mapping rather than redefining it).

## 5. Jobs page filter restyle

**File:** `dashboard/src/pages/Jobs.tsx`, plus `dashboard/src/index.css`
(scoped overrides under a new block, e.g. `/* jobs filter rail — shadcn
skin */`) or local `className` additions on the shadcn `Accordion`/
`Checkbox`/`Drawer` instances. No prop/logic changes — purely swapping
visual treatment to match `.filter-chip`/`.check`/`.range` from hunter.css.
Verify the mobile `Drawer` breakpoint still matches `.filter-rail`'s
`max-width:980px` cutover.

## 6. Misc polish

- **Saved-jobs toast:** `useSavedJobs` hook (wherever its toggle function
  lives) — on toggle, show a brief toast ("Saved" / "Removed"). If no toast
  primitive exists yet in the app, add a minimal one (a fixed-position div
  with the existing `.toast` CSS class from hunter.css, shown via local
  state + timeout — no new library).
- **Escape closes drawer:** `JobDetail.tsx` — add a `keydown` listener for
  `Escape` while `drawerOpen`, calling `setDrawerOpen(false)`.
- **Score animate-in:** `ScoreRing`/`.bar-fill` — IntersectionObserver that
  adds a class triggering the existing CSS transition, mirroring
  `hunter.js`'s `.score-card` reveal pattern. Cosmetic-only, do last.

## Testing / verification plan

- `npm run typecheck` (dashboard) after each file group.
- Manual browser pass per page (dev server + claude-in-chrome) covering:
  sidebar on all 4 authenticated pages (badges, next-action, search-by-`/`),
  apply-drawer end-to-end (open → cover letter copy → add a missing skill →
  confirm it disappears from the list and appears on `/profile` → download
  CV → confirm the Applications page still shows the draft row), landing
  page new sections render with real data, jobs filter rail visually
  matches with filtering still functioning, job-detail polish renders for a
  job with/without salary data.
- No backend tests need touching — no API contract changes.
