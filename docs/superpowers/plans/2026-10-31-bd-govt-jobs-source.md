# BD Government Jobs Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth `JobSource` (`teletalk-govt`) that discovers Bangladesh government job circulars from Teletalk's public JSON API, store them with a dedicated `govtDetails` shape, exclude them from AI verification/scoring, and surface them in the dashboard behind a Private/Government Jobs switch.

**Architecture:** One new adapter (`api/src/discovery/sources/teletalkGovt.ts`) implementing the existing `JobSource` interface — paginate the org-list endpoint, fetch full per-job detail for every stub via the existing `fetchWithPolicy` throttle, map to `RawJobPosting` with an attached `govtDetails` object. It slots into the existing `sources` array in `mountRoutes.ts` and rides the existing `Promise.allSettled` discovery/dedupe pipeline unchanged. A new `UNSCORED_JOB_SOURCE_IDS` constant filters this source out of `runVerification`/`runScoring`'s initial queries. The dashboard gains a `category` URL param and a segmented control that swaps the job-card/detail rendering and hides filters that don't apply to government postings.

**Tech Stack:** Same as M2 (TypeScript strict, Hono 4, `mongodb` driver 6, Zod 3, Vitest + `mongodb-memory-server` for DB-touching tests, `fetch` mocking for adapter tests — no live network calls in the suite). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-bd-govt-jobs-source-design.md`

## Global Constraints

- TypeScript strict mode everywhere; `npm run typecheck --workspace=api` and `--workspace=shared` must exit 0 clean after every task.
- All adapters go through `fetchWithPolicy()` (`api/src/discovery/fetchWithPolicy.ts`) — a named User-Agent and a 1 request/second/host throttle. Do not add a second throttle or bypass this helper.
- No live network calls in the test suite — mock `fetch` with fixtures. (Live API responses used to build these fixtures were captured during this plan's research pass on 2026-10-31 — see Task 3.)
- `govtDetails` is `.nullable()`, not `.optional()`, on `JobSchema` (matches the existing `extractedRequirements`/`scoreBreakdown` pattern) — every place that currently constructs a full `Job` object literal must add `govtDetails: null` or it will fail to typecheck. Task 2 lists every such file.
- Govt postings never pass through AI requirements-extraction, scoring, or resume-tailoring — enforced via `UNSCORED_JOB_SOURCE_IDS` filtering, not by skipping code paths conditionally.
- Package manager: npm workspaces (unchanged).

### Corrections to the design doc (confirmed by live API probes on 2026-10-31)

The design doc's endpoint shape table and field-mapping table disagree slightly on `public-details`. Live requests resolved this:

- `details.id` (e.g. `15068`) is the **numeric** job id — same id used to query `?id=` and matches the org-list stub's `id`. Use this for `sourceJobId`.
- `details.job_id` (e.g. `"GJOB15068"`) is the **string job code** — this is the `jobCode` field in `GovtJobDetailsSchema`, not `details.id` as a literal reading of the doc's table might suggest.
- `advertisement_file` is a **relative path** (e.g. `public/uploads/governments/jobs/advertisement-....pdf`), not a full URL. Confirmed live: prefixing with `https://alljobs.teletalk.com.bd/` resolves (HTTP 200). `advertisementPdfUrl` must be built as `` `https://alljobs.teletalk.com.bd/${details.advertisement_file}` ``, not used raw.
- A bad/unknown `id` returns HTTP 400 with `{"status":"error","statusCode":400,"message":{...}}` — not a network error, not malformed JSON. This is the shape the "skip this one posting" fixture in Task 3 must model.
- Every sampled posting (8 postings across clerical, cleaner, and security-guard roles) returned `gender: 3`. No other code has ever been observed, and Teletalk documents none of them publicly. Per the design doc's own stated risk tolerance ("falling back to `'unknown'` for unrecognized values since the code→meaning mapping isn't documented anywhere public"), this plan maps `3 → 'any'` as a single inferred (not confirmed) entry — justified only because 3 appears uniformly across roles that are not plausibly single-gender-restricted — and leaves every other code, including any future unseen one, falling back to `'unknown'`.

---

### Task 1: Shared schema — `teletalk-govt` source id, `GovtJobDetailsSchema`, `UNSCORED_JOB_SOURCE_IDS`

**Files:**
- Modify: `shared/src/schemas/job.ts`
- Test: `shared/test/job-schema.test.ts`

**Interfaces:**
- Produces: `JobSourceIdSchema` (gains `'teletalk-govt'`), `GovtJobDetailsSchema`, `GovtJobDetails` type, `JobSchema.govtDetails: GovtJobDetailsSchema.nullable()`, `UNSCORED_JOB_SOURCE_IDS: JobSourceId[]` — consumed by `api/src/discovery/types.ts` (Task 2), `api/src/discovery/sources/teletalkGovt.ts` (Task 3), `api/src/verification/verificationService.ts` and `api/src/scoring/scoringService.ts` (Task 5), `api/src/routes/jobs.ts` (Task 6).

- [ ] **Step 1: Write the failing tests**

Add to `shared/test/job-schema.test.ts` (keep all existing tests; add `govtDetails: null` to `VALID_JOB` and these new cases):

```ts
// VALID_JOB gains one line:
  scoredAt: null,
  govtDetails: null,
}

// New test cases, appended to the describe block:
  it('accepts a teletalk-govt job with govtDetails populated', () => {
    const result = JobSchema.safeParse({
      ...VALID_JOB,
      sourceId: 'teletalk-govt',
      govtDetails: {
        jobCode: 'GJOB15068',
        vacancy: '02',
        minAge: 18,
        maxAge: 32,
        genderRequirement: 'any',
        publishedDate: '2026-11-01T03:00:00.000Z',
        deadlineDate: '2026-11-22T10:00:00.000Z',
        advertisementNo: '05.44.6500.402.06.012.26-206',
        advertisementPdfUrl: 'https://alljobs.teletalk.com.bd/public/uploads/governments/jobs/advertisement-1793262869609.pdf',
        applicationPortalUrl: 'https://dcnarail.teletalk.com.bd/',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects govtDetails with an invalid genderRequirement', () => {
    const result = JobSchema.safeParse({
      ...VALID_JOB,
      sourceId: 'teletalk-govt',
      govtDetails: {
        jobCode: 'GJOB15068',
        vacancy: '02',
        minAge: 18,
        maxAge: 32,
        genderRequirement: 'nonbinary', // not a valid enum value
        publishedDate: null,
        deadlineDate: null,
        advertisementNo: null,
        advertisementPdfUrl: null,
        applicationPortalUrl: null,
      },
    })
    expect(result.success).toBe(false)
  })

  it('UNSCORED_JOB_SOURCE_IDS contains exactly teletalk-govt', () => {
    expect(UNSCORED_JOB_SOURCE_IDS).toEqual(['teletalk-govt'])
  })
```

Add the import at the top of the test file:
```ts
import { JobSchema, UNSCORED_JOB_SOURCE_IDS } from '../src/index'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=shared`
Expected: FAIL — `UNSCORED_JOB_SOURCE_IDS` is not exported, `'teletalk-govt'` is rejected by `JobSourceIdSchema`, `govtDetails` is an unrecognized key.

- [ ] **Step 3: Implement the schema additions**

`shared/src/schemas/job.ts` — full new contents:

```ts
import { z } from 'zod'

export const JobSourceIdSchema = z.enum(['remoteok', 'weworkremotely', 'himalayas', 'teletalk-govt'])

export const JobStatusSchema = z.enum(['discovered', 'verified', 'rejected'])

export const JobRequirementsSchema = z.object({
  requiredSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  minExperienceYears: z.number().int().nonnegative().nullable(),
  workAuthRequirement: z.enum(['any', 'citizen_only', 'visa_sponsorship_available', 'unknown']),
  remoteType: z.enum(['fully_remote', 'hybrid', 'onsite', 'unknown']),
})

export const ScoreBreakdownSchema = z.object({
  workAuthFit: z.number().int(),
  remoteFit: z.number().int(),
  salaryFit: z.number().int(),
  skillMatch: z.number().int(),
  locationFit: z.number().int(),
})

export const GovtJobDetailsSchema = z.object({
  jobCode: z.string(),
  vacancy: z.string(),
  minAge: z.number().int().nullable(),
  maxAge: z.number().int().nullable(),
  genderRequirement: z.enum(['male', 'female', 'any', 'unknown']),
  publishedDate: z.string().nullable(),
  deadlineDate: z.string().nullable(),
  advertisementNo: z.string().nullable(),
  advertisementPdfUrl: z.string().nullable(),
  applicationPortalUrl: z.string().nullable(),
})

export const JobSchema = z.object({
  _id: z.string().optional(),
  sourceId: JobSourceIdSchema,
  sourceJobId: z.string(),
  normalizedUrl: z.string(),
  title: z.string(),
  company: z.string(),
  rawDescription: z.string(),
  location: z.string().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  postedAt: z.string().nullable(),
  status: JobStatusSchema,
  discoveredAt: z.string(),
  updatedAt: z.string(),
  verifiedAt: z.string().nullable(),
  verificationEvidence: z.string().nullable(),
  contentHash: z.string().nullable(),
  extractedRequirements: JobRequirementsSchema.nullable(),
  extractedAt: z.string().nullable(),
  score: z.number().int().min(0).max(100).nullable(),
  scoreBreakdown: ScoreBreakdownSchema.nullable(),
  scoredAt: z.string().nullable(),
  govtDetails: GovtJobDetailsSchema.nullable(),
})

export type JobSourceId = z.infer<typeof JobSourceIdSchema>
export type JobStatus = z.infer<typeof JobStatusSchema>
export type JobRequirements = z.infer<typeof JobRequirementsSchema>
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>
export type GovtJobDetails = z.infer<typeof GovtJobDetailsSchema>
export type Job = z.infer<typeof JobSchema>

export const UNSCORED_JOB_SOURCE_IDS: JobSourceId[] = ['teletalk-govt']
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=shared`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=shared`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/job.ts shared/test/job-schema.test.ts
git commit -m "feat(shared): add teletalk-govt source id, GovtJobDetailsSchema, UNSCORED_JOB_SOURCE_IDS"
```

---

### Task 2: Discovery types + service wiring for `govtDetails`

**Files:**
- Modify: `api/src/discovery/types.ts`
- Modify: `api/src/discovery/discoveryService.ts`
- Modify: `api/test/jobs.test.ts` (add `govtDetails: null` to `makeJob` defaults)
- Modify: `shared/test/job-schema.test.ts` (already done in Task 1)
- Modify: `api/test/applications/applicationsService.test.ts`, `api/test/applications.test.ts`, `api/test/automation/automationOrchestrator.test.ts`, `api/test/automation.test.ts`, `api/test/materials/materialsService.test.ts`, `api/test/materials.test.ts`, `api/test/scoring/scoringService.test.ts`, `api/test/scoring.test.ts` — each has a hardcoded `Job`-shaped fixture literal with a `scoreBreakdown: null,` line; add `govtDetails: null,` immediately after it in each file.
- Test: `api/test/discovery/discoveryService.test.ts` (new test case)

**Interfaces:**
- Consumes: `UNSCORED_JOB_SOURCE_IDS`, `JobSourceId`, `GovtJobDetails` from `@job-hunter/shared` (Task 1).
- Produces: `RawJobPosting.govtDetails?: GovtJobDetails`, `RawJobPosting.sourceId` gains `'teletalk-govt'` — consumed by `teletalkGovt.ts` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `api/test/discovery/discoveryService.test.ts` (read the existing file first to match its exact `beforeEach`/fixture setup, then add this case inside the existing `describe` block):

```ts
it('persists govtDetails when a source populates it, and null when it does not', async () => {
  const govtSource: JobSource = {
    id: 'teletalk-govt',
    async fetchJobs() {
      return [
        {
          sourceId: 'teletalk-govt',
          sourceJobId: '15068',
          url: 'https://alljobs.teletalk.com.bd/jobs/government/559?jobId=15068',
          title: 'Accounts Assistant',
          company: 'Narail Distric (DCNARAIL)',
          rawDescription: 'Accounts Assistant at Narail Distric (DCNARAIL) — 02 vacancies.',
          location: null,
          salaryMin: null,
          salaryMax: null,
          postedAt: '2026-11-01T03:00:00.000Z',
          govtDetails: {
            jobCode: 'GJOB15068',
            vacancy: '02',
            minAge: 18,
            maxAge: 32,
            genderRequirement: 'any',
            publishedDate: '2026-11-01T03:00:00.000Z',
            deadlineDate: '2026-11-22T10:00:00.000Z',
            advertisementNo: '05.44.6500.402.06.012.26-206',
            advertisementPdfUrl: 'https://alljobs.teletalk.com.bd/public/uploads/governments/jobs/advertisement-1793262869609.pdf',
            applicationPortalUrl: 'https://dcnarail.teletalk.com.bd/',
          },
        },
      ]
    },
  }
  const plainSource: JobSource = {
    id: 'remoteok',
    async fetchJobs() {
      return [
        {
          sourceId: 'remoteok',
          sourceJobId: 'r1',
          url: 'https://remoteok.com/remote-jobs/r1',
          title: 'Engineer',
          company: 'Acme',
          rawDescription: 'desc',
          location: null,
          salaryMin: null,
          salaryMax: null,
          postedAt: null,
        },
      ]
    },
  }

  await runDiscovery(db, [govtSource, plainSource])

  const jobs = db.collection('jobs')
  const govtJob = await jobs.findOne({ sourceId: 'teletalk-govt', sourceJobId: '15068' })
  const plainJob = await jobs.findOne({ sourceId: 'remoteok', sourceJobId: 'r1' })

  expect(govtJob?.govtDetails).toEqual({
    jobCode: 'GJOB15068',
    vacancy: '02',
    minAge: 18,
    maxAge: 32,
    genderRequirement: 'any',
    publishedDate: '2026-11-01T03:00:00.000Z',
    deadlineDate: '2026-11-22T10:00:00.000Z',
    advertisementNo: '05.44.6500.402.06.012.26-206',
    advertisementPdfUrl: 'https://alljobs.teletalk.com.bd/public/uploads/governments/jobs/advertisement-1793262869609.pdf',
    applicationPortalUrl: 'https://dcnarail.teletalk.com.bd/',
  })
  expect(plainJob?.govtDetails).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api -- discoveryService`
Expected: FAIL — TypeScript error, `govtDetails` does not exist on the posting object type (or `sourceId: 'teletalk-govt'` not assignable), since `RawJobPosting` hasn't been updated yet.

- [ ] **Step 3: Update `RawJobPosting` and `discoveryService.ts`**

`api/src/discovery/types.ts` — full new contents:

```ts
import type { GovtJobDetails } from '@job-hunter/shared'

export interface RawJobPosting {
  sourceId: 'remoteok' | 'weworkremotely' | 'himalayas' | 'teletalk-govt'
  sourceJobId: string
  url: string
  title: string
  company: string
  rawDescription: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  postedAt: string | null
  govtDetails?: GovtJobDetails
}

export interface JobSource {
  id: RawJobPosting['sourceId']
  fetchJobs(): Promise<RawJobPosting[]>
}
```

`api/src/discovery/discoveryService.ts` — in the `insertOne` call inside `runDiscovery`, add one field after `scoreBreakdown: null,`:

```ts
          scoreBreakdown: null,
          scoredAt: null,
          govtDetails: posting.govtDetails ?? null,
        })
```

(This is the one necessary deviation from the design doc's claim of "no changes to discoveryService.ts" — the new field is required, not optional, on the `Job` type stored in Mongo, so the insert literal must set it explicitly for every source, govt or not.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api -- discoveryService`
Expected: PASS

- [ ] **Step 5: Fix the other Job-literal fixtures**

In each of these 8 files, find the line `scoreBreakdown: null,` and add `govtDetails: null,` immediately after it (same indentation):
`api/test/applications/applicationsService.test.ts:33`, `api/test/applications.test.ts:53`, `api/test/automation/automationOrchestrator.test.ts:69`, `api/test/automation.test.ts:64`, `api/test/materials/materialsService.test.ts:44`, `api/test/materials.test.ts:63`, `api/test/scoring/scoringService.test.ts:45`, `api/test/scoring.test.ts:91`.

In `api/test/jobs.test.ts`, find the `makeJob` helper's default object (around line 30-53) and add `govtDetails: null,` immediately after `scoredAt: null,`.

- [ ] **Step 6: Run the full api test suite and typecheck**

Run: `npm run test --workspace=api && npm run typecheck --workspace=api`
Expected: PASS / exit 0 — this confirms every existing `Job` literal across the test suite compiles with the new required field.

- [ ] **Step 7: Commit**

```bash
git add api/src/discovery/types.ts api/src/discovery/discoveryService.ts api/test/discovery/discoveryService.test.ts api/test/jobs.test.ts api/test/applications/applicationsService.test.ts api/test/applications.test.ts api/test/automation/automationOrchestrator.test.ts api/test/automation.test.ts api/test/materials/materialsService.test.ts api/test/materials.test.ts api/test/scoring/scoringService.test.ts api/test/scoring.test.ts
git commit -m "feat(discovery): thread govtDetails through RawJobPosting and discoveryService"
```

---

### Task 3: `teletalkGovt` source adapter

**Files:**
- Create: `api/src/discovery/sources/teletalkGovt.ts`
- Test: `api/test/discovery/teletalkGovt.test.ts`

**Interfaces:**
- Consumes: `fetchWithPolicy` (`api/src/discovery/fetchWithPolicy.ts:17`, signature `(url: string) => Promise<Response>`), `JobSource`/`RawJobPosting` (Task 2), `GovtJobDetails` (`@job-hunter/shared`, Task 1).
- Produces: `teletalkGovtSource: JobSource` — consumed by `mountRoutes.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

`api/test/discovery/teletalkGovt.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { teletalkGovtSource } from '../../src/discovery/sources/teletalkGovt'

function orgListPage(opts: { count: number; orgs: Array<Record<string, unknown>> }) {
  return new Response(JSON.stringify({ status: 'success', count: opts.count, govtOrgJobs: opts.orgs }), {
    status: 200,
  })
}

function publicDetails(details: Record<string, unknown>) {
  return new Response(JSON.stringify({ status: 'success', details }), { status: 200 })
}

const ORG = {
  id: 559,
  name: 'Narail Distric (DCNARAIL)',
  name_bn: null,
  website: 'http://narail.gov.bd/',
  job_created_at: '2026-10-29T08:59:28.379Z',
  govt_jobs: [{ id: 15068, job_title: 'Accounts Assistant', job_title_bn: 'হিসাব সহকারী', organization_id: 559 }],
}

const DETAILS = {
  id: 15068,
  job_title: 'Accounts Assistant',
  job_id: 'GJOB15068',
  vacancy: '02',
  gender: 3,
  min_age: 18,
  max_age: 32,
  application_site: 'https://dcnarail.teletalk.com.bd/',
  advertisement_file: 'public/uploads/governments/jobs/advertisement-1793262869609.pdf',
  published_date: '2026-11-01T03:00:00.000Z',
  deadline_date: '2026-11-22T10:00:00.000Z',
  advertisement_no: '05.44.6500.402.06.012.26-206',
}

describe('teletalkGovtSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('paginates the org-list and fetches full detail for every job stub', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('org-list')) return Promise.resolve(orgListPage({ count: 1, orgs: [ORG] }))
      if (url.includes('public-details')) return Promise.resolve(publicDetails(DETAILS))
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'teletalk-govt',
        sourceJobId: '15068',
        url: 'https://alljobs.teletalk.com.bd/jobs/government/559?jobId=15068',
        title: 'Accounts Assistant',
        company: 'Narail Distric (DCNARAIL)',
        rawDescription: 'Accounts Assistant at Narail Distric (DCNARAIL) — 02 vacancies. Published 2026-11-01T03:00:00.000Z, deadline 2026-11-22T10:00:00.000Z.',
        location: null,
        salaryMin: null,
        salaryMax: null,
        postedAt: '2026-11-01T03:00:00.000Z',
        govtDetails: {
          jobCode: 'GJOB15068',
          vacancy: '02',
          minAge: 18,
          maxAge: 32,
          genderRequirement: 'any',
          publishedDate: '2026-11-01T03:00:00.000Z',
          deadlineDate: '2026-11-22T10:00:00.000Z',
          advertisementNo: '05.44.6500.402.06.012.26-206',
          advertisementPdfUrl: 'https://alljobs.teletalk.com.bd/public/uploads/governments/jobs/advertisement-1793262869609.pdf',
          applicationPortalUrl: 'https://dcnarail.teletalk.com.bd/',
        },
      },
    ])
  })

  it('walks every page until the org-list count is exhausted', async () => {
    const orgPage1 = { ...ORG, id: 1, govt_jobs: [{ id: 101, job_title: 'A', job_title_bn: 'ক', organization_id: 1 }] }
    const orgPage2 = { ...ORG, id: 2, govt_jobs: [{ id: 102, job_title: 'B', job_title_bn: 'খ', organization_id: 2 }] }
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('page=1')) return Promise.resolve(orgListPage({ count: 2, orgs: [orgPage1] }))
      if (url.includes('page=2')) return Promise.resolve(orgListPage({ count: 2, orgs: [orgPage2] }))
      if (url.includes('id=101')) return Promise.resolve(publicDetails({ ...DETAILS, id: 101, job_id: 'GJOB101' }))
      if (url.includes('id=102')) return Promise.resolve(publicDetails({ ...DETAILS, id: 102, job_id: 'GJOB102' }))
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs.map((j) => j.sourceJobId)).toEqual(['101', '102'])
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('page=1'))).toBe(true)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('page=2'))).toBe(true)
  })

  it('skips a single posting whose public-details call returns an error, without failing the batch', async () => {
    const orgWithTwoJobs = {
      ...ORG,
      govt_jobs: [
        { id: 15068, job_title: 'Accounts Assistant', job_title_bn: 'হিসাব সহকারী', organization_id: 559 },
        { id: 99999999, job_title: 'Broken Posting', job_title_bn: 'X', organization_id: 559 },
      ],
    }
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('org-list')) return Promise.resolve(orgListPage({ count: 1, orgs: [orgWithTwoJobs] }))
      if (url.includes('id=15068')) return Promise.resolve(publicDetails(DETAILS))
      if (url.includes('id=99999999')) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'error', statusCode: 400, message: {} }), { status: 400 })
        )
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs).toHaveLength(1)
    expect(jobs[0].sourceJobId).toBe('15068')
  })

  it('maps an unrecognized gender code to unknown', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('org-list')) return Promise.resolve(orgListPage({ count: 1, orgs: [ORG] }))
      if (url.includes('public-details')) return Promise.resolve(publicDetails({ ...DETAILS, gender: 7 }))
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs[0].govtDetails?.genderRequirement).toBe('unknown')
  })

  it('throws when the org-list page itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(teletalkGovtSource.fetchJobs()).rejects.toThrow('503')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api -- teletalkGovt`
Expected: FAIL — `Cannot find module '../../src/discovery/sources/teletalkGovt'`

- [ ] **Step 3: Implement the adapter**

`api/src/discovery/sources/teletalkGovt.ts`:

```ts
import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'
import type { GovtJobDetails } from '@job-hunter/shared'

const ALLJOBS_BASE_URL = 'https://alljobs.teletalk.com.bd'
const ORG_LIST_URL = `${ALLJOBS_BASE_URL}/api/v1/govt-jobs/org-list`
const PUBLIC_DETAILS_URL = `${ALLJOBS_BASE_URL}/api/v1/govt-jobs/public-details`
const PAGE_LIMIT = 20

// Teletalk documents no code->meaning mapping for `gender` anywhere public.
// 3 is the only value ever observed (across clerical, cleaner, and security-guard
// postings — roles with no plausible single-gender restriction), so it is mapped
// as an inference, not a confirmed fact. Every other code, seen or not, falls
// back to 'unknown' rather than guessing further.
const GENDER_CODE_MAP: Record<number, GovtJobDetails['genderRequirement']> = {
  3: 'any',
}

interface OrgListJobStub {
  id: number
  job_title: string
}

interface OrgListOrg {
  id: number
  name: string
  govt_jobs: OrgListJobStub[]
}

interface OrgListResponse {
  count: number
  govtOrgJobs: OrgListOrg[]
}

interface PublicDetailsBody {
  job_id: string
  vacancy: string
  gender: number
  min_age: number | null
  max_age: number | null
  application_site: string | null
  advertisement_file: string | null
  published_date: string | null
  deadline_date: string | null
  advertisement_no: string | null
}

interface PublicDetailsResponse {
  details: PublicDetailsBody
}

interface JobStubWithOrg {
  jobId: number
  jobTitle: string
  orgId: number
  orgName: string
}

async function fetchOrgListPage(page: number): Promise<OrgListResponse> {
  const res = await fetchWithPolicy(`${ORG_LIST_URL}?page=${page}&limit=${PAGE_LIMIT}`)
  if (!res.ok) {
    throw new Error(`teletalk-govt: unexpected org-list status ${res.status}`)
  }
  return (await res.json()) as OrgListResponse
}

async function fetchAllJobStubs(): Promise<JobStubWithOrg[]> {
  const firstPage = await fetchOrgListPage(1)
  const stubs: JobStubWithOrg[] = []

  function collect(response: OrgListResponse) {
    for (const org of response.govtOrgJobs) {
      for (const job of org.govt_jobs) {
        stubs.push({ jobId: job.id, jobTitle: job.job_title, orgId: org.id, orgName: org.name })
      }
    }
  }
  collect(firstPage)

  const totalPages = Math.ceil(firstPage.count / PAGE_LIMIT)
  for (let page = 2; page <= totalPages; page++) {
    collect(await fetchOrgListPage(page))
  }

  return stubs
}

function mapGenderCode(code: number): GovtJobDetails['genderRequirement'] {
  return GENDER_CODE_MAP[code] ?? 'unknown'
}

function buildRawDescription(stub: JobStubWithOrg, details: PublicDetailsBody): string {
  const parts = [`${stub.jobTitle} at ${stub.orgName} — ${details.vacancy} vacancies.`]
  if (details.published_date || details.deadline_date) {
    parts.push(
      `Published ${details.published_date ?? 'unknown'}, deadline ${details.deadline_date ?? 'unknown'}.`
    )
  }
  return parts.join(' ')
}

async function fetchJobDetail(stub: JobStubWithOrg): Promise<RawJobPosting | null> {
  const res = await fetchWithPolicy(`${PUBLIC_DETAILS_URL}?id=${stub.jobId}`)
  if (!res.ok) return null

  const body = (await res.json()) as PublicDetailsResponse
  const details = body.details
  if (!details) return null

  const govtDetails: GovtJobDetails = {
    jobCode: details.job_id,
    vacancy: details.vacancy,
    minAge: details.min_age,
    maxAge: details.max_age,
    genderRequirement: mapGenderCode(details.gender),
    publishedDate: details.published_date,
    deadlineDate: details.deadline_date,
    advertisementNo: details.advertisement_no,
    advertisementPdfUrl: details.advertisement_file
      ? `${ALLJOBS_BASE_URL}/${details.advertisement_file}`
      : null,
    applicationPortalUrl: details.application_site,
  }

  return {
    sourceId: 'teletalk-govt',
    sourceJobId: String(stub.jobId),
    url: `${ALLJOBS_BASE_URL}/jobs/government/${stub.orgId}?jobId=${stub.jobId}`,
    title: stub.jobTitle,
    company: stub.orgName,
    rawDescription: buildRawDescription(stub, details),
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: details.published_date,
    govtDetails,
  }
}

export const teletalkGovtSource: JobSource = {
  id: 'teletalk-govt',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const stubs = await fetchAllJobStubs()
    const postings: RawJobPosting[] = []

    for (const stub of stubs) {
      const posting = await fetchJobDetail(stub)
      if (posting) postings.push(posting)
    }

    return postings
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api -- teletalkGovt`
Expected: PASS (all 5 cases)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add api/src/discovery/sources/teletalkGovt.ts api/test/discovery/teletalkGovt.test.ts
git commit -m "feat(discovery): add teletalk-govt BD government jobs source adapter"
```

---

### Task 4: Wire `teletalkGovtSource` into `mountRoutes`

**Files:**
- Modify: `api/src/mountRoutes.ts`

**Interfaces:**
- Consumes: `teletalkGovtSource` (Task 3).

- [ ] **Step 1: Add the import and the sources array entry**

`api/src/mountRoutes.ts` — two changes:

```ts
import { himalayasSource } from './discovery/sources/himalayas.js'
import { teletalkGovtSource } from './discovery/sources/teletalkGovt.js'
```

```ts
  const sources = [remoteOkSource, weWorkRemotelySource, himalayasSource, teletalkGovtSource]
```

- [ ] **Step 2: Run the full api test suite and typecheck**

Run: `npm run test --workspace=api && npm run typecheck --workspace=api`
Expected: PASS / exit 0 — `discovery.test.ts` and `cron.test.ts` exercise `mountRoutes` indirectly and must still pass with 4 sources instead of 3.

- [ ] **Step 3: Commit**

```bash
git add api/src/mountRoutes.ts
git commit -m "feat(discovery): register teletalk-govt in discovery and cron source arrays"
```

---

### Task 5: Exclude `teletalk-govt` from verification and scoring

**Files:**
- Modify: `api/src/verification/verificationService.ts`
- Modify: `api/src/scoring/scoringService.ts`
- Test: `api/test/verification/verificationService.test.ts`
- Test: `api/test/scoring/scoringService.test.ts`

**Interfaces:**
- Consumes: `UNSCORED_JOB_SOURCE_IDS` from `@job-hunter/shared` (Task 1).

- [ ] **Step 1: Write the failing tests**

Read `api/test/verification/verificationService.test.ts` first to find its `insertDiscoveredJob` helper (confirmed present at line 17, takes `(db, overrides)`), then add this case inside the existing `describe` block:

```ts
it('excludes teletalk-govt jobs from the discovered-jobs query', async () => {
  await insertDiscoveredJob(db, { sourceId: 'teletalk-govt', sourceJobId: 'g1' })
  const verifier = vi.fn()

  const result = await runVerification(db, verifier)

  expect(result.checked).toBe(0)
  expect(verifier).not.toHaveBeenCalled()
})
```

Read `api/test/scoring/scoringService.test.ts` first to find its job-fixture helper (it has a `scoreBreakdown: null,` fixture at line 45 — read the surrounding function to match its exact helper name and signature), then add an analogous case:

```ts
it('excludes teletalk-govt jobs from the verified-jobs query', async () => {
  await jobs.insertOne(makeJob({ sourceId: 'teletalk-govt', sourceJobId: 'g1', status: 'verified' }))
  const extractor = vi.fn()

  const result = await runScoring(db, profile, extractor)

  expect(result.checked).toBe(0)
  expect(extractor).not.toHaveBeenCalled()
})
```

(Match `makeJob`/fixture helper names exactly to what's already in that file — do not invent a new helper.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api -- verificationService scoringService`
Expected: FAIL — both new cases see `checked: 1` because the query doesn't filter `sourceId` yet.

- [ ] **Step 3: Add the filter**

`api/src/verification/verificationService.ts` — import and query change:

```ts
import { UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'
```

```ts
  const discoveredJobs = await jobs
    .find({ status: 'discovered', sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS } })
    .toArray()
```

`api/src/scoring/scoringService.ts` — import and query change:

```ts
import { UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'
```

```ts
  const verifiedJobs = await jobs
    .find({ status: 'verified', sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS } })
    .toArray()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api -- verificationService scoringService`
Expected: PASS

- [ ] **Step 5: Run the full api test suite and typecheck**

Run: `npm run test --workspace=api && npm run typecheck --workspace=api`
Expected: PASS / exit 0

- [ ] **Step 6: Commit**

```bash
git add api/src/verification/verificationService.ts api/src/scoring/scoringService.ts api/test/verification/verificationService.test.ts api/test/scoring/scoringService.test.ts
git commit -m "feat(verification,scoring): exclude teletalk-govt jobs from both pipelines"
```

---

### Task 6: `category` query param on `GET /jobs`

**Files:**
- Modify: `api/src/routes/jobs.ts`
- Test: `api/test/jobs.test.ts`

**Interfaces:**
- Consumes: `UNSCORED_JOB_SOURCE_IDS` from `@job-hunter/shared` (Task 1), re-exported locally as `GOVT_JOB_SOURCE_IDS` for call-site clarity.
- Produces: `GET /jobs?category=government|private` filtering — consumed by the dashboard (Tasks 7-8).

- [ ] **Step 1: Write the failing tests**

Read the existing `api/test/jobs.test.ts` route-test setup (uses `app.request('/jobs?...')`, confirmed at lines 107-121/139-150) and add two cases matching that pattern, inserting one `remoteok` job and one `teletalk-govt` job via `makeJob`:

```ts
it('filters to government jobs with category=government', async () => {
  await jobs.insertMany([
    makeJob({ sourceJobId: 'g1', sourceId: 'teletalk-govt' }),
    makeJob({ sourceJobId: 'p1', sourceId: 'remoteok' }),
  ])

  const res = await app.request('/jobs?category=government', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body: JobsListBody = await res.json()

  expect(body.jobs).toHaveLength(1)
  expect(body.jobs[0].sourceId).toBe('teletalk-govt')
})

it('filters to private jobs with category=private', async () => {
  await jobs.insertMany([
    makeJob({ sourceJobId: 'g1', sourceId: 'teletalk-govt' }),
    makeJob({ sourceJobId: 'p1', sourceId: 'remoteok' }),
  ])

  const res = await app.request('/jobs?category=private', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body: JobsListBody = await res.json()

  expect(body.jobs).toHaveLength(1)
  expect(body.jobs[0].sourceId).toBe('remoteok')
})
```

(Match the existing file's exact variable names for `token`/`jobs`/`app` — read the surrounding `beforeEach` first.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api -- jobs.test`
Expected: FAIL — both cases return all jobs regardless of `category`.

- [ ] **Step 3: Implement the filter**

`api/src/routes/jobs.ts` — add the import, the re-export, a parser, and wire it into `buildJobsFilter` and the route handler:

```ts
import { JobSourceIdSchema, JobStatusSchema, UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'

export const GOVT_JOB_SOURCE_IDS = UNSCORED_JOB_SOURCE_IDS
```

```ts
function parseCategory(raw: string | undefined): 'government' | 'private' | undefined {
  return raw === 'government' || raw === 'private' ? raw : undefined
}
```

In `buildJobsFilter`'s parameter type and body, add:

```ts
function buildJobsFilter(query: {
  status?: JobStatus
  sourceId?: JobSourceId
  category?: 'government' | 'private'
  keyword?: string
  location?: string
  company?: string
  salaryMin?: number
  salaryMax?: number
  discoveredAfter?: string
}): Filter<Job> {
  const filter: Filter<Job> = {}
  if (query.status) filter.status = query.status
  if (query.sourceId) filter.sourceId = query.sourceId
  if (query.category === 'government') filter.sourceId = { $in: GOVT_JOB_SOURCE_IDS }
  if (query.category === 'private') filter.sourceId = { $nin: GOVT_JOB_SOURCE_IDS }
  if (query.location) filter.location = { $regex: escapeRegex(query.location), $options: 'i' }
  // ...rest unchanged
```

And in the route handler, add `category: parseCategory(c.req.query('category')),` to the object passed into `buildJobsFilter`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api -- jobs.test`
Expected: PASS

- [ ] **Step 5: Run the full api test suite and typecheck**

Run: `npm run test --workspace=api && npm run typecheck --workspace=api`
Expected: PASS / exit 0

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/jobs.ts api/test/jobs.test.ts
git commit -m "feat(jobs): add category=government|private filter to GET /jobs"
```

---

### Task 7: Dashboard `Jobs.tsx` — Private/Government switch and govt job cards

**Files:**
- Modify: `dashboard/src/pages/Jobs.tsx`

**Interfaces:**
- Consumes: `GET /jobs?category=...` (Task 6), `Job.govtDetails` (Task 1).

- [ ] **Step 1: Add the `category` URL-param state, following the existing `status`/`sourceSelection` pattern**

In `JobsPage`, alongside the existing `status`/`sourceSelection`/`datePosted` derivations (around line 175-183):

```ts
  const category = (searchParams.get('category') as 'private' | 'government') || 'private'
```

- [ ] **Step 2: Include `category` in the fetch effect**

In the `useEffect` that builds `params` and calls `apiFetch` (around line 257-282), add:

```ts
    params.set('category', category)
```

and add `category` to that effect's dependency array.

- [ ] **Step 3: Render the segmented control above the search bar**

In the JSX returned by `filterControls` (or directly in the page body above it — place it above the `<Search>` input block, around line 287-289), add:

```tsx
      <div className="mt-4 inline-flex rounded-full border border-slate-300 bg-white p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => updateFilters({ category: null })}
          className={`rounded-full px-4 py-1.5 ${category === 'private' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
        >
          Private Jobs
        </button>
        <button
          type="button"
          onClick={() => updateFilters({ category: 'government' })}
          className={`rounded-full px-4 py-1.5 ${category === 'government' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
        >
          Government Jobs
        </button>
      </div>
```

- [ ] **Step 4: Hide the Salary, Source, and Location accordion sections in government mode**

In the `<Accordion>` JSX (lines 300-411), wrap the `source`, `location`, and `salary` `<AccordionItem>` blocks (and their accordion `defaultValue` entries) in a `{category === 'private' && (...)}` guard. Example for the source section:

```tsx
            {category === 'private' && (
              <AccordionItem value="source">
                <AccordionTrigger className="text-sm font-medium text-slate-900">Source</AccordionTrigger>
                <AccordionContent>
                  {/* unchanged contents */}
                </AccordionContent>
              </AccordionItem>
            )}
```

Apply the same guard to the `location` and `salary` `AccordionItem` blocks. Leave `date` and `status` ungated — the spec keeps keyword search and date-posted filters for both modes, and `status` isn't called out to hide (govt jobs are always `discovered`, so the Status filter simply has nothing to narrow in that mode — harmless to leave visible, matches the existing codebase's preference not to add UI state it doesn't need).

- [ ] **Step 5: Render government-specific job cards**

In the `jobs.map((job) => ...)` block (lines 501-569), branch on `job.govtDetails`. Replace the card's company/location/salary/source line and the Apply button with a government variant when present:

```tsx
              {jobs.map((job) => {
                const requirements = requirementsPreview(job.rawDescription)
                return (
                <li
                  key={job._id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-5 sm:px-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <Link
                      to={`/jobs/${job._id}`}
                      className="text-xl font-normal text-slate-900 hover:underline"
                    >
                      {job.title}
                    </Link>
                    {!job.govtDetails && (
                      <span
                        className={`mt-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClasses(job.status)}`}
                      >
                        {statusBadgeLabel(job)}
                      </span>
                    )}
                  </div>

                  {job.govtDetails ? (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <Building2 size={16} className="text-slate-400" />
                          {job.company}
                        </span>
                        <span>Vacancy: {job.govtDetails.vacancy}</span>
                        {job.govtDetails.deadlineDate && (
                          <span className="font-medium text-amber-700">
                            Apply by: {new Date(job.govtDetails.deadlineDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                        <Link
                          to={`/jobs/${job._id}`}
                          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-blue-600 shadow-sm hover:bg-slate-50"
                        >
                          View details
                        </Link>
                        {job.govtDetails.advertisementPdfUrl && (
                          <a
                            href={job.govtDetails.advertisementPdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                          >
                            View circular
                          </a>
                        )}
                        {job.govtDetails.applicationPortalUrl && (
                          <a
                            href={job.govtDetails.applicationPortalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
                          >
                            Apply
                          </a>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {/* existing private-job card body: location/salary/source line,
                          Description, Requirements, View details + Apply — unchanged */}
                    </>
                  )}
                </li>
                )
              })}
```

(The `{/* existing private-job card body ... unchanged */}` comment marks where the implementer moves the current lines 521-565 verbatim into the `else` branch — not a placeholder to fill in, since that code already exists in the file untouched.)

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev --workspace=dashboard` (and the API dev server) — load `/jobs`, toggle to "Government Jobs", confirm: Salary/Source/Location accordion sections disappear, job cards show vacancy count + deadline + circular/portal links instead of salary/source, and toggling back to "Private Jobs" restores the original behavior unchanged.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/pages/Jobs.tsx
git commit -m "feat(dashboard): add Private/Government Jobs switch and govt job cards"
```

---

### Task 8: Dashboard `JobDetail.tsx` — government job details block

**Files:**
- Modify: `dashboard/src/pages/JobDetail.tsx`

**Interfaces:**
- Consumes: `Job.govtDetails` (Task 1).

- [ ] **Step 1: Render a conditional details block**

In `JobDetailPage`, replace the `<dl>` grid (lines 60-85) with a branch: keep the existing grid for non-govt jobs, and render a government-specific one when `job.govtDetails` is set. Insert this check right after the existing `<p>{job.company} · {job.location ?? 'Location unknown'}</p>` line:

```tsx
            {job.govtDetails ? (
              <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Vacancy</dt>
                  <dd className="text-slate-900">{job.govtDetails.vacancy}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Age range</dt>
                  <dd className="text-slate-900">
                    {job.govtDetails.minAge ?? '—'}–{job.govtDetails.maxAge ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Gender requirement</dt>
                  <dd className="text-slate-900">{job.govtDetails.genderRequirement}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Advertisement no.</dt>
                  <dd className="text-slate-900">{job.govtDetails.advertisementNo ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Published</dt>
                  <dd className="text-slate-900">{formatDate(job.govtDetails.publishedDate)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Deadline</dt>
                  <dd className="text-slate-900">{formatDate(job.govtDetails.deadlineDate)}</dd>
                </div>
              </dl>
            ) : (
              <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                {/* existing Status/Salary/Source/Posted/Discovered/Verified grid — unchanged */}
              </dl>
            )}
```

(As in Task 7, the `{/* existing ... unchanged */}` comment marks moving the current lines 61-84 verbatim into this branch, not a placeholder.)

- [ ] **Step 2: Add PDF circular and application portal links, replacing the generic "View original posting" link when govt details are present**

Replace the trailing `<a href={job.normalizedUrl} ...>View original posting →</a>` block (lines 104-111) with:

```tsx
            {job.govtDetails ? (
              <div className="mt-6 flex flex-wrap gap-4">
                {job.govtDetails.advertisementPdfUrl && (
                  <a
                    href={job.govtDetails.advertisementPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View circular (PDF) →
                  </a>
                )}
                {job.govtDetails.applicationPortalUrl && (
                  <a
                    href={job.govtDetails.applicationPortalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Application portal →
                  </a>
                )}
              </div>
            ) : (
              <a
                href={job.normalizedUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-block text-sm text-blue-600 hover:underline"
              >
                View original posting →
              </a>
            )}
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev --workspace=dashboard` — navigate to a `/jobs/:id` detail page for a government job (seed one via the discovery endpoint, or temporarily point at a job with `govtDetails` set in the DB) and confirm the vacancy/age/gender/advertisement/dates block renders, with circular + portal links in place of the Salary/Source fields and the generic Apply link. Then check a private-sector job detail page still renders unchanged.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/JobDetail.tsx
git commit -m "feat(dashboard): render government job details block on JobDetail page"
```
