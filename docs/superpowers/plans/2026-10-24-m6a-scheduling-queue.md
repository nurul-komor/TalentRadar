# M6a — Scheduling, Background Queue, and Login Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline (discovery → verification → scoring, plus a daily digest and a pending-approval reminder) run on a schedule instead of only by manual `curl`, with retries and a dead-letter state for anything that fails repeatedly — and add login rate limiting, since this is the point at which the app starts running unattended for long stretches.

**Architecture:** A MongoDB-backed `queueJobs` collection decouples *scheduling* from *execution*: `node-cron` schedules only ever enqueue a job (`discovery`/`verification`/`scoring`/`digest`/`reminder`), never run one directly, so every trigger — cron, a future manual "run now" button, anything — goes through the same retry/dead-letter logic. An in-process worker loop (`runWorkerOnce`, wrapped by `startWorkerLoop`'s `setInterval`) claims one pending job at a time via an atomic `findOneAndUpdate`, dispatches it to the matching handler, and marks it `completed` or re-queues it with an incremented attempt count — moving it to `dead_letter` once it's failed `maxAttempts` times. `sendEmail` is a thin Resend wrapper that no-ops (logs, doesn't throw) when `RESEND_API_KEY` is unset, so the whole system keeps working with no email delivery, exactly as the design spec requires. Login attempts get a per-process, per-email sliding-window rate limiter — no new collection, no new dependency, since a single always-on instance doesn't need distributed rate-limit state.

**Scope decision — `queueJobs` is the one collection in this codebase keyed by MongoDB's own `_id`, not a composite business key.** Every other collection since M2 (`jobs`, `materials`, `applications`, `automationRuns`, `approvals`) has a natural business key (`jobId`, `(jobId, version)`, etc.) and is filtered by that, specifically to avoid the `_id: string` (declared) vs. `ObjectId` (actual) type mismatch that recurs throughout this codebase. A queue job has no natural business key — it's an anonymous unit of work — so using the real auto-generated `_id` here is the right call, not an inconsistency with the rest of the codebase. The queue service converts it to a string at its own boundary so callers only ever see `string` IDs, matching every other collection's declared shape.

**Tech Stack:** Same as M1-M6, plus `node-cron` (new dependency — the first scheduling library in this codebase). `sendEmail` uses plain `fetch` against Resend's REST API directly rather than adding the `resend` SDK — one call, one endpoint, not worth a whole SDK dependency for.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md` (see "Operations" — this plan implements scheduling, the queue, digest/reminder emails, and login rate limiting; Docker Compose and CI/deploy are a separate M6b plan, since they're infrastructure-as-code verified by actually running them, not by Vitest)

## Global Constraints

- Node.js 22 (pinned via `.nvmrc` — verify `node --version` prints v22.x before trusting any test run).
- TypeScript strict mode everywhere.
- `api`/`shared` tests use Vitest; MongoDB-touching tests use a real `mongodb-memory-server` instance. `sendEmail`'s one test mocks global `fetch` (same precedent as M2's adapters) — no live Resend calls in the test suite.
- **`startScheduler` (the `node-cron` wiring itself) and `startWorkerLoop`'s `setInterval` wrapper are not unit-tested** — `node-cron`'s actual schedule-firing is not something a fast, deterministic unit test can exercise without either waiting for real wall-clock time or taking on a cron-specific fake-timer dependency, and the `setInterval` wrapper is a two-line pass-through around `runWorkerOnce`, which *is* fully unit-tested on its own. Both are covered only by this plan's manual smoke test. This is an explicit, acknowledged gap, not an oversight — name it if a future reviewer asks why these two files have no test file.
- A queue job's handler receives only `db: Db` — it does not receive whatever a route handler would (an authenticated caller's profile, specific request parameters). Handlers that need more than `db` (discovery needs its 3 sources, verification needs a verifier, scoring needs a profile and an extractor) get those bound in a closure at server-wiring time (Task 6), using the exact same real instances the existing HTTP routes already use — nothing in this plan reimplements discovery/verification/scoring, it only calls the functions M2/M3a/M3b already built.
- The login rate limiter is created fresh per `createAuthRoutes(...)` call via a default parameter expression (`loginRateLimiter: LoginRateLimiter = createLoginRateLimiter()`), never a module-level singleton — a shared singleton would let one test's rate-limit attempts leak into a different test case, the same class of bug M2's Task 2 incident already taught this codebase to avoid.
- `npm run typecheck --workspace=api` (and `--workspace=shared`) must exit 0 clean after every task.
- Package manager: npm workspaces (unchanged).

---

### Task 1: Shared `QueueJob` schema

**Files:**
- Create: `shared/src/schemas/queue.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/queue-schema.test.ts`

**Interfaces:**
- Produces: `QueueJobTypeSchema`, `QueueJobStatusSchema`, `QueueJobSchema` (and inferred types `QueueJobType`, `QueueJobStatus`, `QueueJob`) from `shared/src/schemas/queue.ts` — consumed by every task in this plan.

- [ ] **Step 1: Write the failing tests**

`shared/test/queue-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { QueueJobSchema } from '../src/index'

const VALID_JOB = {
  type: 'discovery',
  status: 'pending',
  attempts: 0,
  maxAttempts: 3,
  scheduledFor: '2026-10-24T00:00:00.000Z',
  claimedAt: null,
  lastError: null,
  createdAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:00.000Z',
}

describe('QueueJobSchema', () => {
  it('accepts a valid pending job', () => {
    expect(QueueJobSchema.safeParse(VALID_JOB).success).toBe(true)
  })

  it('rejects an unknown job type', () => {
    expect(QueueJobSchema.safeParse({ ...VALID_JOB, type: 'cleanup' }).success).toBe(false)
  })

  it('rejects a negative attempt count', () => {
    expect(QueueJobSchema.safeParse({ ...VALID_JOB, attempts: -1 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=shared`
Expected: FAIL — `../src/index` has no `QueueJobSchema` export yet.

- [ ] **Step 3: Implement the schema**

`shared/src/schemas/queue.ts`:

```ts
import { z } from 'zod'

export const QueueJobTypeSchema = z.enum(['discovery', 'verification', 'scoring', 'digest', 'reminder'])

export const QueueJobStatusSchema = z.enum(['pending', 'claimed', 'completed', 'failed', 'dead_letter'])

export const QueueJobSchema = z.object({
  _id: z.string().optional(),
  type: QueueJobTypeSchema,
  status: QueueJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  scheduledFor: z.string(),
  claimedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type QueueJobType = z.infer<typeof QueueJobTypeSchema>
export type QueueJobStatus = z.infer<typeof QueueJobStatusSchema>
export type QueueJob = z.infer<typeof QueueJobSchema>
```

`shared/src/index.ts` (add one line):

```ts
export * from './schemas/auth'
export * from './schemas/profile'
export * from './schemas/job'
export * from './schemas/materials'
export * from './schemas/applications'
export * from './schemas/queue'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=shared`
Expected: PASS (28 tests total: 25 existing + 3 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=shared`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/queue.ts shared/src/index.ts shared/test/queue-schema.test.ts
git commit -m "Add shared QueueJob schema"
```

---

### Task 2: Queue service (enqueue, claim, complete, retry/dead-letter)

**Files:**
- Create: `api/src/queue/queueService.ts`
- Test: `api/test/queue/queueService.test.ts`

**Interfaces:**
- Consumes: `QueueJob`, `QueueJobType` (Task 1, from `@job-hunter/shared`).
- Produces: `ensureQueueIndexes(db: Db): Promise<void>`, `enqueue(db: Db, type: QueueJobType, options?: { maxAttempts?: number; scheduledFor?: string }): Promise<QueueJob>`, `claimNext(db: Db): Promise<QueueJob | null>`, `markCompleted(db: Db, jobId: string): Promise<void>`, `markFailed(db: Db, jobId: string, error: string): Promise<void>` from `api/src/queue/queueService.ts` — consumed by `api/src/queue/worker.ts` (Task 3) and `api/src/queue/scheduler.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

`api/test/queue/queueService.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import {
  claimNext,
  enqueue,
  ensureQueueIndexes,
  markCompleted,
  markFailed,
} from '../../src/queue/queueService'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

describe('queueService', () => {
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
    await ensureQueueIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('enqueues a pending job with zero attempts', async () => {
    const job = await enqueue(db, 'discovery')
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(0)
    expect(job.maxAttempts).toBe(3)
  })

  it('claims the oldest scheduled pending job and marks it claimed', async () => {
    await enqueue(db, 'discovery')
    const claimed = await claimNext(db)
    expect(claimed?.type).toBe('discovery')
    expect(claimed?.status).toBe('claimed')
  })

  it('returns null when there is nothing pending', async () => {
    expect(await claimNext(db)).toBeNull()
  })

  it('does not claim a job scheduled in the future', async () => {
    await enqueue(db, 'discovery', { scheduledFor: new Date(Date.now() + 60_000).toISOString() })
    expect(await claimNext(db)).toBeNull()
  })

  it('marks a job completed', async () => {
    const job = await enqueue(db, 'discovery')
    await markCompleted(db, job._id as string)
    const stored = await db.collection('queueJobs').findOne({ type: 'discovery' })
    expect(stored?.status).toBe('completed')
  })

  it('re-queues a failed job as pending when attempts remain', async () => {
    const job = await enqueue(db, 'discovery', { maxAttempts: 3 })
    await markFailed(db, job._id as string, 'boom')
    const stored = await db.collection('queueJobs').findOne({ type: 'discovery' })
    expect(stored?.status).toBe('pending')
    expect(stored?.attempts).toBe(1)
    expect(stored?.lastError).toBe('boom')
  })

  it('moves a job to dead_letter once it exceeds maxAttempts', async () => {
    const job = await enqueue(db, 'discovery', { maxAttempts: 1 })
    await markFailed(db, job._id as string, 'boom')
    const stored = await db.collection('queueJobs').findOne({ type: 'discovery' })
    expect(stored?.status).toBe('dead_letter')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/queue/queueService` does not exist.

- [ ] **Step 3: Implement the service**

`api/src/queue/queueService.ts`:

```ts
import { ObjectId, type Db } from 'mongodb'
import type { QueueJob, QueueJobType } from '@job-hunter/shared'

export async function ensureQueueIndexes(db: Db): Promise<void> {
  await db.collection('queueJobs').createIndex({ status: 1, scheduledFor: 1 })
}

export async function enqueue(
  db: Db,
  type: QueueJobType,
  options: { maxAttempts?: number; scheduledFor?: string } = {}
): Promise<QueueJob> {
  const now = new Date().toISOString()
  const job = {
    type,
    status: 'pending' as const,
    attempts: 0,
    maxAttempts: options.maxAttempts ?? 3,
    scheduledFor: options.scheduledFor ?? now,
    claimedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection('queueJobs').insertOne(job)
  return { ...job, _id: result.insertedId.toString() }
}

export async function claimNext(db: Db): Promise<QueueJob | null> {
  const now = new Date().toISOString()
  const result = await db.collection('queueJobs').findOneAndUpdate(
    { status: 'pending', scheduledFor: { $lte: now } },
    { $set: { status: 'claimed', claimedAt: now, updatedAt: now } },
    { sort: { scheduledFor: 1 }, returnDocument: 'after' }
  )
  if (!result) return null
  return { ...result, _id: result._id.toString() } as QueueJob
}

export async function markCompleted(db: Db, jobId: string): Promise<void> {
  await db
    .collection('queueJobs')
    .updateOne({ _id: new ObjectId(jobId) }, { $set: { status: 'completed', updatedAt: new Date().toISOString() } })
}

export async function markFailed(db: Db, jobId: string, error: string): Promise<void> {
  const job = await db.collection('queueJobs').findOne({ _id: new ObjectId(jobId) })
  if (!job) return

  const attempts = (job.attempts as number) + 1
  const now = new Date().toISOString()
  const status = attempts >= (job.maxAttempts as number) ? 'dead_letter' : 'pending'

  await db
    .collection('queueJobs')
    .updateOne({ _id: new ObjectId(jobId) }, { $set: { status, attempts, lastError: error, updatedAt: now } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (171 total: 164 + 7 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/queue/queueService.ts api/test/queue/queueService.test.ts
git commit -m "Add MongoDB-backed queue service with retry and dead-letter"
```

---

### Task 3: Worker loop

**Files:**
- Create: `api/src/queue/worker.ts`
- Test: `api/test/queue/worker.test.ts`

**Interfaces:**
- Consumes: `claimNext`, `markCompleted`, `markFailed` (Task 2), `QueueJobType` (Task 1).
- Produces: `JobHandler` (`(db: Db) => Promise<unknown>`), `WorkerHandlers` (`Record<QueueJobType, JobHandler>`), `runWorkerOnce(db: Db, handlers: WorkerHandlers): Promise<'processed' | 'idle'>`, and `startWorkerLoop(db: Db, handlers: WorkerHandlers, intervalMs?: number): () => void` (the returned function stops the loop) from `api/src/queue/worker.ts` — consumed by `api/src/server.ts` (Task 6). `startWorkerLoop` itself is not unit-tested (see Global Constraints); only `runWorkerOnce` is.

- [ ] **Step 1: Write the failing test**

`api/test/queue/worker.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { enqueue, ensureQueueIndexes } from '../../src/queue/queueService'
import { runWorkerOnce } from '../../src/queue/worker'
import type { WorkerHandlers } from '../../src/queue/worker'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function handlers(overrides: Partial<WorkerHandlers> = {}): WorkerHandlers {
  const noop = async () => {}
  return {
    discovery: noop,
    verification: noop,
    scoring: noop,
    digest: noop,
    reminder: noop,
    ...overrides,
  }
}

describe('runWorkerOnce', () => {
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
    await ensureQueueIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('returns idle when there is no pending job', async () => {
    expect(await runWorkerOnce(db, handlers())).toBe('idle')
  })

  it('calls the handler matching the job type and marks the job completed', async () => {
    await enqueue(db, 'digest')
    let called = false
    const result = await runWorkerOnce(
      db,
      handlers({ digest: async () => { called = true } })
    )

    expect(result).toBe('processed')
    expect(called).toBe(true)
    const stored = await db.collection('queueJobs').findOne({ type: 'digest' })
    expect(stored?.status).toBe('completed')
  })

  it('does not call the handler for a different job type', async () => {
    await enqueue(db, 'digest')
    let reminderCalled = false
    await runWorkerOnce(db, handlers({ reminder: async () => { reminderCalled = true } }))
    expect(reminderCalled).toBe(false)
  })

  it('re-queues the job as pending when the handler throws and attempts remain', async () => {
    await enqueue(db, 'digest', { maxAttempts: 3 } as never)
    await runWorkerOnce(
      db,
      handlers({
        digest: async () => {
          throw new Error('handler boom')
        },
      })
    )
    const stored = await db.collection('queueJobs').findOne({ type: 'digest' })
    expect(stored?.status).toBe('pending')
    expect(stored?.lastError).toBe('handler boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/queue/worker` does not exist.

- [ ] **Step 3: Implement the worker loop**

`api/src/queue/worker.ts`:

```ts
import type { Db } from 'mongodb'
import type { QueueJobType } from '@job-hunter/shared'
import { claimNext, markCompleted, markFailed } from './queueService'

export type JobHandler = (db: Db) => Promise<unknown>
export type WorkerHandlers = Record<QueueJobType, JobHandler>

export async function runWorkerOnce(db: Db, handlers: WorkerHandlers): Promise<'processed' | 'idle'> {
  const job = await claimNext(db)
  if (!job) return 'idle'

  try {
    await handlers[job.type](db)
    await markCompleted(db, job._id as string)
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    await markFailed(db, job._id as string, message)
  }

  return 'processed'
}

export function startWorkerLoop(db: Db, handlers: WorkerHandlers, intervalMs = 10_000): () => void {
  const timer = setInterval(() => {
    runWorkerOnce(db, handlers).catch((err) => console.error('worker loop error:', err))
  }, intervalMs)
  return () => clearInterval(timer)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (175 total: 171 + 4 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/queue/worker.ts api/test/queue/worker.test.ts
git commit -m "Add worker loop dispatching queue jobs to handlers"
```

---

### Task 4: Email sending (optional Resend integration)

**Files:**
- Create: `api/src/notifications/email.ts`
- Test: `api/test/notifications/email.test.ts`

**Interfaces:**
- Produces: `sendEmail(to: string, subject: string, html: string): Promise<void>` from `api/src/notifications/email.ts` — consumed by `api/src/notifications/digestAndReminders.ts` (Task 5).

- [ ] **Step 1: Write the failing tests**

`api/test/notifications/email.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'

describe('sendEmail', () => {
  const originalKey = process.env.RESEND_API_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.RESEND_API_KEY = originalKey
  })

  it('posts to the Resend API when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { sendEmail } = await import('../../src/notifications/email')
    await sendEmail('user@example.com', 'Subject', '<p>Body</p>')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.to).toBe('user@example.com')
  })

  it('does not call fetch when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { sendEmail } = await import('../../src/notifications/email')
    await sendEmail('user@example.com', 'Subject', '<p>Body</p>')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/notifications/email` does not exist.

- [ ] **Step 3: Implement email sending**

`api/src/notifications/email.ts`:

```ts
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.log(`[email skipped, no RESEND_API_KEY] to=${to} subject=${subject}`)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'jobs@yourdomain.com', to, subject, html }),
  })
  if (!res.ok) {
    throw new Error(`resend: unexpected status ${res.status}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (177 total: 175 + 2 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/notifications/email.ts api/test/notifications/email.test.ts
git commit -m "Add optional Resend email sending"
```

---

### Task 5: Digest and reminder content and handlers

**Files:**
- Create: `api/src/notifications/digestAndReminders.ts`
- Test: `api/test/notifications/digestAndReminders.test.ts`

**Interfaces:**
- Consumes: `sendEmail` (Task 4).
- Produces: `buildDigestHtml(db: Db): Promise<string | null>`, `digestHandler(db: Db): Promise<void>`, `buildReminderHtml(db: Db): Promise<string | null>`, `reminderHandler(db: Db): Promise<void>` from `api/src/notifications/digestAndReminders.ts` — consumed by `api/src/server.ts` (Task 6, as two of the `WorkerHandlers`).

- [ ] **Step 1: Write the failing tests**

`api/test/notifications/digestAndReminders.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'

const mockSendEmail = vi.fn()
vi.mock('../../src/notifications/email', () => ({ sendEmail: mockSendEmail }))

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function insertScoredJob(db: Db, scoredAt: string) {
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
    score: 85,
    scoreBreakdown: null,
    scoredAt,
  })
}

describe('buildDigestHtml / digestHandler', () => {
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
    mockSendEmail.mockReset()
  })

  it('builds digest HTML listing jobs scored in the last 24 hours', async () => {
    await insertScoredJob(db, new Date().toISOString())
    const { buildDigestHtml } = await import('../../src/notifications/digestAndReminders')

    const html = await buildDigestHtml(db)
    expect(html).toContain('Backend Engineer')
    expect(html).toContain('85')
  })

  it('returns null when nothing was scored in the last 24 hours', async () => {
    await insertScoredJob(db, new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    const { buildDigestHtml } = await import('../../src/notifications/digestAndReminders')

    expect(await buildDigestHtml(db)).toBeNull()
  })

  it('digestHandler sends an email to the profile when there is content', async () => {
    await db.collection('profiles').insertOne({
      email: 'candidate@example.com',
      eligibility: { workAuthorization: 'citizen', countries: [] },
      preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
      cvText: null,
    })
    await insertScoredJob(db, new Date().toISOString())
    const { digestHandler } = await import('../../src/notifications/digestAndReminders')

    await digestHandler(db)

    expect(mockSendEmail).toHaveBeenCalledWith(
      'candidate@example.com',
      expect.any(String),
      expect.stringContaining('Backend Engineer')
    )
  })
})

describe('buildReminderHtml', () => {
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
    mockSendEmail.mockReset()
  })

  it('builds reminder HTML for runs awaiting approval for over 24 hours', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    await db.collection('automationRuns').insertOne({
      jobId: 'remoteok:1',
      runNumber: 1,
      status: 'ready_for_approval',
      filledFields: null,
      blockReason: null,
      manualApplyUrl: null,
      createdAt: old,
      updatedAt: old,
    })
    const { buildReminderHtml } = await import('../../src/notifications/digestAndReminders')

    const html = await buildReminderHtml(db)
    expect(html).toContain('remoteok:1')
  })

  it('returns null when nothing is waiting for approval', async () => {
    const { buildReminderHtml } = await import('../../src/notifications/digestAndReminders')
    expect(await buildReminderHtml(db)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/notifications/digestAndReminders` does not exist.

- [ ] **Step 3: Implement digest and reminder content and handlers**

`api/src/notifications/digestAndReminders.ts`:

```ts
import type { Db } from 'mongodb'
import { sendEmail } from './email'

export async function buildDigestHtml(db: Db): Promise<string | null> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const recentlyScored = await db
    .collection('jobs')
    .find({ status: 'verified', score: { $ne: null }, scoredAt: { $gte: cutoff } })
    .sort({ score: -1 })
    .toArray()

  if (recentlyScored.length === 0) return null

  const rows = recentlyScored
    .map((job) => `<li>${job.title} at ${job.company} — score ${job.score}</li>`)
    .join('')
  return `<p>Jobs scored in the last 24 hours:</p><ul>${rows}</ul>`
}

export async function digestHandler(db: Db): Promise<void> {
  const profile = await db.collection('profiles').findOne({})
  if (!profile) return

  const html = await buildDigestHtml(db)
  if (!html) return

  await sendEmail(profile.email as string, 'Your daily job digest', html)
}

export async function buildReminderHtml(db: Db): Promise<string | null> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const pendingRuns = await db
    .collection('automationRuns')
    .find({ status: 'ready_for_approval', createdAt: { $lte: cutoff } })
    .toArray()

  if (pendingRuns.length === 0) return null

  const rows = pendingRuns.map((run) => `<li>${run.jobId} — run #${run.runNumber}</li>`).join('')
  return `<p>These applications are still waiting for your approval:</p><ul>${rows}</ul>`
}

export async function reminderHandler(db: Db): Promise<void> {
  const profile = await db.collection('profiles').findOne({})
  if (!profile) return

  const html = await buildReminderHtml(db)
  if (!html) return

  await sendEmail(profile.email as string, 'Applications awaiting your approval', html)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (182 total: 177 + 5 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/notifications/digestAndReminders.ts api/test/notifications/digestAndReminders.test.ts
git commit -m "Add digest and reminder email content and handlers"
```

---

### Task 6: Cron scheduler and server wiring

**Files:**
- Modify: `api/package.json` (add `node-cron`)
- Create: `api/src/queue/scheduler.ts`
- Modify: `api/src/server.ts`

**Interfaces:**
- Consumes: `enqueue` (Task 2).
- Produces: `startScheduler(db: Db): () => void` from `api/src/queue/scheduler.ts` — the returned function stops every scheduled cron task. Not unit-tested (see Global Constraints) — the `enqueue` calls it makes are already fully tested in Task 2; this file is the untested two-line glue between a cron expression and that call.

No test file for this task — see the Global Constraints note on why `startScheduler` and the `setInterval` wrapper are covered by the manual smoke test rather than Vitest.

- [ ] **Step 1: Add the dependency**

`api/package.json` — add to `dependencies`:

```json
"node-cron": "^3.0.3",
```

Run: `npm install`

- [ ] **Step 2: Implement the scheduler**

`api/src/queue/scheduler.ts`:

```ts
import cron from 'node-cron'
import type { Db } from 'mongodb'
import { enqueue } from './queueService'

export function startScheduler(db: Db): () => void {
  const tasks = [
    cron.schedule('0 */6 * * *', () => {
      enqueue(db, 'discovery').catch((err) => console.error('failed to enqueue discovery:', err))
    }),
    cron.schedule('0 */2 * * *', () => {
      enqueue(db, 'verification').catch((err) => console.error('failed to enqueue verification:', err))
    }),
    cron.schedule('0 3 * * *', () => {
      enqueue(db, 'scoring').catch((err) => console.error('failed to enqueue scoring:', err))
    }),
    cron.schedule('0 8 * * *', () => {
      enqueue(db, 'digest').catch((err) => console.error('failed to enqueue digest:', err))
    }),
    cron.schedule('0 9 * * *', () => {
      enqueue(db, 'reminder').catch((err) => console.error('failed to enqueue reminder:', err))
    }),
  ]

  return () => tasks.forEach((task) => task.stop())
}
```

- [ ] **Step 3: Wire the server composition root**

In `api/src/server.ts`, add these imports alongside the existing ones:

```ts
import { ensureQueueIndexes } from './queue/queueService'
import { startWorkerLoop, type WorkerHandlers } from './queue/worker'
import { startScheduler } from './queue/scheduler'
import { runDiscovery } from './discovery/discoveryService'
import { runVerification } from './verification/verificationService'
import { runScoring } from './scoring/scoringService'
import { digestHandler, reminderHandler } from './notifications/digestAndReminders'
```

In `main()`, after the existing `await ensureAutomationRunIndexes(db)` line, add:

```ts
  await ensureQueueIndexes(db)
```

Before the existing `const port = ...` line, add:

```ts
  const handlers: WorkerHandlers = {
    discovery: (db) =>
      runDiscovery(db, [remoteOkSource, weWorkRemotelySource, himalayasSource]),
    verification: (db) => runVerification(db, pageEvidenceVerifier),
    scoring: async (db) => {
      const profile = await db.collection('profiles').findOne({})
      if (!profile) return
      return runScoring(db, profile as never, createClaudeRequirementsExtractor(anthropicApiKey))
    },
    digest: digestHandler,
    reminder: reminderHandler,
  }
  const stopWorker = startWorkerLoop(db, handlers)
  const stopScheduler = startScheduler(db)

  process.on('SIGTERM', () => {
    stopWorker()
    stopScheduler()
  })
```

(`remoteOkSource`, `weWorkRemotelySource`, `himalayasSource`, `pageEvidenceVerifier`, `createClaudeRequirementsExtractor`, and `anthropicApiKey` are all already imported/defined earlier in `server.ts` from M2/M3a/M3b — this task reuses them, it doesn't reimplement them. The `scoring` handler's `profile as never` cast matches the existing pragmatic typing already used elsewhere in this file for the same `db.collection('profiles').findOne({})` pattern; if `server.ts`'s actual current state types this more strictly by the time this task runs, follow whatever pattern is already there instead of introducing a new one.)

- [ ] **Step 4: Run the full suite to confirm no regression**

Run: `npm run test --workspace=api`
Expected: PASS (182 total, unchanged — this task adds no new tests, only wiring).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/package.json package-lock.json api/src/queue/scheduler.ts api/src/server.ts
git commit -m "Add cron scheduler and wire the worker loop into the server"
```

---

### Task 7: Login rate limiting

**Files:**
- Create: `api/src/lib/loginRateLimiter.ts`
- Modify: `api/src/routes/auth.ts`
- Test: `api/test/lib/loginRateLimiter.test.ts`
- Test: `api/test/auth.test.ts`

**Interfaces:**
- Produces: `LoginRateLimiter` (`{ checkAndRecord(email: string): boolean }`) and `createLoginRateLimiter(maxAttempts?: number, windowMs?: number): LoginRateLimiter` from `api/src/lib/loginRateLimiter.ts` — consumed by `api/src/routes/auth.ts`.
- Modifies: `createAuthRoutes(db: Db, jwtSecret: string, loginRateLimiter: LoginRateLimiter = createLoginRateLimiter())` — adds an optional, defaulted third parameter (a **fresh instance per call**, via the default parameter expression, never a shared singleton) so tests can inject a tightly-limited instance. `POST /auth/login` now returns `429` once an email has exceeded the limit, checked before password verification.

- [ ] **Step 1: Write the failing tests for `createLoginRateLimiter`**

`api/test/lib/loginRateLimiter.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLoginRateLimiter } from '../../src/lib/loginRateLimiter'

describe('createLoginRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows attempts up to the configured max', () => {
    const limiter = createLoginRateLimiter(3, 60_000)
    expect(limiter.checkAndRecord('a@example.com')).toBe(true)
    expect(limiter.checkAndRecord('a@example.com')).toBe(true)
    expect(limiter.checkAndRecord('a@example.com')).toBe(true)
  })

  it('blocks once the max is exceeded', () => {
    const limiter = createLoginRateLimiter(2, 60_000)
    limiter.checkAndRecord('a@example.com')
    limiter.checkAndRecord('a@example.com')
    expect(limiter.checkAndRecord('a@example.com')).toBe(false)
  })

  it('tracks each email independently', () => {
    const limiter = createLoginRateLimiter(1, 60_000)
    limiter.checkAndRecord('a@example.com')
    expect(limiter.checkAndRecord('b@example.com')).toBe(true)
  })

  it('allows attempts again once the window has elapsed', () => {
    const limiter = createLoginRateLimiter(1, 60_000)
    limiter.checkAndRecord('a@example.com')
    expect(limiter.checkAndRecord('a@example.com')).toBe(false)

    vi.advanceTimersByTime(61_000)

    expect(limiter.checkAndRecord('a@example.com')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/lib/loginRateLimiter` does not exist.

- [ ] **Step 3: Implement the rate limiter**

`api/src/lib/loginRateLimiter.ts`:

```ts
export interface LoginRateLimiter {
  checkAndRecord(email: string): boolean
}

export function createLoginRateLimiter(
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000
): LoginRateLimiter {
  const attemptsByEmail = new Map<string, number[]>()

  return {
    checkAndRecord(email: string): boolean {
      const now = Date.now()
      const recentAttempts = (attemptsByEmail.get(email) ?? []).filter(
        (timestamp) => now - timestamp < windowMs
      )

      if (recentAttempts.length >= maxAttempts) {
        attemptsByEmail.set(email, recentAttempts)
        return false
      }

      recentAttempts.push(now)
      attemptsByEmail.set(email, recentAttempts)
      return true
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (186 total: 182 + 4 new)

- [ ] **Step 5: Write the failing test for the route**

Add this import to `api/test/auth.test.ts`:

```ts
import { createLoginRateLimiter } from '../src/lib/loginRateLimiter'
```

Add this `it()` block inside the existing `describe('auth routes', ...)` block (do not modify the 4 existing tests or how `createAuthRoutes` is called in `beforeEach` — the new third parameter is optional and defaulted, so the existing 2-argument call sites keep working unchanged):

```ts
  it('rate-limits repeated login attempts for the same email', async () => {
    const tightApp = new Hono()
    tightApp.route('/auth', createAuthRoutes(db, JWT_SECRET, createLoginRateLimiter(2, 60_000)))

    await tightApp.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rate-limited@example.com', password: 'password123' }),
    })

    const attempt = () =>
      tightApp.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'rate-limited@example.com', password: 'wrong-password' }),
      })

    await attempt()
    await attempt()
    const thirdAttempt = await attempt()

    expect(thirdAttempt.status).toBe(429)
  })
```

(Check `api/test/auth.test.ts`'s actual current structure before adding this — it must already have `db` and `Hono` in scope from its existing `beforeEach`; adapt variable names to whatever is already there rather than assuming this plan's placeholder names match exactly.)

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — login doesn't rate-limit yet, so the third attempt returns `401` (wrong password), not `429`.

- [ ] **Step 7: Implement the route change**

In `api/src/routes/auth.ts`, add this import:

```ts
import { createLoginRateLimiter, type LoginRateLimiter } from '../lib/loginRateLimiter'
```

Change the function signature from `export function createAuthRoutes(db: Db, jwtSecret: string) {` to:

```ts
export function createAuthRoutes(
  db: Db,
  jwtSecret: string,
  loginRateLimiter: LoginRateLimiter = createLoginRateLimiter()
) {
```

In the `/login` handler, right after `const { email, password } = parsed.data`, add:

```ts
    if (!loginRateLimiter.checkAndRecord(email)) {
      return c.json({ error: 'too many login attempts, try again later' }, 429)
    }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (187 total: 186 + 1 new)

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add api/src/lib/loginRateLimiter.ts api/src/routes/auth.ts api/test/lib/loginRateLimiter.test.ts api/test/auth.test.ts
git commit -m "Add per-email login rate limiting"
```

---

## M6a Definition of Done

- `npm test` passes across `api` (187 tests) and `shared` (28 tests) — 215 total.
- `npm run typecheck` passes across all three workspaces.
- Manual smoke test: start the api with `RESEND_API_KEY` unset — confirm the process starts fine and logs `[email skipped, no RESEND_API_KEY]` when a digest/reminder job runs rather than crashing. Watch the logs for roughly 10+ seconds after startup and confirm the worker loop logs activity (or at least doesn't error) even with an empty queue. Manually insert a `queueJobs` document with `scheduledFor` in the past and confirm the worker picks it up within one poll interval and marks it `completed`. Set `RESEND_API_KEY` to a real test key and confirm a digest email actually arrives when there's a recently-scored job to report.
- Explicitly NOT in scope for M6a (deferred to M6b): Docker Compose, GitHub Actions CI, and Fly.io (or equivalent) deployment.
