# Hunter Design System Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the concrete gap list between the dashboard app and the `hunter-design-preview` mockup — a richer shared sidebar, a rebuilt apply drawer offering both the existing automated apply pipeline and a new self-serve manual flow (switchable via tabs), four missing landing sections, job-detail polish, a visual filter-rail restyle, and small save/close/animate polish — without touching backend contracts or the Applications page's own automation UI.

> **Amendment (mid-execution, after Task 4 landed):** the original plan replaced the automation-run/approve/submit UI in the job-detail drawer entirely with the manual flow. The user redirected: both flows should be available, switchable via tabs. Task 4 (which deleted the automation state/functions) was already implemented and reviewed clean against its own original brief — not reverted. Task 5 below is rewritten to reinstate the deleted automation pieces alongside the new manual flow. See the ledger's `Ruling:` entry for the full record.

**Architecture:** This is almost entirely a frontend-only change inside `dashboard/src/`. Every CSS class the mockup needs either already exists verbatim in `dashboard/src/index.css`, or is added following that file's existing naming convention (explicit classes like `.app-sidebar-*`, not mockup's descendant-selector convention like `.app .sidebar .sb-nav`). No new backend endpoints — the one functional change (the apply-drawer rebuild) reuses `PUT /profile` and `GET /profile/cv/export`, both already implemented.

**Tech Stack:** React 18 + TypeScript + React Router + Vite, hand-rolled CSS (`index.css`, no CSS modules/Tailwind-in-CSS beyond the few Tailwind utility classes already used on shadcn primitives in `Jobs.tsx`), shadcn/base-ui `Accordion`/`Checkbox`/`Drawer` primitives, `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-11-02-hunter-design-system-port-plan.md` and its technical companion `docs/superpowers/specs/2026-11-02-hunter-design-system-port-technical.md`.

## Global Constraints

- The `dashboard` package has **no test runner configured** (no vitest/jest, `package.json` scripts are only `dev`/`build`/`typecheck`). Every task's verification step is therefore `npm run typecheck` (from `dashboard/`) plus a manual browser check via `npm run dev` — the same pattern already used earlier in this session for the sidebar float-styling change. Do not introduce a test framework as part of this plan — out of scope.
- CSS variable names follow this project's existing tokens (`--card-radius-sm/md/lg`, `--muted-text`, `--surface`, `--line`, etc. — see `index.css:35-106`), **not** the mockup's token names (`--radius-lg`, `--muted`). Never copy a mockup CSS rule verbatim without translating its variable names.
- No new backend routes, no changes under `api/`. If a task seems to need one, stop and flag it — don't invent one.
- `Application.status` is `'draft' | 'ready' | 'submitted' | 'failed'` (see `shared/src/schemas/*.ts` usage in `dashboard/src/pages/Applications.tsx:22-27`) — **not** `'ready_for_approval'`. The technical spec doc uses the informal name "ready for approval" for the `'ready'` status; use the real enum value `'ready'` in all code.
- Commit after each task, not after each step, using this repo's plain conventional-ish style (see `git log`, e.g. `feat(dashboard): ...`). Do not push.

---

### Task 1: Extract shared profile-completeness helper

**Files:**
- Create: `dashboard/src/lib/profileCompleteness.ts`
- Modify: `dashboard/src/pages/Dashboard.tsx:27-46`

**Interfaces:**
- Produces: `profileCompletenessPercent(profile: Profile): number` — used by Task 2 (sidebar user card).

- [ ] **Step 1: Create the shared helper**

Create `dashboard/src/lib/profileCompleteness.ts`:

```ts
import type { Profile } from '@job-hunter/shared'

// The Profile schema has 7 user-editable fields, but preferences.remoteOnly is a boolean
// with a default — it always holds a meaningful value, so it can never be "incomplete"
// and isn't counted toward the completeness score. That leaves 6 fields that can be empty.
const PROFILE_COMPLETENESS_FIELD_COUNT = 6

function countFilledProfileFields(profile: Profile): number {
  const checks = [
    profile.eligibility.workAuthorization !== 'unknown',
    profile.eligibility.countries.length > 0,
    profile.preferences.targetRoles.length > 0,
    profile.preferences.minSalaryUsd != null,
    profile.preferences.locations.length > 0,
    Boolean(profile.cvText?.trim()),
  ]
  return checks.filter(Boolean).length
}

export function profileCompletenessPercent(profile: Profile): number {
  return Math.round((countFilledProfileFields(profile) / PROFILE_COMPLETENESS_FIELD_COUNT) * 100)
}
```

- [ ] **Step 2: Remove the duplicated definitions from Dashboard.tsx and import the helper**

In `dashboard/src/pages/Dashboard.tsx`, delete lines 27-46 (the
`PROFILE_COMPLETENESS_FIELD_COUNT` constant, `countFilledProfileFields`, and
`profileCompletenessPercent` function), and add the import:

```ts
import { profileCompletenessPercent } from '../lib/profileCompleteness'
```

Leave every call site of `profileCompletenessPercent(...)` elsewhere in
`Dashboard.tsx` unchanged — only the definition moves.

- [ ] **Step 3: Verify**

Run: `cd dashboard && npm run typecheck`
Expected: no errors (confirms no other file referenced the now-deleted
`countFilledProfileFields`/`PROFILE_COMPLETENESS_FIELD_COUNT` symbols
directly).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/profileCompleteness.ts dashboard/src/pages/Dashboard.tsx
git commit -m "refactor(dashboard): extract profile-completeness helper for reuse in sidebar"
```

---

### Task 2: Rebuild DashboardSidebar — search, badges, shortcuts, next-action, user card

**Files:**
- Modify: `dashboard/src/components/DashboardSidebar.tsx` (full rewrite of `DashboardSidebar`, leave `DashboardSidebarTopBar` for Task 3)
- Modify: `dashboard/src/index.css:899-918` (replace `.app-sidebar` block with the richer version)

**Interfaces:**
- Consumes: `profileCompletenessPercent(profile: Profile)` from Task 1; `useSavedJobs()` (`{ savedIds }`) from `dashboard/src/hooks/useSavedJobs.ts`; `apiFetch` from `dashboard/src/api/client.ts`; `Profile`/`Application` types from `@job-hunter/shared`.
- Produces: no new exports consumed elsewhere — `DashboardSidebar` stays a self-contained component used only by `DashboardLayout.tsx`.

- [ ] **Step 1: Add the new CSS**

In `dashboard/src/index.css`, replace the block from `.app-sidebar{` (line
900) through `.app-sidebar-foot{...}` (lines 914-917) — i.e. everything
between `/* ---------- dashboard sidebar shell ---------- */` and the
`.app-main{` rule — with:

```css
.app-sidebar{
  position:fixed;top:16px;left:16px;bottom:16px;width:272px;z-index:40;
  display:flex;flex-direction:column;
  padding:22px 16px 16px;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--card-radius-lg);
  box-shadow:var(--shadow-card);overflow:hidden;
}
.app-sidebar-brand{padding:4px 10px 0;margin-bottom:0;}
.app-sidebar-search{
  margin:22px 4px 10px;display:flex;align-items:center;gap:10px;
  background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:10px 14px;
  color:var(--muted-text);font-size:13.5px;
}
.app-sidebar-search svg{flex:none;width:15px;height:15px;}
.app-sidebar-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:var(--font-body);font-size:13.5px;color:var(--fg);}
.app-sidebar-search input::placeholder{color:var(--faint);}
.app-sidebar-search kbd{margin-left:auto;font-family:var(--font-mono);font-size:10.5px;background:var(--surface-2);padding:2px 6px;border-radius:6px;color:var(--faint);}
.app-sidebar-nav{display:flex;flex-direction:column;gap:2px;margin-top:10px;}
.app-sidebar-link{
  display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:999px;
  font-size:14px;font-weight:500;color:var(--muted-text);transition:background .15s,color .15s;
}
.app-sidebar-link svg{flex:none;}
.app-sidebar-link:hover{color:var(--fg);background:var(--surface-2);}
.app-sidebar-link.current{color:var(--fg);background:var(--fg);color:#fff;font-weight:600;}
.app-sidebar-link .badge{margin-left:auto;font-family:var(--font-mono);font-size:11px;background:var(--indigo-soft);color:var(--indigo);padding:2px 8px;border-radius:999px;}
.app-sidebar-link.current .badge{background:rgba(255,255,255,.2);color:#fff;}
.app-sidebar-section-label{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding:18px 14px 6px;}
.app-sidebar-next{
  margin-top:auto;background:var(--indigo);color:#fff;border-radius:22px 22px 22px 8px;
  padding:16px 16px 14px;position:relative;overflow:hidden;
}
.app-sidebar-next .k{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.8;}
.app-sidebar-next b{display:block;font-family:var(--font-display);font-size:15px;line-height:1.25;margin-top:6px;font-weight:600;}
.app-sidebar-next a{display:inline-flex;margin-top:12px;background:#fff;color:var(--indigo-deep);font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:999px;}
.app-sidebar-foot{
  display:flex;align-items:center;gap:10px;
  margin-top:14px;padding-top:14px;border-top:1px solid var(--line);
}
.app-sidebar-foot .who{min-width:0;flex:1;}
.app-sidebar-foot .who b{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.app-sidebar-foot .who span{font-size:11.5px;color:var(--muted-text);}
```

This keeps the floating/inset styling from the earlier change in this
session (top/left/bottom 16px, rounded, shadowed) and adds the search box,
nav badge, "Shortcuts" label, "Next action" widget, and a two-line user
card footer, all under this project's existing `.app-sidebar-*` naming
rather than the mockup's `.app .sidebar .sb-*` descendant-selector
convention.

- [ ] **Step 2: Update `.app-main` margin to match the unchanged 272px width**

Directly below the block just edited, confirm/update the `.app-main` rule
(previously `margin-left:288px` from the earlier floating-sidebar change,
computed as 256px width + 16px + 16px gaps) to match the new 272px sidebar
width:

```css
.app-main{flex:1;min-width:0;margin-left:304px;padding:0 max(20px, env(safe-area-inset-right,0px)) 48px;}
```

(272 + 16 + 16 = 304.)

- [ ] **Step 3: Rewrite `DashboardSidebar` in `dashboard/src/components/DashboardSidebar.tsx`**

Replace the whole file's `DashboardSidebar` function (lines 36-63) — keep
`BrandMark`, `sidebarLinkClass`, `SIDEBAR_LINKS`, `initialsFromEmail`, and
`DashboardSidebarTopBar` as they are for now (Task 3 touches
`DashboardSidebarTopBar`). Add new imports and state:

```tsx
import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Briefcase, ClipboardList, FileText, LayoutDashboard, Search, User } from 'lucide-react'
import type { Application, Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useSavedJobs } from '../hooks/useSavedJobs'
import { profileCompletenessPercent } from '../lib/profileCompleteness'
import { ThemeToggle } from './ThemeToggle'
```

(`Search` added to the existing `lucide-react` import; the rest of the
imports already present in the file stay.)

Replace the `export function DashboardSidebar() { ... }` block with:

```tsx
export function DashboardSidebar() {
  const { email, logout } = useAuth()
  const { savedIds } = useSavedJobs()
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchValue, setSearchValue] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [applications, setApplications] = useState<Application[]>([])

  useEffect(() => {
    apiFetch('/profile')
      .then((res) => (res.ok ? (res.json() as Promise<Profile>) : null))
      .then(setProfile)
      .catch(() => setProfile(null))
    apiFetch('/applications')
      .then((res) => (res.ok ? res.json() : { applications: [] }))
      .then((body: { applications: Application[] }) => setApplications(body.applications))
      .catch(() => setApplications([]))
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return
      const active = document.activeElement
      const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      if (isTyping) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = searchValue.trim()
    navigate(trimmed ? `/jobs?q=${encodeURIComponent(trimmed)}` : '/jobs')
  }

  const readyCount = applications.filter((application) => application.status === 'ready').length

  return (
    <nav className="app-sidebar">
      <NavLink to="/" className="brand app-sidebar-brand">
        <BrandMark />
        Hunter
      </NavLink>

      <form className="app-sidebar-search" onSubmit={submitSearch}>
        <Search size={15} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search jobs, companies"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
        />
        <kbd>/</kbd>
      </form>

      <div className="app-sidebar-nav">
        {SIDEBAR_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={sidebarLinkClass}>
            <Icon size={18} />
            {label}
            {to === '/applications' && readyCount > 0 && <span className="badge">{readyCount}</span>}
          </NavLink>
        ))}

        <div className="app-sidebar-section-label">Shortcuts</div>
        <NavLink to="/jobs?saved=1" className="app-sidebar-link">
          <Briefcase size={18} />
          Saved jobs
          {savedIds.length > 0 && <span className="badge">{savedIds.length}</span>}
        </NavLink>
        <NavLink to="/jobs?category=government" className="app-sidebar-link">
          <ClipboardList size={18} />
          Government jobs
        </NavLink>
      </div>

      {readyCount > 0 && (
        <div className="app-sidebar-next">
          <div className="k">Next action</div>
          <b>
            Review {readyCount} generated cover letter{readyCount === 1 ? '' : 's'}
          </b>
          <NavLink to="/applications">Review now →</NavLink>
        </div>
      )}

      <div className="app-sidebar-foot">
        <button type="button" className="avatar" title={email ?? 'Account'} aria-label="Log out" onClick={logout}>
          {initialsFromEmail(email)}
        </button>
        <div className="who">
          <b>{profile?.resume?.fullName ?? email ?? 'Account'}</b>
          <span>Profile {profile ? profileCompletenessPercent(profile) : 0}% complete</span>
        </div>
        <ThemeToggle />
      </div>
    </nav>
  )
}
```

Note: `Briefcase` and `ClipboardList` are reused from the existing
`SIDEBAR_LINKS` icon set purely for the two shortcut rows (no new icon
imports needed beyond `Search`, which lucide-react already exports).
`FileText`, `LayoutDashboard`, `User` stay imported because `SIDEBAR_LINKS`
still uses them.

- [ ] **Step 4: Verify types**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual browser verification**

Run: `cd dashboard && npm run dev`, open `/dashboard` (log in first if
needed). Confirm:
- Sidebar floats with 16px inset, rounded corners, shadow.
- Search box accepts text; pressing Enter navigates to `/jobs?q=...` with
  that query reflected in the Jobs page keyword field.
- Pressing `/` anywhere outside a text field focuses the search box.
- "Shortcuts" shows "Saved jobs" with a badge matching the count from
  `useSavedJobs()` (save a job on `/jobs` first to see it update — note:
  due to the `storage` event listener in the hook, you may need to
  re-navigate to `/dashboard` to see the count refresh since this toggle
  happens in a different component instance).
- If you have at least one application with status `ready`, the
  Applications nav link shows a numeric badge and the "Next action" widget
  appears with matching copy and a working "Review now →" link.
- User card shows your initials, name-or-email, and a completeness
  percentage matching what `/profile` page's own ring shows.
- Same sidebar renders identically on `/applications`, `/profile`, `/cv`
  (via the shared `DashboardLayout`).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/DashboardSidebar.tsx dashboard/src/index.css
git commit -m "feat(dashboard): rebuild sidebar with search, shortcuts, next-action widget, user card"
```

---

### Task 3: Mobile tab bar replacing the horizontal topbar

**Files:**
- Modify: `dashboard/src/components/DashboardSidebar.tsx` (rewrite `DashboardSidebarTopBar`)
- Modify: `dashboard/src/index.css:919-929` (replace `.app-sidebar-topbar` rules with `.app-mobile-tabs`)

**Interfaces:**
- Consumes: `SIDEBAR_LINKS`, `sidebarLinkClass` already defined in the same file.

- [ ] **Step 1: Replace the mobile CSS block**

In `dashboard/src/index.css`, replace the current:

```css
.app-sidebar-topbar{display:none;}
@media (max-width:900px){
  .app-sidebar{display:none;}
  .app-main{margin-left:0;}
  .app-sidebar-topbar{display:block;}
  .app-sidebar-topbar .nav-links{display:flex;overflow-x:auto;}
}
@media (max-width:560px){
  .app-sidebar-topbar .nav-links{gap:2px;}
  .app-sidebar-topbar a{padding:8px 10px;white-space:nowrap;}
}
```

with:

```css
.app-mobile-tabs{display:none;}
@media (max-width:900px){
  .app-sidebar{display:none;}
  .app-main{margin-left:0;padding-bottom:96px;}
  .app-mobile-tabs{
    display:flex;position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));
    z-index:50;background:var(--surface);border:1px solid var(--line);border-radius:999px;
    padding:6px;box-shadow:var(--shadow-hover);gap:2px;
  }
  .app-mobile-tabs a{
    flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;
    border-radius:999px;font-size:10.5px;font-weight:600;color:var(--muted-text);
  }
  .app-mobile-tabs a.current{background:var(--fg);color:var(--bg);}
}
```

- [ ] **Step 2: Rewrite `DashboardSidebarTopBar`**

Replace the `export function DashboardSidebarTopBar() { ... }` block
(lines 65-91 of the original file) with:

```tsx
export function DashboardSidebarTopBar() {
  return (
    <nav className="app-mobile-tabs" aria-label="Main">
      {SIDEBAR_LINKS.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={sidebarLinkClass}>
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
```

This drops the brand/theme-toggle/avatar row the old horizontal topbar had
— those now only live in the desktop sidebar's user card, matching the
mockup (the mockup's `.mobile-tabs` is icon-only, no brand/avatar).

- [ ] **Step 3: Verify types**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual browser verification**

In the running dev server, resize the browser below 900px width on
`/dashboard`. Confirm: desktop sidebar disappears, a floating pill-shaped
bottom tab bar with 5 icon+label tabs appears, current route is
highlighted, main content no longer has the 304px left margin and has
enough bottom padding that content isn't hidden behind the tab bar.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/DashboardSidebar.tsx dashboard/src/index.css
git commit -m "feat(dashboard): replace horizontal mobile topbar with floating icon tab bar"
```

---

### Task 4: JobDetail — switch skill-matching to resume.skillGroups and remove automation UI

**Files:**
- Modify: `dashboard/src/pages/JobDetail.tsx`

**Interfaces:**
- Produces: `missingSkills: string[]` and `flatProfileSkills: Set<string>` local to the component, consumed by Task 5's "Add" button and the required-skills pill list.

- [ ] **Step 1: Replace the `matchedSkills` calculation**

In `dashboard/src/pages/JobDetail.tsx`, replace lines 218-222:

```tsx
  const matchedSkills = new Set(
    (job.extractedRequirements?.requiredSkills ?? []).filter((skill) =>
      profile?.cvText ? profile.cvText.toLowerCase().includes(skill.toLowerCase()) : false
    )
  )
```

with:

```tsx
  const flatProfileSkills = new Set(
    (profile?.resume?.skillGroups ?? []).flatMap((group) => group.skills.map((skill) => skill.toLowerCase())),
  )
  const matchedSkills = new Set(
    (job.extractedRequirements?.requiredSkills ?? []).filter((skill) => flatProfileSkills.has(skill.toLowerCase())),
  )
  const missingSkills = (job.extractedRequirements?.requiredSkills ?? []).filter(
    (skill) => !flatProfileSkills.has(skill.toLowerCase()),
  )
```

`matchedSkills` is kept as-is (still drives the `pill hit` styling in the
"Required skills" list further down the component, unchanged) — only its
source data changes, from raw CV text to the structured resume skill
groups.

- [ ] **Step 2: Remove the automation state fields, functions, and `ApplicationState` fields that are no longer used**

Replace the `ApplicationState` type (lines 42-50):

```tsx
type ApplicationState =
  | { phase: 'none' }
  | { phase: 'loading' }
  | {
      phase: 'loaded'
      application: { jobId: string; status: string; requiredAnswers: Array<{ answer: string | null }> }
      latestRun: { runNumber: number; status: string; blockReason: string | null; manualApplyUrl: string | null } | null
    }
  | { phase: 'error'; message: string }
```

with:

```tsx
type ApplicationState =
  | { phase: 'none' }
  | { phase: 'loading' }
  | { phase: 'loaded'; application: { jobId: string; status: string } }
  | { phase: 'error'; message: string }
```

Delete the `runAutomation`, `approveRun`, and `submitRun` functions
entirely (lines 145-194 of the original file).

In `refreshApplication` (lines 79-96), the `setAppState` call for the
success branch currently does `setAppState({ phase: 'loaded', application: body.application, latestRun: body.latestRun })` — change it to drop `latestRun`:

```tsx
        setAppState({ phase: 'loaded', application: body.application })
```

- [ ] **Step 3: Auto-start the application draft and auto-generate materials on drawer open**

Replace `openDrawer` (lines 98-101):

```tsx
  function openDrawer() {
    setDrawerOpen(true)
    refreshApplication()
  }
```

with a version that, after `refreshApplication` resolves to `'none'`,
calls `startApplication()` automatically (no user-visible button), then
generates materials once an application exists:

```tsx
  function openDrawer() {
    setDrawerOpen(true)
    if (!jobId) return
    setAppState({ phase: 'loading' })
    apiFetch(`/applications/${jobId}`)
      .then(async (res) => {
        if (res.status === 404) {
          await startApplication()
          return
        }
        if (!res.ok) {
          setAppState({ phase: 'error', message: 'Failed to load application status.' })
          return
        }
        const body = await res.json()
        setAppState({ phase: 'loaded', application: body.application })
        if (!materialsPreview) await generateMaterials()
      })
      .catch(() => setAppState({ phase: 'error', message: 'Failed to load application status.' }))
  }
```

`startApplication` (lines 103-121) stays as-is for now except its final
`refreshApplication()` call should also trigger materials generation once
the draft exists — change the `finally` block's call from
`refreshApplication()` to:

```tsx
      refreshApplication()
      await generateMaterials()
```

(keep this inside the existing `try` block, right after the current
`refreshApplication()` call at line 117 — not inside `finally`, since
`generateMaterials` manages its own `actionBusy`/`actionError` state and
should only run once the application is confirmed created.)

- [ ] **Step 4: Verify types (expect remaining errors pointing at the drawer JSX — fixed in Task 5)**

Run: `cd dashboard && npm run typecheck`
Expected: errors in the `<div className={\`drawer...}>` JSX referencing
`appState.latestRun`, `approveRun`, `submitRun` — these are removed in
Task 5's rewrite of the drawer body. Confirm the errors are confined to
that JSX block and nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/JobDetail.tsx
git commit -m "refactor(jobdetail): match skills against resume.skillGroups, drop automation-run state"
```

(This task intentionally leaves typecheck red — the drawer JSX rewrite in
Task 5 fixes it. Commit anyway so the diff stays reviewable in small
pieces; Task 5 follows immediately.)

---

### Task 5: JobDetail — rebuild the apply drawer with both flows, tabbed

> **Amended after Task 4 landed** — originally this task replaced the
> automation UI entirely. The user asked for both the automated apply
> pipeline and the new manual flow to stay available, switchable via tabs.
> This version reinstates the `latestRun` state and the
> `runAutomation`/`approveRun`/`submitRun` functions Task 4 deleted (they
> are restored verbatim from the pre-Task-4 version of this file — see
> `git show 099f334:dashboard/src/pages/JobDetail.tsx` if you need to
> confirm exact original wording), and adds them back as an "Automated
> apply" tab alongside a new "Prepare manually" tab.

**Files:**
- Modify: `dashboard/src/pages/JobDetail.tsx` (restore automation state/functions, add tab state, `addSkill`/`copyCoverLetter`/`downloadCv` functions, rewrite drawer JSX)
- Modify: `dashboard/src/index.css` (add `.missing`/`.mrow`/`.copy-btn`/`.tab-row` block)

**Interfaces:**
- Consumes: `missingSkills`, `flatProfileSkills` from Task 4; `profile`/`setProfile` state already in the component; `apiFetch`.

- [ ] **Step 0: Reinstate the automation state and functions Task 4 removed**

In `dashboard/src/pages/JobDetail.tsx`, change the `ApplicationState` type's
`loaded` variant back to include `latestRun` (Task 4 left it as
`{ phase: 'loaded'; application: { jobId: string; status: string } }`):

```tsx
type ApplicationState =
  | { phase: 'none' }
  | { phase: 'loading' }
  | {
      phase: 'loaded'
      application: { jobId: string; status: string }
      latestRun: { runNumber: number; status: string; blockReason: string | null; manualApplyUrl: string | null } | null
    }
  | { phase: 'error'; message: string }
```

In `refreshApplication`, restore `latestRun` in the success branch's
`setAppState` call:

```tsx
        setAppState({ phase: 'loaded', application: body.application, latestRun: body.latestRun })
```

Add back the three deleted functions (place them where they were before,
alongside `generateMaterials`):

```tsx
  async function runAutomation() {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/automation/${jobId}/run`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(body?.error ?? 'Failed to run automation.')
        return
      }
      refreshApplication()
    } finally {
      setActionBusy(false)
    }
  }

  async function approveRun(runNumber: number) {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/applications/${jobId}/runs/${runNumber}/approve`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.approved) {
        setActionError(body?.reason ?? body?.error ?? 'Approval failed.')
        return
      }
      refreshApplication()
    } finally {
      setActionBusy(false)
    }
  }

  async function submitRun(runNumber: number) {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/automation/${jobId}/runs/${runNumber}/submit`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(body?.error ?? 'Submission failed.')
        return
      }
      refreshApplication()
    } finally {
      setActionBusy(false)
    }
  }
```

Run `cd dashboard && npm run typecheck` now — this step alone should bring
the error count down from Task 4's 15 expected errors to just the ones
caused by the still-unfixed drawer JSX referencing `addSkill`/tab state
that don't exist yet (none at this point — the drawer JSX still references
exactly what now exists again, so typecheck should actually be fully GREEN
after this step alone, before Steps 1-3 add the new manual-flow pieces).
Confirm it's green before continuing; if not, stop and report what's still
red.

- [ ] **Step 1: Add the missing-skills and tab-row CSS**

Append to `dashboard/src/index.css` (anywhere after the `/* ---------- job
details ---------- */` block, e.g. right after the existing `.doc-preview`
rules):

```css
.missing{display:flex;flex-direction:column;gap:8px;margin-top:4px;}
.mrow{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px;}
.mrow b{display:block;font-size:14px;}
.mrow .btn{padding:8px 14px;font-size:13px;}
.copy-btn{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--fg-2);padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);cursor:pointer;}
.copy-btn:hover{border-color:var(--line-strong);color:var(--fg);}
.copy-btn.ok{background:var(--cyan-soft);color:var(--cyan-text);border-color:transparent;}
.tab-row{display:flex;gap:8px;margin-bottom:4px;}
```

- [ ] **Step 2: Add tab state, `addSkill`, and a copy-state helper**

Add state near the existing `materialsPreview` state (line 61):

```tsx
  const [activeTab, setActiveTab] = useState<'manual' | 'automated'>('manual')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [skillBusy, setSkillBusy] = useState<string | null>(null)
```

Add the function (anywhere alongside the other action functions, e.g.
after `generateMaterials`):

```tsx
  async function addSkill(skill: string) {
    if (!profile) return
    setSkillBusy(skill)
    try {
      const skillGroups = profile.resume?.skillGroups ?? []
      const existingIndex = skillGroups.findIndex((group) => group.category === 'Additional skills')
      const nextSkillGroups =
        existingIndex === -1
          ? [...skillGroups, { category: 'Additional skills', skills: [skill] }]
          : skillGroups.map((group, index) =>
              index === existingIndex ? { ...group, skills: [...group.skills, skill] } : group,
            )
      const res = await apiFetch('/profile', {
        method: 'PUT',
        body: JSON.stringify({ resume: { ...profile.resume, skillGroups: nextSkillGroups } }),
      })
      if (!res.ok) {
        setActionError('Failed to add skill to your profile.')
        return
      }
      setProfile(await res.json())
    } finally {
      setSkillBusy(null)
    }
  }

  function copyCoverLetter() {
    if (!materialsPreview) return
    navigator.clipboard.writeText(materialsPreview).then(() => {
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 1600)
    })
  }

  async function downloadCv() {
    const res = await apiFetch('/profile/cv/export')
    if (!res.ok) {
      setActionError('Failed to generate CV.')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'cv.pdf'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }
```

(`downloadCv` mirrors `Profile.tsx:460-483`'s `handleGenerateCv` exactly —
same endpoint, same blob-download pattern — kept local to this component
rather than extracted into a shared helper, since it's two call sites
total and the existing codebase doesn't have a shared-helpers module for
this kind of thing yet; not worth introducing one for two call sites.)

- [ ] **Step 3: Rewrite the drawer body JSX with two tabs**

Replace the entire `{appState.phase === 'loaded' && ( ... )}` block inside
the drawer with:

```tsx
            {appState.phase === 'loaded' && (
              <>
                <div className="tab-row">
                  <button
                    type="button"
                    className={`btn ${activeTab === 'manual' ? 'btn-indigo' : 'btn-ghost'}`}
                    onClick={() => setActiveTab('manual')}
                  >
                    Prepare manually
                  </button>
                  <button
                    type="button"
                    className={`btn ${activeTab === 'automated' ? 'btn-indigo' : 'btn-ghost'}`}
                    onClick={() => setActiveTab('automated')}
                  >
                    Automated apply
                  </button>
                </div>

                {activeTab === 'manual' && (
                  <>
                    {materialsPreview && (
                      <div className="doc-preview">
                        <div className="dp-h">
                          <span>Cover letter (draft)</span>
                          <button type="button" className={`copy-btn${copyState === 'copied' ? ' ok' : ''}`} onClick={copyCoverLetter}>
                            {copyState === 'copied' ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{materialsPreview}</p>
                      </div>
                    )}

                    {missingSkills.length > 0 && (
                      <div>
                        <div className="dp-h">
                          <span>Missing skills for this role</span>
                        </div>
                        <div className="missing">
                          {missingSkills.map((skill) => (
                            <div className="mrow" key={skill}>
                              <b>{skill}</b>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={skillBusy === skill}
                                onClick={() => addSkill(skill)}
                              >
                                {skillBusy === skill ? 'Adding…' : 'Add'}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button type="button" className="btn btn-indigo" onClick={downloadCv}>
                      Download tailored CV (PDF)
                    </button>
                  </>
                )}

                {activeTab === 'automated' && (
                  <>
                    <div className="doc-preview">
                      <div className="dp-h">
                        <span>Status</span>
                        <span>{appState.application.status}</span>
                      </div>
                      {appState.latestRun ? (
                        <p>
                          Latest automation run #{appState.latestRun.runNumber}: {appState.latestRun.status}
                          {appState.latestRun.blockReason ? ` — ${appState.latestRun.blockReason}` : ''}
                          {appState.latestRun.manualApplyUrl ? (
                            <>
                              {' '}
                              <a href={appState.latestRun.manualApplyUrl} target="_blank" rel="noreferrer">
                                Apply manually →
                              </a>
                            </>
                          ) : null}
                        </p>
                      ) : (
                        <p>No automation run yet.</p>
                      )}
                    </div>

                    {appState.application.status === 'draft' && !appState.latestRun && (
                      <button type="button" className="btn btn-ghost" disabled={actionBusy} onClick={generateMaterials}>
                        Generate materials
                      </button>
                    )}

                    {appState.application.status === 'draft' && (
                      <button type="button" className="btn btn-ghost" disabled={actionBusy} onClick={runAutomation}>
                        Run automation
                      </button>
                    )}

                    {appState.latestRun?.status === 'ready_for_approval' && (
                      <button
                        type="button"
                        className="btn-confirm"
                        disabled={actionBusy}
                        onClick={() => approveRun(appState.latestRun!.runNumber)}
                      >
                        Review and confirm
                      </button>
                    )}

                    {appState.latestRun?.status === 'approved' && (
                      <button
                        type="button"
                        className="btn-confirm"
                        disabled={actionBusy}
                        onClick={() => submitRun(appState.latestRun!.runNumber)}
                      >
                        Submit application
                      </button>
                    )}
                  </>
                )}
              </>
            )}
```

Note `appState.latestRun?.status === 'ready_for_approval'` here refers to
the `AutomationRun`'s own `status` field — a different enum than
`Application.status` (which is `'ready'`, not `'ready_for_approval'`) —
this is correct as written, matching the original pre-Task-4 code exactly.

- [ ] **Step 4: Verify types**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual browser verification**

Open a job detail page for a job with `extractedRequirements.requiredSkills`
set and click "Apply": confirm the drawer opens on the "Prepare manually"
tab by default, with a cover letter appearing automatically and a working
"Copy" button (paste somewhere to confirm), a missing-skills list for any
required skill not already in your profile's resume skill groups, clicking
"Add" on one removes it from the list and — after navigating to
`/profile` — shows up under a new "Additional skills" group, and "Download
tailored CV (PDF)" downloads a PDF. Switch to the "Automated apply" tab:
confirm the original status/run-automation/approve/submit flow still works
exactly as it did before Task 4 (status line, "Generate materials"/"Run
automation" buttons when in `draft` with no run yet, "Review and confirm"
once a run reaches `ready_for_approval`, "Submit application" once
`approved`). Confirm `/applications` still shows a tracked row for this job
regardless of which tab you used.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/pages/JobDetail.tsx dashboard/src/index.css
git commit -m "feat(jobdetail): add tabbed apply drawer with manual prep and automated apply flows"
```

---

### Task 6: JobDetail — Escape key closes the drawer

**Files:**
- Modify: `dashboard/src/pages/JobDetail.tsx`

**Interfaces:**
- Consumes: `drawerOpen`, `setDrawerOpen` state already in the component.

- [ ] **Step 1: Add the keydown effect**

Add near the component's other `useEffect` (after the data-loading
effect):

```tsx
  useEffect(() => {
    if (!drawerOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])
```

- [ ] **Step 2: Verify**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual browser verification**

Open the apply drawer, press Escape, confirm it closes. Confirm pressing
Escape while the drawer is closed does nothing (no console errors).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/JobDetail.tsx
git commit -m "feat(jobdetail): close apply drawer on Escape key"
```

---

### Task 7: Jobs page — save/unsave toast feedback

**Files:**
- Modify: `dashboard/src/pages/Jobs.tsx`

**Interfaces:**
- Consumes: `isSaved`, `toggleSaved` from `useSavedJobs()`, already destructured at line 413.

- [ ] **Step 1: Add toast state and a wrapped toggle handler**

Near the `useSavedJobs()` call (line 413), add:

```tsx
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  function handleToggleSaved(jobId: string) {
    const willBeSaved = !isSaved(jobId)
    toggleSaved(jobId)
    setToastMessage(willBeSaved ? 'Saved' : 'Removed')
    setTimeout(() => setToastMessage(null), 1800)
  }
```

(`useState` is already imported from `react` at the top of the file.)

- [ ] **Step 2: Wire the save button to the new handler**

At line 573, change:

```tsx
                        onClick={() => toggleSaved(job._id)}
```

to:

```tsx
                        onClick={() => handleToggleSaved(job._id)}
```

- [ ] **Step 3: Render the toast**

Near the end of the component's JSX return (just before its closing root
tag), add:

```tsx
      <div className={`toast${toastMessage ? ' show' : ''}`}>{toastMessage}</div>
```

`.toast`/`.toast.show` CSS already exists at `dashboard/src/index.css:1042-1045` — no CSS changes needed.

- [ ] **Step 4: Verify**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual browser verification**

On `/jobs`, click the save icon on a job row: confirm a "Saved" toast
appears briefly at the bottom of the screen and disappears after ~1.8s;
click again and confirm "Removed" shows.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/pages/Jobs.tsx
git commit -m "feat(jobs): show a toast when saving or unsaving a job"
```

---

### Task 8: Jobs page — restyle the filter rail to match hunter.css

**Files:**
- Modify: `dashboard/src/pages/Jobs.tsx` (className swaps on `Accordion`/`AccordionItem`/`AccordionTrigger`/`AccordionContent`/`Checkbox` usages, lines ~284-408)
- Modify: `dashboard/src/index.css` (add data-slot-scoped overrides)

**Interfaces:** none (visual-only, no prop/behavior changes).

- [ ] **Step 1: Add scoped CSS for the shadcn Accordion/Checkbox structure**

The existing `.filter-rail`/`.filter-chip`/`.check` classes
(`dashboard/src/index.css:654-671`) target native `<details>`/`<summary>`
tags, but `Accordion`/`AccordionItem`/`AccordionTrigger` render divs/
buttons with `data-slot` attributes (see
`dashboard/src/components/ui/accordion.tsx:8,18,33,55`), not real
`<details>`. Add new rules — immediately after the existing `.filter-rail`
block — that reproduce the same visual values against those data-slot
hooks instead of relying on the tag selectors matching:

```css
.filter-rail [data-slot="accordion-item"]{border-top:1px solid var(--line);padding:6px 0;}
.filter-rail [data-slot="accordion-item"]:last-child{border-bottom:1px solid var(--line);}
.filter-rail [data-slot="accordion-trigger"]{
  all:unset;cursor:pointer;display:flex;width:100%;justify-content:space-between;align-items:center;
  padding:10px 0;font-weight:600;font-size:14px;color:var(--fg);font-family:var(--font-body);
}
.filter-rail [data-slot="accordion-trigger-icon"]{width:16px;height:16px;color:var(--muted-text);}
.filter-rail [data-slot="accordion-content"]{padding:4px 0 14px;}
.filter-rail .check{display:flex;align-items:center;gap:10px;font-size:14px;padding:6px 0;color:var(--fg-2);}
.filter-rail .check [data-slot="checkbox"]{accent-color:var(--indigo);width:16px;height:16px;}
```

- [ ] **Step 2: Wrap the filter controls in `.filter-rail` and swap className props**

In `dashboard/src/pages/Jobs.tsx`, change the `filterControls` JSX
(starting at line 284). The outer `<>` fragment becomes a `<div
className="filter-rail">` wrapping the search input and Accordion. Change
the `<Accordion>` element at line 297 from:

```tsx
      <Accordion defaultValue={['date', 'status', 'source']} className="mt-4 divide-y divide-border border-t border-b border-border">
```

to:

```tsx
      <Accordion defaultValue={['date', 'status', 'source']}>
```

(The `.filter-rail [data-slot="accordion-item"]` border rules from Step 1
replace what the deleted `divide-y`/`border-t`/`border-b` Tailwind classes
were doing — don't keep both.)

For every `<AccordionTrigger className="text-sm font-medium text-foreground">...</AccordionTrigger>` occurrence (5 total, at lines 299, 318, 335, 372, 385),
drop the `className` prop entirely — the new `.filter-rail
[data-slot="accordion-trigger"]` rule from Step 1 now supplies the look
unconditionally for anything under `.filter-rail`:

```tsx
              <AccordionTrigger>Date posted</AccordionTrigger>
```

(repeat for "Status", "Source", "Location", "Salary" triggers.)

Wrap each `<Checkbox .../>` + its label text in a `<div className="check">`
if not already in a flex row — inspect each of the three `<Checkbox`
occurrences (lines ~304, 323, 341, 354) and ensure the immediate wrapping
element carries `className="check"` (add it if the current wrapper has a
different/no className; if it already has a Tailwind flex className,
replace that className value with `"check"` rather than appending, to
avoid conflicting flex/gap declarations).

Finally, update the outer wrapper opening/closing tags: change the
fragment `<>` at the top of `filterControls` (just before the `<div
className="relative mt-4">` search box) to `<div className="filter-rail">`,
and its matching `</>` at the end of `filterControls` to `</div>`.

- [ ] **Step 3: Verify types**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual browser verification**

On `/jobs` at a desktop width, confirm the filter rail (left column) now
shows pill-styled section headers with chevrons that rotate on
expand/collapse, matching `.filter-rail summary` look from other
`.filter-rail`-based UI elsewhere in the app (there isn't another live
example in this app currently — compare against the mockup's
`jobs.html`/`job.html` filter rail visually instead). Confirm every filter
(date, status, source, location, salary) still functions exactly as
before — toggling a checkbox still updates the URL query params and the
result list (no logic was touched, only classNames). Resize below 980px
and confirm the existing mobile `Drawer` filter sheet still opens/closes
normally.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/Jobs.tsx dashboard/src/index.css
git commit -m "style(jobs): restyle shadcn filter accordion/checkboxes to match app's filter-rail look"
```

---

### Task 9: JobDetail — related roles, compensation/visa card, source-link card

**Files:**
- Modify: `dashboard/src/pages/JobDetail.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Job` type, `LogoChip`, `Pill`, `ScoreRing` (all already imported); adds a new `GET /jobs` call.

- [ ] **Step 1: Fetch related jobs**

Add state and a fetch effect, keyed on the loaded `job`:

```tsx
  const [relatedJobs, setRelatedJobs] = useState<Job[]>([])

  useEffect(() => {
    if (!job) return
    const params = new URLSearchParams({ sourceId: job.sourceId, status: 'verified', limit: '4' })
    apiFetch(`/jobs?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs: Job[] }) => setRelatedJobs(body.jobs.filter((candidate) => candidate._id !== job._id).slice(0, 3)))
      .catch(() => setRelatedJobs([]))
  }, [job])
```

- [ ] **Step 2: Render the related-roles grid, after the `.prose` block and the "View original posting" link**

Add, right before the drawer `<div className={\`drawer...\`}>` (i.e. as
the last thing inside the outer `<div className="wrap job-layout">`'s
first column, or as a sibling section after it — place it as a new
top-level section after the closing `</div>` of `.job-layout` and before
the drawer):

```tsx
      {relatedJobs.length > 0 && (
        <div className="wrap related">
          <h2>Related roles</h2>
          <div className="jobs-grid">
            {relatedJobs.map((related) => (
              <Link to={`/jobs/${related._id}`} key={related._id} className="jobcard">
                <div className="top">
                  <div>
                    <div className="role">{related.title}</div>
                    <div className="co">{related.company}</div>
                  </div>
                  <ScoreRing score={related.score ?? 0} size={40} />
                </div>
                <div className="tags">
                  <Pill tone="verified">Verified</Pill>
                </div>
                <div className="foot">
                  <span className="src">{related.sourceId}</span>
                  <span className="apply">View role →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
```

(`.related`/`.jobs-grid`/`.jobcard` CSS all already exist in
`index.css` — confirmed present, no CSS changes needed for this step.)

- [ ] **Step 3: Add the compensation/visa `.ev-kv` card to the evidence sidebar**

Inside `<aside className="evidence">`, after the existing match-score
`.ev-card` block and before the "Apply" `.ev-card`, add:

```tsx
          <div className="ev-card">
            <div className="ev-kv">
              <div>
                <div className="t">Compensation</div>
                <div className="v">{formatSalary(job)}</div>
              </div>
              {job.extractedRequirements && (
                <div>
                  <div className="t">Work authorization</div>
                  <div className="v">
                    {{
                      any: 'Open to anyone',
                      citizen_only: 'Citizens/residents only',
                      visa_sponsorship_available: 'Visa sponsorship available',
                      unknown: 'Not specified',
                    }[job.extractedRequirements.workAuthRequirement]}
                  </div>
                </div>
              )}
            </div>
          </div>
```

(`formatSalary` already defined at the top of the file, line 18-24;
`.ev-kv`/`.ev-kv > div`/`.ev-kv .t`/`.ev-kv .v` CSS already exists in
`index.css`.)

- [ ] **Step 4: Add the source-link card**

Immediately after the compensation/visa card, before the "Apply" card:

```tsx
          <div className="ev-card">
            <div className="src-link">
              <span className="fav">{job.sourceId.slice(0, 2).toUpperCase()}</span>
              <div>
                <span>{job.company}</span>
                <small>via {job.sourceId}</small>
              </div>
            </div>
          </div>
```

- [ ] **Step 5: Verify types**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual browser verification**

Open a job detail page for a job whose source has at least 3 other
verified jobs: confirm a "Related roles" grid renders below the main
content with working links. Confirm the evidence sidebar now shows a
compensation/work-authorization card and a source card above the "Apply"
button. Open a job with no salary data and confirm the compensation row
shows "—" rather than crashing (per `formatSalary`'s existing null
handling).

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/pages/JobDetail.tsx
git commit -m "feat(jobdetail): add related roles, compensation/visa card, and source-link card"
```

---

### Task 10: Landing page — add four marketing sections

**Files:**
- Modify: `dashboard/src/pages/Landing.tsx`
- Modify: `dashboard/src/index.css` (add `.showcase`/`.cvdemo` — confirmed absent; `.recheck-card`/`.track-strip`/`.duo`/`.tilex` already present)

**Interfaces:** none — purely additive marketing content, no new data beyond what the page already fetches.

- [ ] **Step 1: Add the missing `.showcase`/`.cvdemo` CSS**

Append to `dashboard/src/index.css` (after the existing `.tilex` rules, which end around where `.duo`/`.tilex` are already defined — confirmed present at the project's lines matching the earlier grep):

```css
.showcase{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;}
@media (max-width:900px){.showcase{grid-template-columns:1fr;}}
.cvdemo{display:grid;grid-template-columns:150px 1fr;gap:18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--card-radius-lg);padding:22px;box-shadow:var(--shadow-card);}
.cvdemo .thumb{height:196px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);position:relative;overflow:hidden;display:flex;flex-direction:column;gap:7px;padding:16px 14px;}
.cvdemo .thumb i{display:block;height:5px;border-radius:3px;background:var(--line-strong);opacity:.7;}
.cvdemo .thumb i:first-child{height:9px;width:62%;}
.cvdemo .kv > div{grid-template-columns:90px 1fr;}
```

(`.kv`/`.kv > div` base rules already exist elsewhere in `index.css` from
the CV-upload page styling — this just narrows the label column for this
specific usage.)

- [ ] **Step 2: Read the current end of the Landing page's main content to find the insertion point**

Open `dashboard/src/pages/Landing.tsx` and find the `<footer>` element —
insert the four new `<section className="band">` blocks immediately
before it (i.e. as the last content before the footer), in this order:
verified-opportunities, application-tracking, CV-intelligence,
remote/Bangladesh split (matching the mockup's section order in
`index.html`).

- [ ] **Step 3: Add the "Verified opportunities" section**

```tsx
      <section className="band">
        <div className="wrap">
          <div className="section-head center">
            <div className="kicker">Verification</div>
            <h2>Every listing is re-checked before it reaches you.</h2>
            <p>We re-fetch the source page and confirm the application form is still live before a job counts as verified.</p>
          </div>
          <div className="recheck-card">
            <div className="rc">
              <div className="t">Source page</div>
              <div className="line">GET remoteok.com/l/...<br />200 OK · 1.2s</div>
            </div>
            <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
            <div className="rc">
              <div className="t">Form check</div>
              <div className="line">
                <span className="ok">Apply form present</span>
                <br />
                <span className="ok">No "position filled" text</span>
              </div>
            </div>
            <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
            <div className="rc verdict">
              <div className="t">Verdict</div>
              <div className="big">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Verified open
              </div>
            </div>
          </div>
        </div>
      </section>
```

- [ ] **Step 4: Add the "Application tracking" section**

```tsx
      <section className="band band-alt">
        <div className="wrap">
          <div className="section-head center">
            <div className="kicker">Tracking</div>
            <h2>See exactly where every application stands.</h2>
            <p>From drafted materials to a submitted application, nothing moves without your confirmation.</p>
          </div>
          <div className="track-strip">
            <div className="tnode done">
              <div className="dot">1</div>
              <b>Draft</b>
              <span>Application created</span>
            </div>
            <div className="tnode done">
              <div className="dot">2</div>
              <b>Materials ready</b>
              <span>Cover letter drafted</span>
            </div>
            <div className="tnode you">
              <div className="dot">3</div>
              <b>Your review</b>
              <span>Nothing sends without you</span>
            </div>
            <div className="tnode">
              <div className="dot">4</div>
              <b>Submitted</b>
              <span>Tracked to the source</span>
            </div>
            <div className="tnode">
              <div className="dot">5</div>
              <b>Outcome</b>
              <span>Logged for your records</span>
            </div>
          </div>
        </div>
      </section>
```

- [ ] **Step 5: Add the "CV intelligence" section**

```tsx
      <section className="band">
        <div className="wrap">
          <div className="showcase">
            <div>
              <div className="kicker">CV intelligence</div>
              <h2>Upload once. We extract the rest.</h2>
              <p className="lead">
                Drop in a PDF or DOCX and your skills, experience, and education are parsed automatically — ready to
                match against every job in your feed.
              </p>
            </div>
            <div className="cvdemo">
              <div className="thumb">
                <i />
                <i />
                <i />
              </div>
              <div className="kv">
                <div>
                  <span className="t">Skills found</span>
                  <span className="v">12</span>
                </div>
                <div>
                  <span className="t">Experience</span>
                  <span className="v">3 roles</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
```

- [ ] **Step 6: Add the remote/Bangladesh split section**

```tsx
      <section className="band band-alt">
        <div className="wrap">
          <div className="duo">
            <div className="tilex a">
              <div>
                <div className="kicker">Remote, global</div>
                <h3>Built for remote-first roles.</h3>
                <p>Remote OK, We Work Remotely, and Himalayas feed in continuously.</p>
              </div>
            </div>
            <div className="tilex b">
              <div>
                <div className="kicker">Bangladesh</div>
                <h3>Government jobs, included.</h3>
                <p>Verified listings from alljobs.teletalk.com.bd, tagged so you can filter them separately.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
```

- [ ] **Step 7: Verify types**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Manual browser verification**

Visit `/` (logged out is fine — Landing is public). Scroll through and
confirm all four new sections render below the existing content and above
the footer, with readable copy and no layout breakage in both light and
dark theme (toggle via the existing theme toggle).

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/pages/Landing.tsx dashboard/src/index.css
git commit -m "feat(landing): add verification, tracking, CV-intelligence, and remote/BD sections"
```

---

### Task 11: Score-ring/bar animate-in on scroll

**Files:**
- Create: `dashboard/src/hooks/useScrollReveal.ts` (if no equivalent generic hook already exists — check first; the design-mapping research noted the app already has scroll-reveal for hero content, possibly under a different name/mechanism, so inspect `dashboard/src/pages/Landing.tsx` imports before creating a new one)
- Modify: `dashboard/src/pages/JobDetail.tsx` (`.ev-card .bars` / `.bar-fill` wrapper)
- Modify: `dashboard/src/pages/Dashboard.tsx` (`.big-ring` wrapper)

**Interfaces:**
- Produces: `useScrollReveal(): RefObject<HTMLElement>` — a ref to attach to the element that should gain a `.in` class (or similar) once it's scrolled into view, OR, if an existing mechanism is found in Step 1, reuse its exact API instead of this one.

- [ ] **Step 1: Check for an existing scroll-reveal mechanism before building a new one**

Run: `grep -n "IntersectionObserver\|reveal" dashboard/src/pages/Landing.tsx dashboard/src/hooks/*.ts 2>/dev/null`

If this finds an existing hook or inline `IntersectionObserver` pattern
already used for the hero/stat-grid, reuse its exact class names and
attach the same mechanism to the score elements in Steps 2-3 below instead
of introducing a second implementation. If nothing is found, proceed with
Steps 2-3 as written.

- [ ] **Step 2: Create the hook (only if Step 1 found nothing reusable)**

```ts
import { useEffect, useRef, useState } from 'react'

export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, isVisible }
}
```

- [ ] **Step 3: Apply it to the match-score card in JobDetail**

In `dashboard/src/pages/JobDetail.tsx`, import the hook, call it once near
the top of the component (`const { ref: scoreRef, isVisible: scoreVisible } = useScrollReveal<HTMLDivElement>()`), and
on the `.ev-card` wrapping the score bars (the one containing `<div
className="bars">`), add `ref={scoreRef}` and conditionally render the
`.bar-fill` width only once visible:

```tsx
                      <div className="bar-fill" style={{ width: scoreVisible ? `${pct}%` : '0%' }} />
```

(`.bar-fill` already has `transition:width 1.1s cubic-bezier(.3,.8,.3,1)`
in `index.css`, so this alone produces the animate-in effect — no new CSS
needed.)

- [ ] **Step 4: Verify types**

Run: `cd dashboard && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual browser verification**

Open a job detail page for a scored job, scroll the match-score card out
of the initial viewport (shrink the window or scroll down first), then
scroll it into view: confirm the bars animate from 0 to their final width
rather than appearing instantly.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/pages/JobDetail.tsx dashboard/src/hooks/useScrollReveal.ts
git commit -m "feat(jobdetail): animate score bars in on scroll"
```

(If Step 1 found an existing mechanism, adjust the `git add`/commit
message to reflect reusing it instead of adding a new hook file.)

---

## Self-review notes

- **Spec coverage:** all six in-scope items from the plan doc map to tasks
  above — sidebar (Tasks 2-3), apply-drawer rebuild (Tasks 4-6), landing
  sections (Task 10), job-detail polish (Task 9), jobs filter restyle
  (Task 8), misc polish (Tasks 6, 7, 11). Task 1 is a small refactor
  prerequisite for Task 2, not separately listed in the spec but implied
  by its "move that helper to a shared location" instruction.
- **Known risk flagged inline:** Task 4 intentionally leaves `npm run
  typecheck` red until Task 5 completes, because splitting the automation-
  removal from the drawer-rewrite into separately reviewable diffs was
  judged more valuable than keeping every single task green — call this
  out to whoever executes the plan so it isn't mistaken for a mistake.
- **Type/name consistency checked:** `Application.status` value `'ready'`
  used consistently in Tasks 2 and 4 (not the spec doc's informal "ready
  for approval" phrasing); `profileCompletenessPercent` signature matches
  between Task 1's definition and Task 2's call site; `missingSkills`/
  `flatProfileSkills` defined in Task 4 are consumed with the same names in
  Task 5.
