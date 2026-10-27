# M5a — Application State Machine and Approval Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data model and the approval gate itself — `applications`, `automationRuns`, `approvals`, and an append-only `auditLog` — so that no code path anywhere can mark an application `submitted` without an explicit approval record tied to the exact automation run being approved, with every required answer already resolved. No browser automation exists yet; this plan builds the safety machinery the automation engine (M5b) will have to go through.

**Architecture:** An `applicationsService` creates one `applications` record per job, duplicate-guarded two ways: a unique index on `jobId` (can't create two records for the literal same job), and an independent check against `company`+`title` within a 60-day window (so a job that slipped past M2's own ingest-level dedupe still can't be double-applied-to — the design spec calls this out explicitly as a second, independent guard). An `automationRunsService` records the outcome of one form-fill attempt (`recordRunResult` — called by M5b once it exists, but exercised directly by this plan's own tests via a fake result, since the gate logic doesn't care how a run's result was produced) and exposes the gate itself as a pure, directly-testable function: `canSubmit(application, run, approval)`. `approveRun` is the only way an `approvals` record gets created, and it only flips a run to `'approved'` when `canSubmit` says yes — never unconditionally. Every state-changing action writes one entry to an append-only `auditLog` collection.

**Scope decision — this plan builds the gate, not the automation.** The design spec's "Automation and the approval gate" section describes both the Playwright form-filling engine and the gate that must block it from ever auto-submitting. Those are different kinds of work: the gate is pure state-machine logic, deterministic and fully unit-testable without a browser; the automation engine is inherently harder to test deterministically (real pages, real DOM, CAPTCHA detection, confirmation-page detection) and belongs in its own plan (M5b) once this gate already exists for it to report into. Building the gate first and proving it can't be bypassed — before the thing it's meant to constrain exists — is the safer order for code whose stated purpose is "there is no code path that skips this gate."

**Scope decision — "approval" and "confirmation" are the same persisted fact.** The spec's gate description names three conditions: an explicit `approvals` record, all required answers resolved, and "a user click confirming the specific automation run." This plan treats the third condition as *how* the first one comes to exist, not as a fourth, separately-persisted fact — the `approvals` record created by `POST /applications/:jobId/runs/:runNumber/approve` **is** the record of that click, tied to one exact `(jobId, runNumber)` pair so it can never be reused to authorize a different run. If a future plan needs a genuinely separate "reviewed" step before the final "submit" click, add a field to the existing `approvals` record rather than inventing a fourth collection.

**Tech Stack:** Same as M1-M4b (TypeScript strict, Hono 4, `mongodb` driver 6, Zod 3, Vitest + `mongodb-memory-server`). No new npm dependencies — this plan is pure data model and state-machine logic.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md` (see "Automation and the approval gate" — this plan implements the gate; the Playwright engine itself is M5b)

## Global Constraints

- Node.js 22 (pinned via `.nvmrc` — verify `node --version` prints v22.x before trusting any test run).
- TypeScript strict mode everywhere.
- `api`/`shared` tests use Vitest; MongoDB-touching tests use a real `mongodb-memory-server` instance — every test in this plan touches Mongo, since this entire plan *is* the state machine.
- **There is no code path that marks an `automationRuns` record `'submitted'` in this plan.** The furthest any run can reach here is `'approved'` — actually driving a submission is M5b's job, and M5b's own code must still go through `canSubmit` (exported from this plan) before it does anything irreversible. This plan's job is to make `canSubmit` the single, unavoidable gate — not to call it from inside a submission action that doesn't exist yet.
- `jobId` throughout this plan is the same `${sourceId}:${sourceJobId}` composite string convention M3a/M3b/M4b already use — never a MongoDB `_id`, for the same reason as before (the shared types declare `_id: string` while the driver generates `ObjectId`).
- `npm run typecheck --workspace=api` (and `--workspace=shared`) must exit 0 clean after every task.
- `POST /applications`, `GET /applications/:jobId`, and `POST /applications/:jobId/runs/:runNumber/approve` all require the same bearer-token auth as every other route (`createRequireAuth`).
- Package manager: npm workspaces (unchanged).

---

### Task 1: Shared schemas for Application, AutomationRun, and Approval

**Files:**
- Create: `shared/src/schemas/applications.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/applications-schema.test.ts`

**Interfaces:**
- Produces: `RequiredAnswerSchema`, `ApplicationStatusSchema`, `ApplicationSchema`, `AutomationRunStatusSchema`, `AutomationRunSchema`, `ApprovalSchema` (and their inferred types `RequiredAnswer`, `ApplicationStatus`, `Application`, `AutomationRunStatus`, `AutomationRun`, `Approval`) from `shared/src/schemas/applications.ts` — consumed by every task in this plan.

- [ ] **Step 1: Write the failing tests**

`shared/test/applications-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ApplicationSchema, AutomationRunSchema, ApprovalSchema } from '../src/index'

describe('ApplicationSchema', () => {
  const VALID_APPLICATION = {
    jobId: 'remoteok:12345',
    company: 'Acme',
    title: 'Backend Engineer',
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
  }

  it('accepts a valid draft application', () => {
    expect(ApplicationSchema.safeParse(VALID_APPLICATION).success).toBe(true)
  })

  it('accepts an application with unresolved required answers', () => {
    const result = ApplicationSchema.safeParse({
      ...VALID_APPLICATION,
      requiredAnswers: [{ question: 'Why do you want this role?', answer: null }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown status value', () => {
    const result = ApplicationSchema.safeParse({ ...VALID_APPLICATION, status: 'pending' })
    expect(result.success).toBe(false)
  })
})

describe('AutomationRunSchema', () => {
  it('accepts a valid blocked run', () => {
    const result = AutomationRunSchema.safeParse({
      jobId: 'remoteok:12345',
      runNumber: 1,
      status: 'blocked',
      filledFields: null,
      blockReason: 'captcha',
      manualApplyUrl: 'https://remoteok.com/remote-jobs/12345',
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a runNumber of zero', () => {
    const result = AutomationRunSchema.safeParse({
      jobId: 'remoteok:12345',
      runNumber: 0,
      status: 'claimed',
      filledFields: null,
      blockReason: null,
      manualApplyUrl: null,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('ApprovalSchema', () => {
  it('accepts a valid approval record', () => {
    const result = ApprovalSchema.safeParse({
      jobId: 'remoteok:12345',
      runNumber: 1,
      approvedBy: 'profile-id-123',
      approvedAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=shared`
Expected: FAIL — `../src/index` has no `ApplicationSchema`/`AutomationRunSchema`/`ApprovalSchema` exports yet.

- [ ] **Step 3: Implement the schemas**

`shared/src/schemas/applications.ts`:

```ts
import { z } from 'zod'

export const RequiredAnswerSchema = z.object({
  question: z.string(),
  answer: z.string().nullable(),
})

export const ApplicationStatusSchema = z.enum(['draft', 'ready', 'submitted', 'failed'])

export const ApplicationSchema = z.object({
  _id: z.string().optional(),
  jobId: z.string(),
  company: z.string(),
  title: z.string(),
  status: ApplicationStatusSchema,
  materialsVersion: z.number().int().positive().nullable(),
  requiredAnswers: z.array(RequiredAnswerSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const AutomationRunStatusSchema = z.enum([
  'claimed',
  'filled',
  'blocked',
  'ready_for_approval',
  'approved',
  'submitted',
  'failed',
])

export const AutomationRunSchema = z.object({
  _id: z.string().optional(),
  jobId: z.string(),
  runNumber: z.number().int().positive(),
  status: AutomationRunStatusSchema,
  filledFields: z.record(z.string(), z.string()).nullable(),
  blockReason: z.string().nullable(),
  manualApplyUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ApprovalSchema = z.object({
  _id: z.string().optional(),
  jobId: z.string(),
  runNumber: z.number().int().positive(),
  approvedBy: z.string(),
  approvedAt: z.string(),
})

export type RequiredAnswer = z.infer<typeof RequiredAnswerSchema>
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>
export type Application = z.infer<typeof ApplicationSchema>
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>
export type AutomationRun = z.infer<typeof AutomationRunSchema>
export type Approval = z.infer<typeof ApprovalSchema>
```

`shared/src/index.ts` (add one line):

```ts
export * from './schemas/auth'
export * from './schemas/profile'
export * from './schemas/job'
export * from './schemas/materials'
export * from './schemas/applications'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=shared`
Expected: PASS (25 tests total: 19 existing + 6 new — 3 `ApplicationSchema` tests + 2 `AutomationRunSchema` tests + 1 `ApprovalSchema` test)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=shared`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/applications.ts shared/src/index.ts shared/test/applications-schema.test.ts
git commit -m "Add shared Application, AutomationRun, and Approval schemas"
```

---

### Task 2: Append-only audit log

**Files:**
- Create: `api/src/applications/auditLog.ts`
- Test: `api/test/applications/auditLog.test.ts`

**Interfaces:**
- Produces: `AuditEntry` (`{ action: string; jobId: string | null; runNumber: number | null; actorProfileId: string | null; details: Record<string, unknown> }`) and `writeAuditLog(db: Db, entry: AuditEntry): Promise<void>` from `api/src/applications/auditLog.ts` — consumed by `api/src/applications/applicationsService.ts` (Task 3) and `api/src/applications/automationRunsService.ts` (Task 4).

- [ ] **Step 1: Write the failing test**

`api/test/applications/auditLog.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { writeAuditLog } from '../../src/applications/auditLog'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

describe('writeAuditLog', () => {
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
  })

  afterEach(async () => {
    await client.close()
  })

  it('writes an entry with a timestamp to the auditLog collection', async () => {
    await writeAuditLog(db, {
      action: 'application_created',
      jobId: 'remoteok:1',
      runNumber: null,
      actorProfileId: 'profile-1',
      details: { company: 'Acme' },
    })

    const stored = await db.collection('auditLog').findOne({ action: 'application_created' })
    expect(stored?.jobId).toBe('remoteok:1')
    expect(stored?.actorProfileId).toBe('profile-1')
    expect(stored?.details).toEqual({ company: 'Acme' })
    expect(typeof stored?.at).toBe('string')
  })

  it('allows a null jobId, runNumber, and actorProfileId for system-initiated entries', async () => {
    await writeAuditLog(db, {
      action: 'automation_run_recorded',
      jobId: null,
      runNumber: null,
      actorProfileId: null,
      details: {},
    })

    const stored = await db.collection('auditLog').findOne({ action: 'automation_run_recorded' })
    expect(stored?.jobId).toBeNull()
    expect(stored?.actorProfileId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/applications/auditLog` does not exist.

- [ ] **Step 3: Implement the audit log**

`api/src/applications/auditLog.ts`:

```ts
import type { Db } from 'mongodb'

export interface AuditEntry {
  action: string
  jobId: string | null
  runNumber: number | null
  actorProfileId: string | null
  details: Record<string, unknown>
}

export async function writeAuditLog(db: Db, entry: AuditEntry): Promise<void> {
  await db.collection('auditLog').insertOne({ ...entry, at: new Date().toISOString() })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (118 total: 116 + 2 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/applications/auditLog.ts api/test/applications/auditLog.test.ts
git commit -m "Add append-only audit log"
```

---

### Task 3: Applications service (duplicate-guarded creation)

**Files:**
- Create: `api/src/applications/applicationsService.ts`
- Test: `api/test/applications/applicationsService.test.ts`

**Interfaces:**
- Consumes: `writeAuditLog` (Task 2), `Application` (Task 1, from `@job-hunter/shared`), `connectMongo` (M1, for the test's `mongodb-memory-server` setup).
- Produces: `ensureApplicationIndexes(db: Db): Promise<void>` and `createApplication(db: Db, jobKey: { sourceId: string; sourceJobId: string }, actorProfileId: string): Promise<Application>` from `api/src/applications/applicationsService.ts` — consumed by `api/src/routes/applications.ts` (Task 5). Throws if the job doesn't exist, if an application for that exact job already exists, or if an application for the same company+title was created within the last 60 days.

- [ ] **Step 1: Write the failing test**

`api/test/applications/applicationsService.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { createApplication, ensureApplicationIndexes } from '../../src/applications/applicationsService'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function insertJob(db: Db, overrides: Partial<Record<string, unknown>> = {}) {
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
    status: 'verified',
    discoveredAt: now,
    updatedAt: now,
    verifiedAt: now,
    verificationEvidence: 'apply now',
    contentHash: null,
    extractedRequirements: null,
    extractedAt: null,
    score: null,
    scoreBreakdown: null,
    scoredAt: null,
    ...overrides,
  })
}

describe('createApplication', () => {
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
    await ensureApplicationIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('creates a draft application for an existing job', async () => {
    await insertJob(db)
    const application = await createApplication(
      db,
      { sourceId: 'remoteok', sourceJobId: '1' },
      'profile-1'
    )

    expect(application.jobId).toBe('remoteok:1')
    expect(application.status).toBe('draft')
    expect(application.requiredAnswers).toEqual([])
  })

  it('throws when the job does not exist', async () => {
    await expect(
      createApplication(db, { sourceId: 'remoteok', sourceJobId: 'missing' }, 'profile-1')
    ).rejects.toThrow('job not found')
  })

  it('throws when an application already exists for the exact same job', async () => {
    await insertJob(db)
    await createApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 'profile-1')

    await expect(
      createApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 'profile-1')
    ).rejects.toThrow('already exists')
  })

  it('throws when a different job with the same company and title was applied to recently', async () => {
    await insertJob(db, { sourceJobId: '1', normalizedUrl: 'https://remoteok.com/remote-jobs/1' })
    await createApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 'profile-1')

    await insertJob(db, {
      sourceJobId: '2',
      normalizedUrl: 'https://remoteok.com/remote-jobs/2',
      company: 'Acme',
      title: 'Backend Engineer',
    })

    await expect(
      createApplication(db, { sourceId: 'remoteok', sourceJobId: '2' }, 'profile-1')
    ).rejects.toThrow('already exists within the last 60 days')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/applications/applicationsService` does not exist.

- [ ] **Step 3: Implement the service**

`api/src/applications/applicationsService.ts`:

```ts
import type { Db } from 'mongodb'
import type { Application } from '@job-hunter/shared'
import { writeAuditLog } from './auditLog'

const DUPLICATE_WINDOW_DAYS = 60

export async function ensureApplicationIndexes(db: Db): Promise<void> {
  await db.collection('applications').createIndex({ jobId: 1 }, { unique: true })
}

export async function createApplication(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string },
  actorProfileId: string
): Promise<Application> {
  const jobId = `${jobKey.sourceId}:${jobKey.sourceJobId}`
  const applications = db.collection<Application>('applications')

  const existingForJob = await applications.findOne({ jobId })
  if (existingForJob) {
    throw new Error(`an application already exists for job ${jobId}`)
  }

  const job = await db.collection('jobs').findOne(jobKey)
  if (!job) {
    throw new Error(`job not found: ${jobId}`)
  }

  const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const existingForCompanyTitle = await applications.findOne({
    company: job.company,
    title: job.title,
    createdAt: { $gte: cutoff },
  })
  if (existingForCompanyTitle) {
    throw new Error(
      `an application for ${job.company} / ${job.title} already exists within the last ${DUPLICATE_WINDOW_DAYS} days`
    )
  }

  const now = new Date().toISOString()
  const application: Application = {
    jobId,
    company: job.company,
    title: job.title,
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: now,
    updatedAt: now,
  }
  await applications.insertOne(application)
  await writeAuditLog(db, {
    action: 'application_created',
    jobId,
    runNumber: null,
    actorProfileId,
    details: { company: job.company, title: job.title },
  })

  return application
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (122 total: 118 + 4 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/applications/applicationsService.ts api/test/applications/applicationsService.test.ts
git commit -m "Add applications service with two-layer duplicate guard"
```

---

### Task 4: Automation runs and the approval gate

**Files:**
- Create: `api/src/applications/automationRunsService.ts`
- Test: `api/test/applications/automationRunsService.test.ts`

**Interfaces:**
- Consumes: `writeAuditLog` (Task 2), `Application`, `AutomationRun`, `Approval` (Task 1, from `@job-hunter/shared`).
- Produces: `ensureAutomationRunIndexes(db: Db): Promise<void>`, `recordRunResult(db: Db, jobId: string, result: RunResultInput): Promise<AutomationRun>` (`RunResultInput = { status: 'filled' | 'blocked'; filledFields: Record<string, string> | null; blockReason: string | null; manualApplyUrl: string | null }`), `canSubmit(application: Application, run: AutomationRun, approval: Approval | null): boolean` (pure — no I/O), and `approveRun(db: Db, jobId: string, runNumber: number, actorProfileId: string): Promise<{ approved: boolean; reason: string | null }>` from `api/src/applications/automationRunsService.ts` — consumed by `api/src/routes/applications.ts` (Task 5), and `recordRunResult`/`canSubmit` will also be consumed directly by M5b's Playwright engine once it exists.

- [ ] **Step 1: Write the failing test**

`api/test/applications/automationRunsService.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import {
  approveRun,
  canSubmit,
  ensureAutomationRunIndexes,
  recordRunResult,
} from '../../src/applications/automationRunsService'
import { ensureApplicationIndexes } from '../../src/applications/applicationsService'
import type { Application, AutomationRun, Approval } from '@job-hunter/shared'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function baseApplication(overrides: Partial<Application> = {}): Application {
  const now = new Date().toISOString()
  return {
    jobId: 'remoteok:1',
    company: 'Acme',
    title: 'Backend Engineer',
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function baseRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  const now = new Date().toISOString()
  return {
    jobId: 'remoteok:1',
    runNumber: 1,
    status: 'ready_for_approval',
    filledFields: { name: 'Jane Doe' },
    blockReason: null,
    manualApplyUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('recordRunResult', () => {
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
    await ensureAutomationRunIndexes(db)
    await ensureApplicationIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('creates run number 1 as ready_for_approval when the fields were filled', async () => {
    const run = await recordRunResult(db, 'remoteok:1', {
      status: 'filled',
      filledFields: { name: 'Jane Doe' },
      blockReason: null,
      manualApplyUrl: null,
    })

    expect(run.runNumber).toBe(1)
    expect(run.status).toBe('ready_for_approval')
  })

  it('creates a run as blocked with a reason when the fill was blocked', async () => {
    const run = await recordRunResult(db, 'remoteok:1', {
      status: 'blocked',
      filledFields: null,
      blockReason: 'captcha',
      manualApplyUrl: 'https://remoteok.com/remote-jobs/1',
    })

    expect(run.status).toBe('blocked')
    expect(run.blockReason).toBe('captcha')
    expect(run.manualApplyUrl).toBe('https://remoteok.com/remote-jobs/1')
  })

  it('increments the run number on a second call for the same job', async () => {
    await recordRunResult(db, 'remoteok:1', {
      status: 'blocked',
      filledFields: null,
      blockReason: 'captcha',
      manualApplyUrl: null,
    })
    const second = await recordRunResult(db, 'remoteok:1', {
      status: 'filled',
      filledFields: { name: 'Jane Doe' },
      blockReason: null,
      manualApplyUrl: null,
    })

    expect(second.runNumber).toBe(2)
  })
})

describe('canSubmit', () => {
  it('returns false with no approval', () => {
    expect(canSubmit(baseApplication(), baseRun(), null)).toBe(false)
  })

  it('returns false when the approval is for a different run', () => {
    const approval: Approval = {
      jobId: 'remoteok:1',
      runNumber: 2,
      approvedBy: 'profile-1',
      approvedAt: new Date().toISOString(),
    }
    expect(canSubmit(baseApplication(), baseRun({ runNumber: 1 }), approval)).toBe(false)
  })

  it('returns false when the application has an unresolved required answer', () => {
    const approval: Approval = {
      jobId: 'remoteok:1',
      runNumber: 1,
      approvedBy: 'profile-1',
      approvedAt: new Date().toISOString(),
    }
    const application = baseApplication({
      requiredAnswers: [{ question: 'Why this role?', answer: null }],
    })
    expect(canSubmit(application, baseRun(), approval)).toBe(false)
  })

  it('returns true when the approval matches the run and every required answer is resolved', () => {
    const approval: Approval = {
      jobId: 'remoteok:1',
      runNumber: 1,
      approvedBy: 'profile-1',
      approvedAt: new Date().toISOString(),
    }
    const application = baseApplication({
      requiredAnswers: [{ question: 'Why this role?', answer: 'Because I love the mission.' }],
    })
    expect(canSubmit(application, baseRun(), approval)).toBe(true)
  })
})

describe('approveRun', () => {
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
    await ensureAutomationRunIndexes(db)
    await ensureApplicationIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('creates an approval and flips the run to approved when every answer is resolved', async () => {
    await db.collection('applications').insertOne(baseApplication())
    await db.collection('automationRuns').insertOne(baseRun())

    const result = await approveRun(db, 'remoteok:1', 1, 'profile-1')

    expect(result).toEqual({ approved: true, reason: null })
    const run = await db.collection('automationRuns').findOne({ jobId: 'remoteok:1', runNumber: 1 })
    expect(run?.status).toBe('approved')
    const approval = await db.collection('approvals').findOne({ jobId: 'remoteok:1', runNumber: 1 })
    expect(approval?.approvedBy).toBe('profile-1')
  })

  it('records the approval but does not flip the run when a required answer is unresolved', async () => {
    await db.collection('applications').insertOne(
      baseApplication({ requiredAnswers: [{ question: 'Why this role?', answer: null }] })
    )
    await db.collection('automationRuns').insertOne(baseRun())

    const result = await approveRun(db, 'remoteok:1', 1, 'profile-1')

    expect(result.approved).toBe(false)
    const run = await db.collection('automationRuns').findOne({ jobId: 'remoteok:1', runNumber: 1 })
    expect(run?.status).toBe('ready_for_approval')
  })

  it('throws when there is no application or run for the given job and run number', async () => {
    await expect(approveRun(db, 'remoteok:missing', 1, 'profile-1')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/applications/automationRunsService` does not exist.

- [ ] **Step 3: Implement the service**

`api/src/applications/automationRunsService.ts`:

```ts
import type { Db } from 'mongodb'
import type { Application, Approval, AutomationRun } from '@job-hunter/shared'
import { writeAuditLog } from './auditLog'

export async function ensureAutomationRunIndexes(db: Db): Promise<void> {
  await db.collection('automationRuns').createIndex({ jobId: 1, runNumber: 1 }, { unique: true })
  await db.collection('approvals').createIndex({ jobId: 1, runNumber: 1 }, { unique: true })
}

export interface RunResultInput {
  status: 'filled' | 'blocked'
  filledFields: Record<string, string> | null
  blockReason: string | null
  manualApplyUrl: string | null
}

export async function recordRunResult(
  db: Db,
  jobId: string,
  result: RunResultInput
): Promise<AutomationRun> {
  const runs = db.collection<AutomationRun>('automationRuns')
  const latest = await runs.find({ jobId }).sort({ runNumber: -1 }).limit(1).toArray()
  const runNumber = (latest[0]?.runNumber ?? 0) + 1

  const now = new Date().toISOString()
  const resolvedStatus = result.status === 'filled' ? 'ready_for_approval' : 'blocked'
  const run: AutomationRun = {
    jobId,
    runNumber,
    status: resolvedStatus,
    filledFields: result.filledFields,
    blockReason: result.blockReason,
    manualApplyUrl: result.manualApplyUrl,
    createdAt: now,
    updatedAt: now,
  }
  await runs.insertOne(run)
  await writeAuditLog(db, {
    action: 'automation_run_recorded',
    jobId,
    runNumber,
    actorProfileId: null,
    details: { status: resolvedStatus },
  })

  return run
}

export function canSubmit(
  application: Application,
  run: AutomationRun,
  approval: Approval | null
): boolean {
  if (!approval) return false
  if (approval.jobId !== run.jobId || approval.runNumber !== run.runNumber) return false
  if (run.status !== 'ready_for_approval' && run.status !== 'approved') return false
  if (application.requiredAnswers.some((answer) => answer.answer === null)) return false
  return true
}

export async function approveRun(
  db: Db,
  jobId: string,
  runNumber: number,
  actorProfileId: string
): Promise<{ approved: boolean; reason: string | null }> {
  const applications = db.collection<Application>('applications')
  const runs = db.collection<AutomationRun>('automationRuns')
  const approvals = db.collection<Approval>('approvals')

  const application = await applications.findOne({ jobId })
  const run = await runs.findOne({ jobId, runNumber })
  if (!application || !run) {
    throw new Error(`no application or run found for ${jobId} run ${runNumber}`)
  }

  const existingApproval = await approvals.findOne({ jobId, runNumber })
  const approval: Approval =
    existingApproval ?? {
      jobId,
      runNumber,
      approvedBy: actorProfileId,
      approvedAt: new Date().toISOString(),
    }
  if (!existingApproval) {
    await approvals.insertOne(approval)
  }

  const ready = canSubmit(application, run, approval)
  if (!ready) {
    return { approved: false, reason: 'required answers are unresolved or the run is not ready' }
  }

  await runs.updateOne(
    { jobId, runNumber },
    { $set: { status: 'approved', updatedAt: new Date().toISOString() } }
  )
  await writeAuditLog(db, {
    action: 'run_approved',
    jobId,
    runNumber,
    actorProfileId,
    details: {},
  })

  return { approved: true, reason: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (132 total: 122 + 10 new — 3 `recordRunResult` tests + 4 `canSubmit` tests + 3 `approveRun` tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/applications/automationRunsService.ts api/test/applications/automationRunsService.test.ts
git commit -m "Add automation runs service and the approval gate"
```

---

### Task 5: Application routes and server wiring

**Files:**
- Create: `api/src/routes/applications.ts`
- Modify: `api/src/server.ts`
- Test: `api/test/applications.test.ts`

**Interfaces:**
- Consumes: `createRequireAuth`/`AuthVariables` (M1), `createApplication`/`ensureApplicationIndexes` (Task 3), `approveRun`/`ensureAutomationRunIndexes` (Task 4).
- Produces: `createApplicationsRoutes(db: Db, jwtSecret: string): Hono`. Three endpoints: `POST /applications` (body `{ sourceId, sourceJobId }` → `201` with the created application, `409` on any duplicate-guard failure, `400` if the body is malformed); `GET /applications/:jobId` (→ `200` with `{ application, latestRun }`, `latestRun` is `null` if no automation run has happened yet, `404` if no application exists for that `jobId`); `POST /applications/:jobId/runs/:runNumber/approve` (→ `200` with `{ approved, reason }`, `404` if the application or run doesn't exist). Mounted at `/applications` in `api/src/server.ts`.

- [ ] **Step 1: Write the failing test**

`api/test/applications.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createApplicationsRoutes } from '../src/routes/applications'
import { ensureApplicationIndexes } from '../src/applications/applicationsService'
import { ensureAutomationRunIndexes } from '../src/applications/automationRunsService'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

interface AuthResponseBody {
  token: string
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'applications-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

async function insertJob(db: Db) {
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
    status: 'verified',
    discoveredAt: now,
    updatedAt: now,
    verifiedAt: now,
    verificationEvidence: 'apply now',
    contentHash: null,
    extractedRequirements: null,
    extractedAt: null,
    score: null,
    scoreBreakdown: null,
    scoredAt: null,
  })
}

describe('applications routes', () => {
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
    await ensureApplicationIndexes(db)
    await ensureAutomationRunIndexes(db)
    await insertJob(db)

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/applications', createApplicationsRoutes(db, JWT_SECRET))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/applications', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('creates an application', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { jobId: string; status: string }
    expect(body.jobId).toBe('remoteok:1')
    expect(body.status).toBe('draft')
  })

  it('rejects a duplicate application for the same job', async () => {
    const token = await registerAndGetToken(app)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    await app.request('/applications', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })

    const res = await app.request('/applications', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })
    expect(res.status).toBe(409)
  })

  it('gets an application with no automation run yet', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })

    const res = await app.request('/applications/remoteok:1', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { application: { jobId: string }; latestRun: null }
    expect(body.application.jobId).toBe('remoteok:1')
    expect(body.latestRun).toBeNull()
  })

  it('404s when getting an application that does not exist', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/applications/remoteok:missing', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('approving a run with an unresolved required answer does not approve it', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })
    await db
      .collection('applications')
      .updateOne(
        { jobId: 'remoteok:1' },
        { $set: { requiredAnswers: [{ question: 'Why this role?', answer: null }] } }
      )
    const now = new Date().toISOString()
    await db.collection('automationRuns').insertOne({
      jobId: 'remoteok:1',
      runNumber: 1,
      status: 'ready_for_approval',
      filledFields: { name: 'Jane Doe' },
      blockReason: null,
      manualApplyUrl: null,
      createdAt: now,
      updatedAt: now,
    })

    const res = await app.request('/applications/remoteok:1/runs/1/approve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approved: boolean }
    expect(body.approved).toBe(false)
  })

  it('approves a run once every required answer is resolved', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })
    const now = new Date().toISOString()
    await db.collection('automationRuns').insertOne({
      jobId: 'remoteok:1',
      runNumber: 1,
      status: 'ready_for_approval',
      filledFields: { name: 'Jane Doe' },
      blockReason: null,
      manualApplyUrl: null,
      createdAt: now,
      updatedAt: now,
    })

    const res = await app.request('/applications/remoteok:1/runs/1/approve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approved: boolean }
    expect(body.approved).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../src/routes/applications` does not exist.

- [ ] **Step 3: Implement the route**

`api/src/routes/applications.ts`:

```ts
import { Hono } from 'hono'
import type { Db } from 'mongodb'
import type { AutomationRun } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth'
import { createApplication } from '../applications/applicationsService'
import { approveRun } from '../applications/automationRunsService'

export function createApplicationsRoutes(db: Db, jwtSecret: string) {
  const applicationsRoutes = new Hono<{ Variables: AuthVariables }>()
  applicationsRoutes.use('*', createRequireAuth(jwtSecret))

  applicationsRoutes.post('/', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.sourceId !== 'string' || typeof body.sourceJobId !== 'string') {
      return c.json({ error: 'sourceId and sourceJobId are required' }, 400)
    }

    try {
      const application = await createApplication(
        db,
        { sourceId: body.sourceId, sourceJobId: body.sourceJobId },
        c.get('profileId')
      )
      return c.json(application, 201)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'failed to create application'
      return c.json({ error: message }, 409)
    }
  })

  applicationsRoutes.get('/:jobId', async (c) => {
    const jobId = c.req.param('jobId')
    const application = await db.collection('applications').findOne({ jobId })
    if (!application) {
      return c.json({ error: 'application not found' }, 404)
    }

    const latestRun = await db
      .collection<AutomationRun>('automationRuns')
      .find({ jobId })
      .sort({ runNumber: -1 })
      .limit(1)
      .toArray()

    return c.json({ application, latestRun: latestRun[0] ?? null })
  })

  applicationsRoutes.post('/:jobId/runs/:runNumber/approve', async (c) => {
    const jobId = c.req.param('jobId')
    const runNumber = Number(c.req.param('runNumber'))

    try {
      const result = await approveRun(db, jobId, runNumber, c.get('profileId'))
      return c.json(result)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'failed to approve run'
      return c.json({ error: message }, 404)
    }
  })

  return applicationsRoutes
}
```

- [ ] **Step 4: Wire the server composition root**

In `api/src/server.ts`, add these imports alongside the existing ones:

```ts
import { createApplicationsRoutes } from './routes/applications'
import { ensureApplicationIndexes } from './applications/applicationsService'
import { ensureAutomationRunIndexes } from './applications/automationRunsService'
```

In `main()`, after the existing `await ensureMaterialsIndexes(db)` line, add:

```ts
  await ensureApplicationIndexes(db)
  await ensureAutomationRunIndexes(db)
```

After the existing `/materials` route mount, add:

```ts
  app.route('/applications', createApplicationsRoutes(db, jwtSecret))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (139 total: 132 + 7 new)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/applications.ts api/src/server.ts api/test/applications.test.ts
git commit -m "Add application routes and wire the approval gate into the server"
```

---

## M5a Definition of Done

- `npm test` passes across `api` (139 tests) and `shared` (25 tests) — 164 total.
- `npm run typecheck` passes across all three workspaces.
- Manual smoke test: register/login, discover→verify a job, `POST /applications` with that job's `sourceId`/`sourceJobId` returns a `draft` application; manually inserting an `automationRuns` document for it (simulating what M5b will do for real) and then calling `POST /applications/:jobId/runs/:runNumber/approve` returns `approved: true` only when `requiredAnswers` has no unresolved entries, and the `automationRuns` document's `status` field is the only thing the call ever changes — confirm directly in Mongo that no `applications` document's `status` field is ever touched by anything in this plan (it stays `'draft'` throughout; a future M5b/dashboard concern moves it to `'ready'`/`'submitted'`/`'failed'`, not this plan).
- Explicitly NOT in scope for M5a (deferred to M5b): the Playwright browser-automation engine itself, field-matching rules (fieldset-legend labeling, CV upload), CAPTCHA/login-wall detection, confirmation-page detection, and anything that actually drives a browser.
