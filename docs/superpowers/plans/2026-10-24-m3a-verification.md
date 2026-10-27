# M3a — Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the second stage of the job pipeline — check each `discovered` job for positive evidence that the posting is genuinely still open, and flip its status to `verified` or `rejected` accordingly — behind a manually-triggered authenticated API endpoint, continuing the pattern M2 established for discovery.

**Architecture:** A pure `classifyEvidence()` function scans a job posting page's stripped text for negative-evidence phrases (closed/filled/expired) first, then positive-evidence phrases (apply now/submit application) — "no evidence either way" is `inconclusive`, never silently treated as open. A `pageEvidenceVerifier` wraps that pure function with the actual page fetch (reusing M2's `fetchWithPolicy`) and HTTP-status handling (404/410 are immediate rejections; other non-2xx statuses are inconclusive, not rejections, since they're more likely anti-bot blocking than evidence of closure). A `verificationService` queries the `jobs` collection for everything still in `discovered` status, runs the verifier against each one, and writes the outcome back — isolating one job's failure from the rest, the same way M2's `discoveryService` isolates one source's failure from the others. A new `POST /verification/run` route (bearer-token-protected, identical pattern to `/discovery/run`) triggers a sweep synchronously and returns counts.

**Scope decision — no "source-API check" stage:** the design spec describes two stages, "a source-API check first where available, then a page-evidence check." None of M2's three sources (Remote OK, We Work Remotely, Himalayas) expose a per-job status endpoint — their only API is the same bulk listing feed discovery already consumes, and re-fetching an entire feed to check one job's status would be wasteful and still wouldn't prove closure (feeds are time-windowed; a job's absence from a fresh fetch doesn't mean it closed, it may have just scrolled out of the feed's window). So for M3a, with only these 3 sources, the source-API stage is "not available" per the spec's own qualifier, and this plan implements the page-evidence stage only. The `JobVerifier` function-type boundary is deliberately source-agnostic (takes a URL, nothing else) so a future per-source API check can be composed in front of it later without changing this plan's code.

**Tech Stack:** Same as M1/M2 (TypeScript strict, Hono 4, `mongodb` driver 6, Zod 3, Vitest + `mongodb-memory-server`). No new npm dependencies — HTML-to-text extraction for evidence matching uses a minimal regex-based stripper (a full HTML parser is unnecessary for substring pattern matching, and would be the first DOM-parsing dependency in this codebase for no real benefit here).

**Spec:** `docs/superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md` (see "Verification and scoring" — this plan implements only the verification half; scoring, which introduces the Anthropic SDK, is a separate M3b plan)

## Global Constraints

- Node.js 22 (pinned via the repo's `.nvmrc` — if your shell defaults to a different version, run `source ~/.nvm/nvm.sh && nvm use 22` before any `npm`/`node` command).
- TypeScript strict mode everywhere.
- `api`/`shared` tests use Vitest; MongoDB-touching tests use a real `mongodb-memory-server` instance (never mocks). Tests that touch the network (the page-evidence verifier) mock `fetch` with realistic fixtures — no live calls to third-party sites in the test suite.
- Each test that stubs `fetch` must use a **distinct hostname per test case** within a file — `fetchWithPolicy`'s per-host throttle state is a module-level `Map` that persists across `it()` blocks in the same file, and reusing a hostname across tests caused a real timing bug in M2 (see M2's Task 2 ledger note). Reusing a hostname is only safe when a test is deliberately exercising the throttle itself.
- `npm run typecheck --workspace=api` (and `--workspace=shared`) must exit 0 clean after every task.
- The verification endpoint requires the same bearer-token auth as `/discovery/run` (`createRequireAuth`, from M1 Task 6) — it triggers outbound fetches to third-party job pages.
- No Claude/Anthropic API calls anywhere in this plan. Verification is a deterministic HTTP-status + text-pattern check only; the design spec's Claude-based matching/scoring is M3b, not this plan.
- Reuses the existing `fetchWithPolicy()` helper (named User-Agent + 1 request/second/host throttle) for every page fetch, identical to M2's adapters. Like M2, this does not add robots.txt enforcement despite the design spec mentioning it for discovery adapters — that gap already exists from M2 and this plan neither introduces nor closes it.
- An HTTP 200 alone is never sufficient to mark a job `verified` — this is an explicit design-spec requirement, not a style choice. Absence of matching evidence (positive or negative) must produce `inconclusive`, leaving the job's status unchanged for a future re-check, never a default to `verified`.
- Negative evidence (closed/filled/expired) always takes priority over positive evidence (apply now) when a page's text happens to contain both — e.g. a "thanks for your interest, this role has been filled" page might still contain the word "apply" elsewhere in its template chrome.
- Only jobs currently in `discovered` status are considered by a verification sweep — already-`verified`/`rejected` jobs are left untouched. Re-verifying jobs over time on a schedule is a `node-cron` concern under Operations, explicitly deferred to M6, same deferral M2 already established for discovery scheduling.
- Package manager: npm workspaces (unchanged from M1/M2).

---

### Task 1: Extend the shared `Job` schema for verification state

**Files:**
- Modify: `shared/src/schemas/job.ts`
- Modify: `api/src/discovery/discoveryService.ts`
- Test: `shared/test/job-schema.test.ts`

**Interfaces:**
- Modifies: `JobStatusSchema` (adds `'verified'`, `'rejected'` to the existing `'discovered'`-only enum) and `JobSchema` (adds `verifiedAt: string | null`, `verificationEvidence: string | null`) in `shared/src/schemas/job.ts` — consumed by `api/src/verification/verificationService.ts` (Task 3, for the `Job`-typed collection and the `status`/`verifiedAt`/`verificationEvidence` fields it writes).
- Modifies: the `insertOne` call inside `runDiscovery()` in `api/src/discovery/discoveryService.ts` so every newly-discovered job is inserted with `verifiedAt: null, verificationEvidence: null` already present, rather than those fields being absent until a verification sweep first touches the document. Matches this schema's already-established pattern (M1/M2): `shared` schemas are the contract/documentation layer, not a runtime gate on every internal DB write, so this insert is not re-validated through Zod.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `shared/test/job-schema.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { JobSchema } from '../src/index'

const VALID_JOB = {
  sourceId: 'remoteok',
  sourceJobId: '12345',
  normalizedUrl: 'https://remoteok.com/remote-jobs/12345',
  title: 'Senior Backend Engineer',
  company: 'Acme Corp',
  rawDescription: '<p>We are hiring...</p>',
  location: null,
  salaryMin: 90000,
  salaryMax: 130000,
  postedAt: '2026-10-01T00:00:00.000Z',
  status: 'discovered',
  discoveredAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
  verifiedAt: null,
  verificationEvidence: null,
}

describe('JobSchema', () => {
  it('accepts a valid discovered job', () => {
    const result = JobSchema.safeParse(VALID_JOB)
    expect(result.success).toBe(true)
  })

  it('rejects an unknown sourceId', () => {
    const result = JobSchema.safeParse({ ...VALID_JOB, sourceId: 'linkedin' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing required field', () => {
    const { normalizedUrl, ...withoutUrl } = VALID_JOB
    const result = JobSchema.safeParse(withoutUrl)
    expect(result.success).toBe(false)
  })

  it('accepts a verified job with verification evidence', () => {
    const result = JobSchema.safeParse({
      ...VALID_JOB,
      status: 'verified',
      verifiedAt: '2026-10-22T00:00:00.000Z',
      verificationEvidence: 'apply now',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a rejected job with verification evidence', () => {
    const result = JobSchema.safeParse({
      ...VALID_JOB,
      status: 'rejected',
      verifiedAt: '2026-10-22T00:00:00.000Z',
      verificationEvidence: 'position has been filled',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown status value', () => {
    const result = JobSchema.safeParse({ ...VALID_JOB, status: 'pending' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test --workspace=shared`
Expected: FAIL — `verifiedAt`/`verificationEvidence` are not yet part of `JobSchema`, and `'verified'`/`'rejected'` are not yet valid `status` values, so the "accepts a valid discovered job" test fails too (the fixture now includes the two new fields) until Step 3 lands.

- [ ] **Step 3: Extend the schema**

`shared/src/schemas/job.ts`:

```ts
import { z } from 'zod'

export const JobSourceIdSchema = z.enum(['remoteok', 'weworkremotely', 'himalayas'])

export const JobStatusSchema = z.enum(['discovered', 'verified', 'rejected'])

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
})

export type JobSourceId = z.infer<typeof JobSourceIdSchema>
export type JobStatus = z.infer<typeof JobStatusSchema>
export type Job = z.infer<typeof JobSchema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=shared`
Expected: PASS (12 tests total: 6 existing `schemas.test.ts` + 6 `job-schema.test.ts` — the file now has 6 `it()` blocks, replacing the previous 3)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=shared`
Expected: exit 0, no output.

- [ ] **Step 6: Set the new fields at discovery time**

In `api/src/discovery/discoveryService.ts`, find the `insertOne` call inside `runDiscovery()`'s per-posting loop and add the two new fields so every document has a complete, known shape from the moment it's discovered:

```ts
        await db.collection<Job>('jobs').insertOne({
          sourceId: posting.sourceId,
          sourceJobId: posting.sourceJobId,
          normalizedUrl: normalizedPostingUrl,
          title: posting.title,
          company: posting.company,
          rawDescription: posting.rawDescription,
          location: posting.location,
          salaryMin: posting.salaryMin,
          salaryMax: posting.salaryMax,
          postedAt: posting.postedAt,
          status: 'discovered',
          discoveredAt: now,
          updatedAt: now,
          verifiedAt: null,
          verificationEvidence: null,
        })
```

This is the only change to this file — everything else in `runDiscovery()` and `isDuplicate()` stays exactly as M2 left it.

- [ ] **Step 7: Run the full api suite to confirm no regression**

Run: `npm run test --workspace=api`
Expected: PASS (39 tests total, unchanged from M2 — `discoveryService.test.ts`'s existing assertions check specific fields like `stored?.status`/`stored?.normalizedUrl`, not a full-document `toEqual`, so they don't need updating for the two new always-`null` fields).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0, no output.

- [ ] **Step 9: Commit**

```bash
git add shared/src/schemas/job.ts shared/test/job-schema.test.ts api/src/discovery/discoveryService.ts
git commit -m "Extend Job schema with verified/rejected status and verification evidence fields"
```

---

### Task 2: Verification types, evidence classifier, and page-evidence verifier

**Files:**
- Create: `api/src/verification/types.ts`
- Create: `api/src/verification/evidenceClassifier.ts`
- Create: `api/src/verification/pageEvidenceVerifier.ts`
- Test: `api/test/verification/evidenceClassifier.test.ts`
- Test: `api/test/verification/pageEvidenceVerifier.test.ts`

**Interfaces:**
- Consumes: `fetchWithPolicy(url: string): Promise<Response>` from `api/src/discovery/fetchWithPolicy.ts` (M2 Task 2).
- Produces: `VerificationOutcome` and `JobVerifier` from `api/src/verification/types.ts` — consumed by `api/src/verification/verificationService.ts` (Task 3) and `api/src/routes/verification.ts` (Task 4).
- Produces: `classifyEvidence(pageText: string): EvidenceClassification` and `stripHtmlToText(html: string): string` from `api/src/verification/evidenceClassifier.ts` — consumed by `pageEvidenceVerifier.ts` in this same task.
- Produces: `pageEvidenceVerifier: JobVerifier` from `api/src/verification/pageEvidenceVerifier.ts` — consumed by `api/src/server.ts` (Task 4).

- [ ] **Step 1: Create the shared types (no test needed — this is a pure type-only file)**

`api/src/verification/types.ts`:

```ts
export interface VerificationOutcome {
  status: 'verified' | 'rejected' | 'inconclusive'
  httpStatus: number | null
  evidence: string | null
}

export type JobVerifier = (url: string) => Promise<VerificationOutcome>
```

- [ ] **Step 2: Write the failing tests for `classifyEvidence` and `stripHtmlToText`**

`api/test/verification/evidenceClassifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifyEvidence, stripHtmlToText } from '../../src/verification/evidenceClassifier'

describe('classifyEvidence', () => {
  it('classifies positive evidence as verified', () => {
    const result = classifyEvidence('Join our team! Apply now to get started.')
    expect(result).toEqual({ status: 'verified', evidence: 'apply now' })
  })

  it('classifies negative evidence as rejected', () => {
    const result = classifyEvidence('Thank you for your interest — this position has been filled.')
    expect(result).toEqual({ status: 'rejected', evidence: 'position has been filled' })
  })

  it('prefers negative evidence over positive evidence when both are present', () => {
    const result = classifyEvidence(
      'This position has been filled. You can still apply now to similar roles.'
    )
    expect(result).toEqual({ status: 'rejected', evidence: 'position has been filled' })
  })

  it('classifies as inconclusive when no evidence pattern matches', () => {
    const result = classifyEvidence('A generic page with no hiring language at all.')
    expect(result).toEqual({ status: 'inconclusive', evidence: null })
  })
})

describe('stripHtmlToText', () => {
  it('removes script and style blocks entirely, strips remaining tags, and collapses whitespace', () => {
    const html =
      '<html><head><style>.x{color:red}</style></head>' +
      '<body><script>var x=1;</script><h1>Apply   Now</h1><p>Join us!</p></body></html>'
    const text = stripHtmlToText(html)
    expect(text).not.toContain('color:red')
    expect(text).not.toContain('var x=1')
    expect(text).toContain('Apply Now')
    expect(text).toContain('Join us!')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/verification/evidenceClassifier` does not exist.

- [ ] **Step 4: Implement the evidence classifier**

`api/src/verification/evidenceClassifier.ts`:

```ts
export interface EvidenceClassification {
  status: 'verified' | 'rejected' | 'inconclusive'
  evidence: string | null
}

export const NEGATIVE_EVIDENCE_PATTERNS: string[] = [
  'no longer accepting applications',
  'position has been filled',
  'this position is no longer available',
  'this job has expired',
  'this listing has expired',
  'applications are now closed',
  'job not found',
  'page not found',
]

export const POSITIVE_EVIDENCE_PATTERNS: string[] = [
  'apply now',
  'apply for this job',
  'apply for this position',
  'submit your application',
  'apply today',
  'easy apply',
]

export function classifyEvidence(pageText: string): EvidenceClassification {
  const lowered = pageText.toLowerCase()

  for (const pattern of NEGATIVE_EVIDENCE_PATTERNS) {
    if (lowered.includes(pattern)) {
      return { status: 'rejected', evidence: pattern }
    }
  }

  for (const pattern of POSITIVE_EVIDENCE_PATTERNS) {
    if (lowered.includes(pattern)) {
      return { status: 'verified', evidence: pattern }
    }
  }

  return { status: 'inconclusive', evidence: null }
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (the 5 new tests, plus all 39 existing api tests — 44 total so far)

- [ ] **Step 6: Write the failing tests for `pageEvidenceVerifier`**

`api/test/verification/pageEvidenceVerifier.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { pageEvidenceVerifier } from '../../src/verification/pageEvidenceVerifier'

describe('pageEvidenceVerifier', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects immediately on a 404 without reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))

    const outcome = await pageEvidenceVerifier('https://verify-404.test/job/1')

    expect(outcome).toEqual({ status: 'rejected', httpStatus: 404, evidence: 'HTTP 404' })
  })

  it('rejects immediately on a 410', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 410 })))

    const outcome = await pageEvidenceVerifier('https://verify-410.test/job/1')

    expect(outcome).toEqual({ status: 'rejected', httpStatus: 410, evidence: 'HTTP 410' })
  })

  it('is inconclusive on a non-2xx, non-gone status, without reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    const outcome = await pageEvidenceVerifier('https://verify-503.test/job/1')

    expect(outcome).toEqual({ status: 'inconclusive', httpStatus: 503, evidence: 'HTTP 503' })
  })

  it('verifies on a 200 page with positive evidence', async () => {
    const html = '<html><body><h1>Apply Now</h1></body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })))

    const outcome = await pageEvidenceVerifier('https://verify-apply.test/job/1')

    expect(outcome).toEqual({ status: 'verified', httpStatus: 200, evidence: 'apply now' })
  })

  it('rejects on a 200 page with negative evidence', async () => {
    const html = '<html><body><p>This position has been filled.</p></body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })))

    const outcome = await pageEvidenceVerifier('https://verify-filled.test/job/1')

    expect(outcome).toEqual({ status: 'rejected', httpStatus: 200, evidence: 'position has been filled' })
  })

  it('is inconclusive on a 200 page with neither positive nor negative evidence', async () => {
    const html = '<html><body><p>A generic page.</p></body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })))

    const outcome = await pageEvidenceVerifier('https://verify-generic.test/job/1')

    expect(outcome).toEqual({ status: 'inconclusive', httpStatus: 200, evidence: null })
  })

  it('is inconclusive when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')))

    const outcome = await pageEvidenceVerifier('https://verify-network-error.test/job/1')

    expect(outcome).toEqual({ status: 'inconclusive', httpStatus: null, evidence: 'network unreachable' })
  })
})
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/verification/pageEvidenceVerifier` does not exist.

- [ ] **Step 8: Implement the page-evidence verifier**

`api/src/verification/pageEvidenceVerifier.ts`:

```ts
import { fetchWithPolicy } from '../discovery/fetchWithPolicy'
import { classifyEvidence, stripHtmlToText } from './evidenceClassifier'
import type { JobVerifier, VerificationOutcome } from './types'

const GONE_STATUS_CODES = new Set([404, 410])

export const pageEvidenceVerifier: JobVerifier = async (url: string): Promise<VerificationOutcome> => {
  try {
    const res = await fetchWithPolicy(url)

    if (GONE_STATUS_CODES.has(res.status)) {
      return { status: 'rejected', httpStatus: res.status, evidence: `HTTP ${res.status}` }
    }
    if (!res.ok) {
      return { status: 'inconclusive', httpStatus: res.status, evidence: `HTTP ${res.status}` }
    }

    const html = await res.text()
    const classification = classifyEvidence(stripHtmlToText(html))
    return { status: classification.status, httpStatus: res.status, evidence: classification.evidence }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    return { status: 'inconclusive', httpStatus: null, evidence: message }
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (51 total: 44 + 7 new, plus confirm no existing test regressed since each new test uses its own distinct hostname per the Global Constraints rule)

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add api/src/verification/types.ts api/src/verification/evidenceClassifier.ts api/src/verification/pageEvidenceVerifier.ts api/test/verification/evidenceClassifier.test.ts api/test/verification/pageEvidenceVerifier.test.ts
git commit -m "Add verification types, evidence classifier, and page-evidence verifier"
```

---

### Task 3: Verification service (query, verify, update, per-job error isolation)

**Files:**
- Create: `api/src/verification/verificationService.ts`
- Test: `api/test/verification/verificationService.test.ts`

**Interfaces:**
- Consumes: `JobVerifier`, `VerificationOutcome` (Task 2), `connectMongo` (M1 Task 3, for the test's `mongodb-memory-server` setup), `ensureJobIndexes` (M2 Task 6, reused as-is — verification doesn't add new indexes).
- Produces: `runVerification(db: Db, verifier: JobVerifier): Promise<VerificationResult>` (`VerificationResult = { checked: number, verified: number, rejected: number, inconclusive: number, errors: Array<{ jobId: string, message: string }> }`) from `api/src/verification/verificationService.ts` — consumed by `api/src/routes/verification.ts` (Task 4).

- [ ] **Step 1: Write the failing test**

`api/test/verification/verificationService.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { ensureJobIndexes } from '../../src/discovery/discoveryService'
import { runVerification } from '../../src/verification/verificationService'
import type { JobVerifier, VerificationOutcome } from '../../src/verification/types'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function fixedVerifier(outcome: VerificationOutcome): JobVerifier {
  return async () => outcome
}

async function insertDiscoveredJob(db: Db, overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId: '1',
    normalizedUrl: 'https://remoteok.com/remote-jobs/1',
    title: 'Backend Engineer',
    company: 'Acme',
    rawDescription: 'desc',
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: null,
    status: 'discovered',
    discoveredAt: now,
    updatedAt: now,
    verifiedAt: null,
    verificationEvidence: null,
    ...overrides,
  })
}

describe('runVerification', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
  })

  afterAll(async () => {
    await mongod.stop()
  })

  beforeEach(async () => {
    const conn = await connectMongo(mongod.getUri(), uniqueDbName())
    client = conn.client
    db = conn.db
    await ensureJobIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('marks a discovered job verified and records evidence', async () => {
    await insertDiscoveredJob(db)
    const verifier = fixedVerifier({ status: 'verified', httpStatus: 200, evidence: 'apply now' })

    const result = await runVerification(db, verifier)

    expect(result).toEqual({ checked: 1, verified: 1, rejected: 0, inconclusive: 0, errors: [] })
    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.status).toBe('verified')
    expect(stored?.verificationEvidence).toBe('apply now')
    expect(stored?.verifiedAt).not.toBeNull()
  })

  it('marks a discovered job rejected and records evidence', async () => {
    await insertDiscoveredJob(db)
    const verifier = fixedVerifier({
      status: 'rejected',
      httpStatus: 200,
      evidence: 'position has been filled',
    })

    const result = await runVerification(db, verifier)

    expect(result).toEqual({ checked: 1, verified: 0, rejected: 1, inconclusive: 0, errors: [] })
    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.status).toBe('rejected')
  })

  it('leaves status unchanged on an inconclusive outcome but records the check', async () => {
    await insertDiscoveredJob(db)
    const verifier = fixedVerifier({ status: 'inconclusive', httpStatus: 200, evidence: null })

    const result = await runVerification(db, verifier)

    expect(result).toEqual({ checked: 1, verified: 0, rejected: 0, inconclusive: 1, errors: [] })
    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.status).toBe('discovered')
    expect(stored?.verifiedAt).not.toBeNull()
  })

  it('does not re-check a job that is already verified or rejected', async () => {
    await insertDiscoveredJob(db, { sourceJobId: '1', status: 'verified' })
    await insertDiscoveredJob(db, { sourceJobId: '2', normalizedUrl: 'https://remoteok.com/remote-jobs/2' })
    const verifier = fixedVerifier({ status: 'verified', httpStatus: 200, evidence: 'apply now' })

    const result = await runVerification(db, verifier)

    expect(result.checked).toBe(1)
  })

  it('isolates one job verifier failure from the rest', async () => {
    await insertDiscoveredJob(db, { sourceJobId: '1', normalizedUrl: 'https://remoteok.com/remote-jobs/1' })
    await insertDiscoveredJob(db, { sourceJobId: '2', normalizedUrl: 'https://remoteok.com/remote-jobs/2' })

    const verifier: JobVerifier = async (url: string) => {
      if (url === 'https://remoteok.com/remote-jobs/1') {
        throw new Error('boom')
      }
      return { status: 'verified', httpStatus: 200, evidence: 'apply now' }
    }

    const result = await runVerification(db, verifier)

    expect(result.verified).toBe(1)
    expect(result.errors).toEqual([{ jobId: 'remoteok:1', message: 'boom' }])
    const untouched = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(untouched?.status).toBe('discovered')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/verification/verificationService` does not exist.

- [ ] **Step 3: Implement the service**

`api/src/verification/verificationService.ts`:

```ts
import type { Db } from 'mongodb'
import type { Job } from '@job-hunter/shared'
import type { JobVerifier } from './types'

export interface VerificationResult {
  checked: number
  verified: number
  rejected: number
  inconclusive: number
  errors: Array<{ jobId: string; message: string }>
}

export async function runVerification(db: Db, verifier: JobVerifier): Promise<VerificationResult> {
  const jobs = db.collection<Job>('jobs')
  const discoveredJobs = await jobs.find({ status: 'discovered' }).toArray()

  let verified = 0
  let rejected = 0
  let inconclusive = 0
  const errors: VerificationResult['errors'] = []

  for (const job of discoveredJobs) {
    const jobKey = { sourceId: job.sourceId, sourceJobId: job.sourceJobId }

    try {
      const outcome = await verifier(job.normalizedUrl)
      const now = new Date().toISOString()

      if (outcome.status === 'inconclusive') {
        inconclusive += 1
        await jobs.updateOne(jobKey, {
          $set: { verifiedAt: now, verificationEvidence: outcome.evidence, updatedAt: now },
        })
        continue
      }

      if (outcome.status === 'verified') {
        verified += 1
      } else {
        rejected += 1
      }

      await jobs.updateOne(jobKey, {
        $set: {
          status: outcome.status,
          verifiedAt: now,
          verificationEvidence: outcome.evidence,
          updatedAt: now,
        },
      })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      errors.push({ jobId: `${job.sourceId}:${job.sourceJobId}`, message })
    }
  }

  return { checked: discoveredJobs.length, verified, rejected, inconclusive, errors }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (56 total: 51 + 5 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/verification/verificationService.ts api/test/verification/verificationService.test.ts
git commit -m "Add verification service with per-job error isolation"
```

---

### Task 4: Verification route and server wiring

**Files:**
- Create: `api/src/routes/verification.ts`
- Modify: `api/src/server.ts`
- Test: `api/test/verification.test.ts`

**Interfaces:**
- Consumes: `createRequireAuth`/`AuthVariables` (M1 Task 6), `runVerification` (Task 3), `JobVerifier` (Task 2), `pageEvidenceVerifier` (Task 2).
- Produces: `createVerificationRoutes(db: Db, jwtSecret: string, verifier: JobVerifier): Hono` — a DI factory like `createDiscoveryRoutes`, so tests inject a fake verifier instead of hitting the network. Endpoint: `POST /verification/run` → `200` with `VerificationResult` JSON. Requires `Authorization: Bearer <token>`; absent/invalid token → `401` (via `createRequireAuth`, already tested in M1 Task 6 and M2 Task 7). Mounted at `/verification` in `api/src/server.ts`, wired with the real `pageEvidenceVerifier`.

- [ ] **Step 1: Write the failing test**

`api/test/verification.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createVerificationRoutes } from '../src/routes/verification'
import { ensureJobIndexes } from '../src/discovery/discoveryService'
import type { JobVerifier } from '../src/verification/types'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const fakeVerifier: JobVerifier = async () => ({
  status: 'verified',
  httpStatus: 200,
  evidence: 'apply now',
})

interface AuthResponseBody {
  token: string
}

interface VerificationResponseBody {
  checked: number
  verified: number
  rejected: number
  inconclusive: number
  errors: unknown[]
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'verification-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

describe('verification routes', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let app: Hono

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
  })

  afterAll(async () => {
    await mongod.stop()
  })

  beforeEach(async () => {
    const conn = await connectMongo(mongod.getUri(), uniqueDbName())
    client = conn.client
    db = conn.db
    await ensureJobIndexes(db)

    const now = new Date().toISOString()
    await db.collection('jobs').insertOne({
      sourceId: 'remoteok',
      sourceJobId: '1',
      normalizedUrl: 'https://remoteok.com/remote-jobs/1',
      title: 'Engineer',
      company: 'Acme',
      rawDescription: 'desc',
      location: null,
      salaryMin: null,
      salaryMax: null,
      postedAt: null,
      status: 'discovered',
      discoveredAt: now,
      updatedAt: now,
      verifiedAt: null,
      verificationEvidence: null,
    })

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/verification', createVerificationRoutes(db, JWT_SECRET, fakeVerifier))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/verification/run', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('runs verification and returns counts', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/verification/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as VerificationResponseBody
    expect(body.checked).toBe(1)
    expect(body.verified).toBe(1)
    expect(body.rejected).toBe(0)
    expect(body.inconclusive).toBe(0)
    expect(body.errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../src/routes/verification` does not exist.

- [ ] **Step 3: Implement the route**

`api/src/routes/verification.ts`:

```ts
import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireAuth, type AuthVariables } from '../middleware/auth'
import { runVerification } from '../verification/verificationService'
import type { JobVerifier } from '../verification/types'

export function createVerificationRoutes(db: Db, jwtSecret: string, verifier: JobVerifier) {
  const verificationRoutes = new Hono<{ Variables: AuthVariables }>()
  verificationRoutes.use('*', createRequireAuth(jwtSecret))

  verificationRoutes.post('/run', async (c) => {
    const result = await runVerification(db, verifier)
    return c.json(result)
  })

  return verificationRoutes
}
```

- [ ] **Step 4: Wire the server composition root**

`api/src/server.ts`:

```ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { connectMongo } from './db'
import { createAuthRoutes } from './routes/auth'
import { createProfileRoutes } from './routes/profile'
import { createDiscoveryRoutes } from './routes/discovery'
import { createVerificationRoutes } from './routes/verification'
import { ensureJobIndexes } from './discovery/discoveryService'
import { remoteOkSource } from './discovery/sources/remoteok'
import { weWorkRemotelySource } from './discovery/sources/weworkremotely'
import { himalayasSource } from './discovery/sources/himalayas'
import { pageEvidenceVerifier } from './verification/pageEvidenceVerifier'

async function main() {
  const mongodbUri = process.env.MONGODB_URI
  const jwtSecret = process.env.JWT_SECRET
  if (!mongodbUri) throw new Error('MONGODB_URI is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')

  const { db } = await connectMongo(mongodbUri, process.env.MONGODB_DB_NAME ?? 'job_hunter')
  await ensureJobIndexes(db)

  const app = createApp()
  app.route('/auth', createAuthRoutes(db, jwtSecret))
  app.route('/profile', createProfileRoutes(db, jwtSecret))
  app.route(
    '/discovery',
    createDiscoveryRoutes(db, jwtSecret, [remoteOkSource, weWorkRemotelySource, himalayasSource])
  )
  app.route('/verification', createVerificationRoutes(db, jwtSecret, pageEvidenceVerifier))

  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`API listening on http://localhost:${port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (58 total: 56 + 2 new)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/verification.ts api/src/server.ts api/test/verification.test.ts
git commit -m "Add verification route and wire the page-evidence verifier into the server"
```

---

## M3a Definition of Done

- `npm test` passes across `api` (58 tests) and `shared` (12 tests) — 70 total.
- `npm run typecheck` and `npm run build` pass across all three workspaces (dashboard is untouched by this plan — no new dashboard work).
- Manual smoke test: start the api (`npm run dev --workspace=api` against local Mongo), register/login to get a token, run a discovery sweep first (`POST /discovery/run`) so there are `discovered` jobs, then `curl -X POST http://localhost:8787/verification/run -H "Authorization: Bearer <token>"` returns a `{checked, verified, rejected, inconclusive, errors}` JSON body, and the `jobs` collection shows updated `status`/`verifiedAt`/`verificationEvidence` fields on the checked documents. A second identical run returns `checked: 0` (every job that was `discovered` is now `verified`/`rejected`, or still `inconclusive`-but-unchanged-status and thus still counted next time only if still `discovered` — confirm this matches the status-filter's intent during the smoke test).
- Explicitly NOT in scope for M3a (deferred to later plans): Claude-based scoring/matching (M3b), materials generation, automation engine, `node-cron`/queue worker and scheduled re-verification, dashboard UI for jobs/verification, CI, deployment.
