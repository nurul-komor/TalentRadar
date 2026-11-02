# Hunter design system port — plan

## Goals

Bring the dashboard app's visual language and a handful of missing UX flows in
line with the static design mockup at
`/home/nurulkomor/Downloads/hunter-design-preview/site/` (referred to below as
"the mockup"), and rebuild the job-application drawer around a self-serve
materials-prep flow instead of the current automation-run pipeline.

## Scope

**Starting fact, from research:** the mockup's CSS vocabulary (`.bento`,
`.jrow`, `.ev-card`, `.psec`, `.stages`, `.src-card`, design tokens, etc.) is
already present almost verbatim in `dashboard/src/index.css`, and most pages
(`Dashboard`, `Applications`, `Profile`, `Cv`, `Landing`, `Login`, `Register`,
`HowItWorks`, `Scoring`, `Sources`, `JobDetail`) are already built against it
with real API data. This is **not** a from-scratch redesign — it's closing a
short list of concrete gaps, plus one real feature change.

### In scope

1. **Sidebar redesign.** Replace the plain link-list sidebar (just made
   floating earlier this session) with the mockup's richer sidebar: search
   box, nav badges, "Shortcuts" section (saved jobs / government jobs), "Next
   action" widget, user card (avatar, name, profile completeness, theme
   toggle). Floating/curved shell styling and a matching mobile tab bar.
2. **Apply-drawer rebuild (JobDetail).** Remove the automation-run/approve/
   submit UI from the job-detail drawer entirely. Replace it with: cover
   letter preview + copy-to-clipboard, a "Download CV" button, and a missing-
   skills list where clicking "Add" on a skill saves it to the user's real
   Profile (`resume.skillGroups`) and removes it from the missing list,
   right there, one at a time. "Download CV" calls the existing
   `/profile/cv/export` PDF endpoint, which will now reflect any skills just
   added.
3. **Landing page.** Add the four marketing sections whose CSS already
   exists in `index.css` but have no JSX yet: verified-opportunities,
   application-tracking, CV-intelligence, remote/Bangladesh split.
4. **Job detail polish.** Related-roles grid, compensation/visa card,
   source-link card (CSS already exists).
5. **Jobs page filters.** Re-skin the existing shadcn Accordion/Checkbox/
   Drawer filter rail to match the mockup's chip/check visual language.
   Keep the current server-side, URL-persisted filtering logic as-is —
   this is a visual-only change.
6. **Misc polish.** Toast feedback on save/unsave a job; Escape key closes
   the job-detail drawer; score-ring/bar animate-in on scroll.

### Out of scope

- The Applications page's own automation run/approve/submit UI and backend
  (`api/src/automation/*`, `api/src/applications/automationRunsService.ts`)
  are untouched — they're a separate, already-working feature surfaced on
  `/applications`, not on the job-detail drawer.
- Register page stays single-step (not the mockup's 3-step wizard) — just
  restyled.
- Admin page (has its own `Header`, no mockup equivalent).
- No new backend endpoints — the apply-drawer rebuild reuses
  `PUT /profile` and `GET /profile/cv/export`, both of which already exist.

## Approach

- CSS/markup-only pages (Dashboard, Applications, Profile, CV, Login,
  HowItWorks, Scoring, Sources) need no structural change — skip them
  except where a specific gap item above touches them.
- Sidebar: rework `DashboardSidebar.tsx` (shared via `DashboardLayout.tsx`,
  already wired across Dashboard/Applications/Profile/CV from earlier this
  session) to match the mockup's richer markup, sourcing real data (profile
  completeness, saved-jobs count, pending-review count) instead of the
  mockup's hardcoded placeholders.
- Apply drawer: when the drawer opens, silently ensure a draft `Application`
  record exists (same `POST /applications` call, just no longer a visible
  button) so Applications-page tracking keeps working, then show the
  materials-prep UI. Missing skills = `job.extractedRequirements.requiredSkills`
  minus the flattened set of `profile.resume.skillGroups[].skills`. "Add"
  appends the skill to an "Additional skills" group via `PUT /profile`.
- Landing/job-detail additions: pure JSX+CSS, no new data beyond what
  `PublicJobsSummary`/`Job` already expose; placeholder-labeled where the
  mockup's copy is illustrative rather than real.
- Jobs filter restyle: CSS-only change to shadcn component class overrides,
  no logic change.

## Open questions

None outstanding — all material product decisions (apply-flow replacement,
skill persistence, register flow, jobs-filter restyle vs leave-as-is, page
rollout as one pass) were resolved in conversation before this doc was
written. See the technical doc for implementation detail.
