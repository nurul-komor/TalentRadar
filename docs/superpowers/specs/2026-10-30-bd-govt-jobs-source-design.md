# BD Government Jobs Source — Design

Date: 2026-10-30
Status: Approved (brainstormed and reviewed in chat; this doc is the record
before the implementation plan is written)

## Purpose

Add a fourth `JobSource`, pulling Bangladesh government job circulars from
Teletalk's `alljobs.teletalk.com.bd`, into the existing discovery pipeline
(`docs/superpowers/specs/2026-10-21-m2-job-discovery-design.md`). Surface
them in the dashboard behind a top-level "Private Jobs / Government Jobs"
switch, since the data shape and the scoring pipeline's assumptions (visa
fit, remote-type fit, free-text descriptions) don't apply to this source.

## Scope decisions made during brainstorming

- **What the switch controls:** the new Teletalk govt source vs. the three
  existing international sources (grouped as "Private Jobs"), not a second
  new source for Teletalk's own "Private Jobs" section — that section is
  live on their site but currently has zero listings, so there's nothing to
  pull from it today.
- **Fetch depth:** full per-job detail (deadline, vacancy count, age/gender
  eligibility, PDF circular, application portal link), not just the
  lightweight org-list stub data. Costs one extra API call per job
  (~150-200 calls at today's catalog size) but the deadline/vacancy/PDF
  fields are the information a govt-job browser actually needs.
- **Scoring/materials:** govt postings are discovered and listed but never
  pass through AI requirements-extraction, scoring, or resume-tailoring.
  Those concepts (work-authorization fit, remote-type fit, skill match
  against free-text description) don't apply to BD govt clerical postings,
  and Teletalk doesn't expose free-text prose to extract from in the first
  place — `rawDescription` here is a synthesized summary, not a real
  posting body.
- **Cron scheduling:** merged into the existing sources array / daily cron,
  not a separate cron endpoint. `runDiscovery` already runs sources
  concurrently via `Promise.allSettled`, so total wall-clock time is
  bounded by the slowest single source rather than the sum. At today's
  scale (~190 postings, ~200s for this source) that's comfortably under
  Vercel's 300s function timeout. Flagged as a risk to revisit if
  Teletalk's catalog grows substantially — see "Known risks" below.

## Verified source facts (researched 2026-10-30)

The site is a JS SPA; the real data comes from an undocumented but
unauthenticated public JSON API (no API key, no login required for reads).

| Endpoint | Purpose | Shape |
|---|---|---|
| `GET /api/v1/govt-jobs/org-list?page=N&limit=20` | Paginated list of govt orgs with open postings | `{ count, govtOrgJobs: [{ id, name, name_bn, website, job_created_at, govt_jobs: [{ id, job_title, job_title_bn }] }] }` |
| `GET /api/v1/govt-jobs/public-details?id=<jobId>` | Full detail for one posting | `{ details: { job_id, vacancy, gender, min_age, max_age, application_site, advertisement_file, published_date, deadline_date, advertisement_no, job_utilities_govtorganization: {...} } }` |

Facts that shape the design:

- 27 orgs, ~150-200 open postings total as of this writing (2 pages at
  `limit=20`, despite higher `limit` values being silently capped server-side
  at 20).
- No salary data anywhere — govt pay-scale jobs don't disclose figures.
- No structured location field beyond the org name/website.
- "Apply" is not a single click: each org has its own application portal
  subdomain (e.g. `dcnarail.teletalk.com.bd`), separate from
  `alljobs.teletalk.com.bd` where the circular itself lives.
- Titles are available in both English (`job_title`) and Bengali
  (`job_title_bn`); no English free-text description exists anywhere in the
  API — only structured fields (vacancy, age range, gender, dates,
  advertisement number) plus a PDF circular.
- Teletalk's own "Private Jobs" section (`/jobs/private`,
  `/api/v1/private-jobs/list`) is live but returns zero listings today.

## Architecture

New code under `api/src/discovery/`:

- `sources/teletalkGovt.ts` — a `JobSource` implementation (`id:
  'teletalk-govt'`) that:
  1. Paginates `govt-jobs/org-list` to collect every org + its embedded job
     stubs.
  2. For each job stub, calls `govt-jobs/public-details?id=` (via the
     existing `fetchWithPolicy`, so the 1 req/sec per-host throttle and
     named User-Agent apply unchanged) to get full detail.
  3. Maps each into a `RawJobPosting` with an attached `govtDetails` object.

No changes to `fetchWithPolicy.ts`, `normalizeUrl.ts`, or `discoveryService.ts`
— the new source slots into the existing `JobSource` contract and the
existing dedupe/upsert loop (`sourceId`+`sourceJobId` and `normalizedUrl`
uniqueness checks already generalize to a 4th source without modification).

`mountRoutes.ts`: add `teletalkGovtSource` to the `sources` array used by
both `createDiscoveryRoutes` and `createCronRoutes` — this is the only
wiring change needed for the daily cron to pick it up.

### Excluding govt jobs from verification and scoring

`runVerification` (`api/src/verification/verificationService.ts`) currently
queries *all* `status: 'discovered'` jobs regardless of source, and
`runScoring` (`api/src/scoring/scoringService.ts`) queries *all*
`status: 'verified'` jobs. Left unchanged, govt postings would flow through
both despite the decision to skip them.

Add a shared constant in `shared/src/index.ts`:

```ts
export const UNSCORED_JOB_SOURCE_IDS: JobSourceId[] = ['teletalk-govt']
```

and filter it into both services' initial queries:

```ts
jobs.find({ status: 'discovered', sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS } })
jobs.find({ status: 'verified', sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS } })
```

## Data model

### `shared/src/schemas/job.ts`

- `JobSourceIdSchema` gains `'teletalk-govt'`.
- New nested, nullable schema (mirrors the existing `extractedRequirements`/
  `scoreBreakdown` nullable-object pattern already in `JobSchema`):

```ts
export const GovtJobDetailsSchema = z.object({
  jobCode: z.string(),                 // "GJOB15068"
  vacancy: z.string(),                 // kept as string — some postings are non-numeric ("vacancy_not_specific")
  minAge: z.number().int().nullable(),
  maxAge: z.number().int().nullable(),
  genderRequirement: z.enum(['male', 'female', 'any', 'unknown']),
  publishedDate: z.string().nullable(),      // ISO
  deadlineDate: z.string().nullable(),       // ISO
  advertisementNo: z.string().nullable(),
  advertisementPdfUrl: z.string().nullable(),
  applicationPortalUrl: z.string().nullable(), // org's own apply site
})
```

- `JobSchema` gains `govtDetails: GovtJobDetailsSchema.nullable()`.

### Field mapping for this source

| `Job` field | Value |
|---|---|
| `sourceId` | `'teletalk-govt'` |
| `sourceJobId` | `String(details.id)` |
| `url` / `normalizedUrl` | `https://alljobs.teletalk.com.bd/jobs/government/{orgId}?jobId={id}` (the circular's page on alljobs, not the org's separate application portal) |
| `title` | `details.job_title` (English) |
| `company` | org `name` |
| `rawDescription` | synthesized summary (title, org, vacancy, published/deadline dates) — there is no free-text posting body to capture |
| `location` | `null` — no structured location field exists |
| `salaryMin` / `salaryMax` | `null` — always, no pay-scale data in the API |
| `postedAt` | `details.published_date` (ISO) |
| `govtDetails` | populated per the mapping above; `genderRequirement` maps Teletalk's numeric `gender` code to `male`/`female`/`any`, falling back to `'unknown'` for unrecognized values since the code→meaning mapping isn't documented anywhere public |

`RawJobPosting` (`api/src/discovery/types.ts`) gains an optional
`govtDetails` field matching the same shape, populated only by this source
and left `undefined` by the other three.

## API

`GET /jobs` (`api/src/routes/jobs.ts`) gains an optional `category` query
param (`'government' | 'private'`), translated in `buildJobsFilter`:

```ts
if (query.category === 'government') filter.sourceId = { $in: GOVT_JOB_SOURCE_IDS }
if (query.category === 'private') filter.sourceId = { $nin: GOVT_JOB_SOURCE_IDS }
```

reusing the same `UNSCORED_JOB_SOURCE_IDS` constant (renamed/re-exported as
`GOVT_JOB_SOURCE_IDS` for clarity at the call site, same array). The
existing single-value `sourceId` filter is untouched — `category` is purely
the grouping the new dashboard switch drives; both filters can coexist in
the query-building logic without conflict since callers set one or the
other, never both.

## Frontend (dashboard)

- `Jobs.tsx`: a segmented control at the top of the page (above the search
  bar), two options — **Private Jobs** (default, existing behavior
  unchanged) / **Government Jobs** — writes to the `category` URL param.
- In government mode:
  - Hide the Salary, Source, and Location filter accordion sections (always
    empty or single-valued for this source).
  - Keep Keyword search and Date-posted filters.
  - Job cards show: title + Bangla title (secondary line), org name,
    vacancy count, a prominent "Apply by: {deadline}", and links to the PDF
    circular and the org's application portal — replacing the generic
    salary/normalizedUrl "Apply" button used for private-sector cards.
- `JobDetail.tsx`: render a "Government job details" block when
  `job.govtDetails` is non-null (vacancy, age range, gender requirement,
  advertisement number, published/deadline dates, PDF + application portal
  links), in place of the Salary/Status fields that don't apply to this
  source.

## Error handling

- Unchanged at the `discoveryService` level: `Promise.allSettled` already
  isolates one source's failure from the others, and this source is just a
  4th entry in the same `sources` array.
- Within `teletalkGovt.ts`: a failure fetching `public-details` for a single
  job (bad response, unexpected shape) is skipped with that one posting
  dropped from the batch, not thrown — one malformed posting shouldn't fail
  the entire source the way a top-level fetch error should. The org-list
  pagination calls themselves, by contrast, throw on failure (consistent
  with how the other three adapters treat their primary list-fetch call) —
  losing the first page is a real sweep failure, not a per-item skip.

## Testing strategy

Follows the existing M2 conventions:

- **Source tests** (`api/test/discovery/sources/teletalkGovt.test.ts`-style)
  mock `fetch` with realistic fixtures matching the org-list and
  public-details shapes captured during research — no live network calls.
  Cover: pagination across multiple org-list pages, a malformed
  `public-details` response being skipped rather than failing the whole
  batch, and the gender-code-to-enum mapping's `'unknown'` fallback.
- **`buildJobsFilter` tests** (`api/test/jobs.test.ts`) cover the new
  `category` param translating to the right `$in`/`$nin` clause.
- **Verification/scoring service tests** assert that `teletalk-govt`-sourced
  jobs are excluded from both services' initial query, even when their
  `status` would otherwise make them eligible.

## Known risks

- **Discovery run time grows with the catalog.** At ~190 postings this
  source takes ~200s against Vercel's 300s function timeout, with other
  sources running concurrently rather than adding to that total. If
  Teletalk's open-postings count roughly doubles, this source alone could
  approach or exceed the timeout. No mitigation is built now (explicitly
  deferred per the "keep merged" cron decision) — if it becomes a real
  problem, the fix is either a dedicated cron endpoint for this source (so
  a timeout here doesn't risk the other three) or skipping `public-details`
  calls for postings already stored with a known, still-future deadline
  (requires giving the source DB read access, which the current `JobSource`
  interface doesn't provide — a larger change than this spec covers).
- **`genderRequirement` code mapping is a guess.** Teletalk's numeric
  `gender` field (seen values: `3` in sampled data) has no public
  documentation. The mapping is inferred, not confirmed, and unrecognized
  codes fall back to `'unknown'` rather than guessing.

## Explicitly out of scope

- Teletalk's "Private Jobs" section (currently empty; add if/when they
  publish real listings there).
- AI requirements-extraction, scoring, and materials generation for govt
  postings.
- A dedicated/separate cron schedule for this source.
- Any change to `fetchWithPolicy`'s throttle policy.
