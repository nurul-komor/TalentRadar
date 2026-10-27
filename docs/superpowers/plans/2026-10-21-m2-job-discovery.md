# M2 — Job Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first stage of the job pipeline — discover candidate remote job postings from three no-credential sources (Remote OK, We Work Remotely, Himalayas) and store them, unverified, in a new `jobs` collection, behind a manually-triggered authenticated API endpoint.

**Architecture:** A `JobSource` interface with one adapter per source under `api/src/discovery/sources/`, each normalizing its source's shape into a common `RawJobPosting`. A `discoveryService` orchestrates concurrent fetches (`Promise.allSettled` — one source failing never blocks the others), deduplicates against the `jobs` collection (exact match on source id, exact match on normalized URL, or a company+title match within a 60-day window), and upserts. A new `POST /discovery/run` route (bearer-token-protected, same pattern as `/profile`) triggers a sweep synchronously and returns counts. No scheduler, no queue — both remain deferred to M6, per M1's plan.

**Tech Stack:** Same as M1 (TypeScript strict, Hono 4, `mongodb` driver 6, Zod 3, Vitest + `mongodb-memory-server`), plus `fast-xml-parser` (new dependency, for parsing We Work Remotely's RSS feed — no XML parser exists in the stack yet).

**Spec:** `docs/superpowers/specs/2026-10-21-m2-job-discovery-design.md`

## Global Constraints

- Node.js 22 (pinned via the repo's `.nvmrc` — if your shell defaults to a different version, run `source ~/.nvm/nvm.sh && nvm use 22` before any `npm`/`node` command).
- TypeScript strict mode everywhere.
- `api`/`shared` tests use Vitest; MongoDB-touching tests use a real `mongodb-memory-server` instance (never mocks). Tests that touch the network (the 3 adapters) mock `fetch` with realistic fixtures — no live calls to third-party sites in the test suite.
- `npm run typecheck --workspace=api` (and `--workspace=shared`) must exit 0 clean after every task — this bit M1 twice when only `npm test` was checked. Run it before reporting a task done, not just the test suite.
- The discovery endpoint requires the same bearer-token auth as `/profile` (`createRequireAuth`, from M1 Task 6) — it triggers outbound fetches and DB writes.
- No Claude/Anthropic API calls anywhere in this milestone. Discovered content (`rawDescription`) is untrusted and must never be passed to any AI call — enforced here by this milestone containing no such call at all.
- All adapters go through one shared `fetchWithPolicy()` helper: a named User-Agent and a self-imposed 1 request/second/host throttle (no source documents a stricter limit, so this is a floor, not a measured requirement).
- Package manager: npm workspaces (unchanged from M1).

---

### Task 1: Shared `Job` schema

**Files:**
- Create: `shared/src/schemas/job.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/job-schema.test.ts`

**Interfaces:**
- Produces: `JobSourceIdSchema`, `JobStatusSchema`, `JobSchema` and inferred types `JobSourceId`, `JobStatus`, `Job` from `shared/src/schemas/job.ts` — consumed by `api/src/discovery/types.ts` (Task 2, for the `JobSource['id']` union) and later tasks' route/service code for documentation purposes. The discovery service itself (Task 6) writes plain objects matching this shape directly to MongoDB without re-validating through Zod on every write — matching M1's pattern where `shared` schemas are the contract/documentation layer, not a runtime gate on every internal DB write.

- [ ] **Step 1: Write the failing test**

`shared/test/job-schema.test.ts`:
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=shared`
Expected: FAIL — `../src/index` has no `JobSchema` export yet.

- [ ] **Step 3: Implement the schema**

`shared/src/schemas/job.ts`:
```ts
import { z } from 'zod'

export const JobSourceIdSchema = z.enum(['remoteok', 'weworkremotely', 'himalayas'])

export const JobStatusSchema = z.enum(['discovered'])

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
})

export type JobSourceId = z.infer<typeof JobSourceIdSchema>
export type JobStatus = z.infer<typeof JobStatusSchema>
export type Job = z.infer<typeof JobSchema>
```

`shared/src/index.ts` (add one line to the existing file):
```ts
export * from './schemas/auth'
export * from './schemas/profile'
export * from './schemas/job'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=shared`
Expected: PASS (9 tests total: 6 existing + 3 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=shared`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/job.ts shared/src/index.ts shared/test/job-schema.test.ts
git commit -m "Add shared Job schema for discovered postings"
```

---

### Task 2: Discovery utilities and shared types

**Files:**
- Create: `api/src/discovery/types.ts`
- Create: `api/src/discovery/normalizeUrl.ts`
- Create: `api/src/discovery/fetchWithPolicy.ts`
- Test: `api/test/discovery/normalizeUrl.test.ts`
- Test: `api/test/discovery/fetchWithPolicy.test.ts`

**Interfaces:**
- Produces: `RawJobPosting` and `JobSource` interfaces from `api/src/discovery/types.ts` — consumed by every adapter (Tasks 3-5) and `discoveryService.ts` (Task 6).
- Produces: `normalizeUrl(rawUrl: string): string` from `api/src/discovery/normalizeUrl.ts` — consumed by `discoveryService.ts` (Task 6).
- Produces: `fetchWithPolicy(url: string): Promise<Response>` from `api/src/discovery/fetchWithPolicy.ts` — consumed by every adapter (Tasks 3-5).

- [ ] **Step 1: Create the shared types (no test needed — this is a pure type-only file)**

`api/src/discovery/types.ts`:
```ts
export interface RawJobPosting {
  sourceId: 'remoteok' | 'weworkremotely' | 'himalayas'
  sourceJobId: string
  url: string
  title: string
  company: string
  rawDescription: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  postedAt: string | null
}

export interface JobSource {
  id: RawJobPosting['sourceId']
  fetchJobs(): Promise<RawJobPosting[]>
}
```

- [ ] **Step 2: Write the failing test for `normalizeUrl`**

`api/test/discovery/normalizeUrl.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { normalizeUrl } from '../../src/discovery/normalizeUrl'

describe('normalizeUrl', () => {
  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://ExAmple.COM/jobs/1')).toBe('https://example.com/jobs/1')
  })

  it('strips query parameters', () => {
    expect(normalizeUrl('https://example.com/jobs/1?utm_source=feed')).toBe(
      'https://example.com/jobs/1'
    )
  })

  it('strips a trailing slash', () => {
    expect(normalizeUrl('https://example.com/jobs/1/')).toBe('https://example.com/jobs/1')
  })

  it('keeps a bare root path as-is', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('strips the hash fragment', () => {
    expect(normalizeUrl('https://example.com/jobs/1#apply')).toBe('https://example.com/jobs/1')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/discovery/normalizeUrl` does not exist.

- [ ] **Step 4: Implement `normalizeUrl`**

`api/src/discovery/normalizeUrl.ts`:
```ts
export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  const host = url.hostname.toLowerCase()
  let path = url.pathname
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return `${url.protocol}//${host}${path}`
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (the 5 new `normalizeUrl` tests, plus all 15 existing api tests still passing — 20 total so far)

- [ ] **Step 6: Write the failing test for `fetchWithPolicy`**

`api/test/discovery/fetchWithPolicy.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWithPolicy } from '../../src/discovery/fetchWithPolicy'

describe('fetchWithPolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends a named User-Agent header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await fetchWithPolicy('https://example.com/a')

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)['User-Agent']).toContain(
      'AIRemoteJobHunter'
    )
  })

  it('aborts the request if it exceeds the timeout', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = fetchWithPolicy('https://example.com/b')
    await vi.advanceTimersByTimeAsync(10_001)

    await expect(resultPromise).rejects.toThrow('aborted')
  })

  it('throttles back-to-back requests to the same host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const first = fetchWithPolicy('https://example.com/a')
    await vi.advanceTimersByTimeAsync(0)
    await first

    const secondPromise = fetchWithPolicy('https://example.com/b')
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(600)
    await secondPromise
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/discovery/fetchWithPolicy` does not exist.

- [ ] **Step 8: Implement `fetchWithPolicy`**

`api/src/discovery/fetchWithPolicy.ts`:
```ts
const USER_AGENT = 'AIRemoteJobHunter/1.0 (+https://github.com/nurul-komor/job-hunter)'
const TIMEOUT_MS = 10_000
const MIN_INTERVAL_MS = 1_000

const lastRequestAtByHost = new Map<string, number>()

async function waitForHostSlot(host: string): Promise<void> {
  const lastRequestAt = lastRequestAtByHost.get(host) ?? 0
  const elapsed = Date.now() - lastRequestAt
  const remaining = MIN_INTERVAL_MS - elapsed
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }
  lastRequestAtByHost.set(host, Date.now())
}

export async function fetchWithPolicy(url: string): Promise<Response> {
  const host = new URL(url).hostname
  await waitForHostSlot(host)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (23 total: 15 existing + 5 normalizeUrl + 3 fetchWithPolicy)

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0, no output.

- [ ] **Step 11: Commit**

```bash
git add api/src/discovery/types.ts api/src/discovery/normalizeUrl.ts api/src/discovery/fetchWithPolicy.ts api/test/discovery/normalizeUrl.test.ts api/test/discovery/fetchWithPolicy.test.ts
git commit -m "Add discovery types, URL normalization, and rate-limited fetch helper"
```

---

### Task 3: Remote OK adapter

**Files:**
- Create: `api/src/discovery/sources/remoteok.ts`
- Test: `api/test/discovery/remoteok.test.ts`

**Interfaces:**
- Consumes: `JobSource`, `RawJobPosting` (Task 2), `fetchWithPolicy` (Task 2).
- Produces: `remoteOkSource: JobSource` from `api/src/discovery/sources/remoteok.ts` — consumed by `api/src/server.ts` (Task 7).

Verified live response shape (researched 2026-10-21): `https://remoteok.com/api` returns a JSON array whose first element is a legal/terms blob with no `id` field — skip it. Each real job has `id`, `company`, `position`, `description`, `location`, `url`, `date`, `salary_min`, `salary_max`.

- [ ] **Step 1: Write the failing test**

`api/test/discovery/remoteok.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { remoteOkSource } from '../../src/discovery/sources/remoteok'

describe('remoteOkSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses job listings and skips the leading legal blob', async () => {
    const fixture = [
      { legal: 'https://remoteok.com/terms' },
      {
        id: '12345',
        company: 'Acme Corp',
        position: 'Senior Backend Engineer',
        description: '<p>We are hiring a backend engineer.</p>',
        location: 'Worldwide',
        url: 'https://remoteok.com/remote-jobs/12345-senior-backend-engineer-acme-corp',
        date: '2026-10-01T00:00:00+00:00',
        salary_min: 90000,
        salary_max: 130000,
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    )

    const jobs = await remoteOkSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'remoteok',
        sourceJobId: '12345',
        url: 'https://remoteok.com/remote-jobs/12345-senior-backend-engineer-acme-corp',
        title: 'Senior Backend Engineer',
        company: 'Acme Corp',
        rawDescription: '<p>We are hiring a backend engineer.</p>',
        location: 'Worldwide',
        salaryMin: 90000,
        salaryMax: 130000,
        postedAt: '2026-10-01T00:00:00+00:00',
      },
    ])
  })

  it('throws when the response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(remoteOkSource.fetchJobs()).rejects.toThrow('503')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/discovery/sources/remoteok` does not exist.

- [ ] **Step 3: Implement the adapter**

`api/src/discovery/sources/remoteok.ts`:
```ts
import { fetchWithPolicy } from '../fetchWithPolicy'
import type { JobSource, RawJobPosting } from '../types'

const REMOTEOK_API_URL = 'https://remoteok.com/api'

interface RemoteOkJob {
  id?: string
  company?: string
  position?: string
  description?: string
  location?: string
  url?: string
  date?: string
  salary_min?: number
  salary_max?: number
}

export const remoteOkSource: JobSource = {
  id: 'remoteok',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(REMOTEOK_API_URL)
    if (!res.ok) {
      throw new Error(`remoteok: unexpected status ${res.status}`)
    }
    const body = (await res.json()) as RemoteOkJob[]

    return body
      .filter((item): item is RemoteOkJob & { id: string; url: string } =>
        typeof item.id === 'string' && typeof item.url === 'string'
      )
      .map((item) => ({
        sourceId: 'remoteok' as const,
        sourceJobId: item.id,
        url: item.url,
        title: item.position ?? 'Unknown title',
        company: item.company ?? 'Unknown company',
        rawDescription: item.description ?? '',
        location: item.location ?? null,
        salaryMin: item.salary_min ?? null,
        salaryMax: item.salary_max ?? null,
        postedAt: item.date ?? null,
      }))
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (25 total: 23 + 2 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/discovery/sources/remoteok.ts api/test/discovery/remoteok.test.ts
git commit -m "Add Remote OK discovery adapter"
```

---

### Task 4: We Work Remotely adapter

**Files:**
- Modify: `api/package.json` (add `fast-xml-parser` dependency — the first XML/RSS feed this project parses; no XML parser exists in the stack yet)
- Create: `api/src/discovery/sources/weworkremotely.ts`
- Test: `api/test/discovery/weworkremotely.test.ts`

**Interfaces:**
- Consumes: `JobSource`, `RawJobPosting` (Task 2), `fetchWithPolicy` (Task 2).
- Produces: `weWorkRemotelySource: JobSource` from `api/src/discovery/sources/weworkremotely.ts` — consumed by `api/src/server.ts` (Task 7).

Verified live feed shape (fetched directly, 2026-10-21): `https://weworkremotely.com/categories/remote-programming-jobs.rss` is an RSS 2.0 feed. Each `<item>` has `title` (format: `"Company: Job Title"`, confirmed from live data — e.g. `"A.Team: Senior Independent Software Developer ($90-$170/hr)"`), `link`, `guid` (identical to `link` — not a separate numeric ID), `pubDate`, `description` (HTML), `region`, `category`. No structured salary field.

- [ ] **Step 1: Add the dependency**

`api/package.json` — add to `dependencies`:
```json
"fast-xml-parser": "^5.11.2",
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

`api/test/discovery/weworkremotely.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { weWorkRemotelySource } from '../../src/discovery/sources/weworkremotely'

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>We Work Remotely</title>
    <item>
      <title>A.Team: Senior Independent Software Developer ($90-$170/hr)</title>
      <region>Anywhere in the World</region>
      <category>Full-Stack Programming</category>
      <description>&lt;p&gt;Join our team&lt;/p&gt;</description>
      <pubDate>Sun, 16 Jun 2024 17:30:51 +0000</pubDate>
      <guid>https://weworkremotely.com/remote-jobs/a-team-senior-independent-software-developer</guid>
      <link>https://weworkremotely.com/remote-jobs/a-team-senior-independent-software-developer</link>
    </item>
  </channel>
</rss>`

describe('weWorkRemotelySource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses the RSS feed and splits "Company: Title" from the item title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_RSS, { status: 200 })))

    const jobs = await weWorkRemotelySource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'weworkremotely',
        sourceJobId: 'https://weworkremotely.com/remote-jobs/a-team-senior-independent-software-developer',
        url: 'https://weworkremotely.com/remote-jobs/a-team-senior-independent-software-developer',
        title: 'Senior Independent Software Developer ($90-$170/hr)',
        company: 'A.Team',
        rawDescription: '<p>Join our team</p>',
        location: 'Anywhere in the World',
        salaryMin: null,
        salaryMax: null,
        postedAt: 'Sun, 16 Jun 2024 17:30:51 +0000',
      },
    ])
  })

  it('throws when the response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(weWorkRemotelySource.fetchJobs()).rejects.toThrow('503')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/discovery/sources/weworkremotely` does not exist.

- [ ] **Step 4: Implement the adapter**

`api/src/discovery/sources/weworkremotely.ts`:
```ts
import { XMLParser } from 'fast-xml-parser'
import { fetchWithPolicy } from '../fetchWithPolicy'
import type { JobSource, RawJobPosting } from '../types'

const WWR_FEED_URL = 'https://weworkremotely.com/categories/remote-programming-jobs.rss'

interface WwrRssItem {
  title?: string
  link?: string
  guid?: string
  pubDate?: string
  description?: string
  region?: string
}

export const weWorkRemotelySource: JobSource = {
  id: 'weworkremotely',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(WWR_FEED_URL)
    if (!res.ok) {
      throw new Error(`weworkremotely: unexpected status ${res.status}`)
    }
    const xml = await res.text()
    const parsed = new XMLParser().parse(xml)
    const rawItems = parsed?.rss?.channel?.item ?? []
    const items: WwrRssItem[] = Array.isArray(rawItems) ? rawItems : [rawItems]

    return items
      .filter((item): item is WwrRssItem & { link: string } => typeof item.link === 'string')
      .map((item) => {
        const fullTitle = item.title ?? 'Unknown company: Unknown title'
        const separatorIndex = fullTitle.indexOf(': ')
        const company = separatorIndex === -1 ? 'Unknown company' : fullTitle.slice(0, separatorIndex)
        const title =
          separatorIndex === -1 ? fullTitle : fullTitle.slice(separatorIndex + 2)

        return {
          sourceId: 'weworkremotely' as const,
          sourceJobId: item.guid ?? item.link,
          url: item.link,
          title,
          company,
          rawDescription: item.description ?? '',
          location: item.region ?? null,
          salaryMin: null,
          salaryMax: null,
          postedAt: item.pubDate ?? null,
        }
      })
  },
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (27 total: 25 + 2 new)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add api/package.json package-lock.json api/src/discovery/sources/weworkremotely.ts api/test/discovery/weworkremotely.test.ts
git commit -m "Add We Work Remotely discovery adapter"
```

---

### Task 5: Himalayas adapter

**Files:**
- Create: `api/src/discovery/sources/himalayas.ts`
- Test: `api/test/discovery/himalayas.test.ts`

**Interfaces:**
- Consumes: `JobSource`, `RawJobPosting` (Task 2), `fetchWithPolicy` (Task 2).
- Produces: `himalayasSource: JobSource` from `api/src/discovery/sources/himalayas.ts` — consumed by `api/src/server.ts` (Task 7).

Verified live response shape (fetched directly, 2026-10-21): `https://himalayas.app/jobs/api` returns `{ totalCount, nextCursor, jobs: [...] }`. Each job has `title`, `companyName`, `description`, `locationRestrictions` (array, not a single string), `minSalary`/`maxSalary` (nullable numbers), `pubDate` (**Unix seconds, not an ISO string** — confirmed from a live response, e.g. `1792594411`), `guid` (canonical job page URL, used as the unique key — there is no plain `id` field), and `applicationLink` (a separate URL with a `?utm_source=api` tracking param — deliberately NOT used as `url`/`sourceJobId`, since `guid` is the stable, untracked one). Fetches only the first page (`?limit=50`) per the design's scope decision — no pagination loop.

- [ ] **Step 1: Write the failing test**

`api/test/discovery/himalayas.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { himalayasSource } from '../../src/discovery/sources/himalayas'

describe('himalayasSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses jobs and converts the Unix pubDate to an ISO string', async () => {
    const fixture = {
      totalCount: 1,
      nextCursor: 'abc',
      jobs: [
        {
          title: 'Senior Regulatory Affairs Associate',
          companyName: 'Parexel',
          description: '<p>Role description</p>',
          locationRestrictions: ['Serbia'],
          minSalary: null,
          maxSalary: null,
          pubDate: 1792594411,
          applicationLink:
            'https://himalayas.app/companies/parexel/jobs/senior-regulatory-affairs-associate?utm_source=api',
          guid: 'https://himalayas.app/companies/parexel/jobs/senior-regulatory-affairs-associate',
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    )

    const jobs = await himalayasSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'himalayas',
        sourceJobId: 'https://himalayas.app/companies/parexel/jobs/senior-regulatory-affairs-associate',
        url: 'https://himalayas.app/companies/parexel/jobs/senior-regulatory-affairs-associate',
        title: 'Senior Regulatory Affairs Associate',
        company: 'Parexel',
        rawDescription: '<p>Role description</p>',
        location: 'Serbia',
        salaryMin: null,
        salaryMax: null,
        postedAt: new Date(1792594411 * 1000).toISOString(),
      },
    ])
  })

  it('throws when the response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(himalayasSource.fetchJobs()).rejects.toThrow('503')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/discovery/sources/himalayas` does not exist.

- [ ] **Step 3: Implement the adapter**

`api/src/discovery/sources/himalayas.ts`:
```ts
import { fetchWithPolicy } from '../fetchWithPolicy'
import type { JobSource, RawJobPosting } from '../types'

const HIMALAYAS_API_URL = 'https://himalayas.app/jobs/api?limit=50'

interface HimalayasJob {
  title?: string
  companyName?: string
  description?: string
  locationRestrictions?: string[]
  minSalary?: number | null
  maxSalary?: number | null
  pubDate?: number
  guid?: string
}

interface HimalayasResponse {
  jobs?: HimalayasJob[]
}

function unixSecondsToIso(seconds: number | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null
}

export const himalayasSource: JobSource = {
  id: 'himalayas',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(HIMALAYAS_API_URL)
    if (!res.ok) {
      throw new Error(`himalayas: unexpected status ${res.status}`)
    }
    const body = (await res.json()) as HimalayasResponse

    return (body.jobs ?? [])
      .filter((item): item is HimalayasJob & { guid: string } => typeof item.guid === 'string')
      .map((item) => ({
        sourceId: 'himalayas' as const,
        sourceJobId: item.guid,
        url: item.guid,
        title: item.title ?? 'Unknown title',
        company: item.companyName ?? 'Unknown company',
        rawDescription: item.description ?? '',
        location: item.locationRestrictions?.length
          ? item.locationRestrictions.join(', ')
          : null,
        salaryMin: item.minSalary ?? null,
        salaryMax: item.maxSalary ?? null,
        postedAt: unixSecondsToIso(item.pubDate),
      }))
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (29 total: 27 + 2 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/discovery/sources/himalayas.ts api/test/discovery/himalayas.test.ts
git commit -m "Add Himalayas discovery adapter"
```

---

### Task 6: Discovery service (dedupe, upsert, indexes)

**Files:**
- Create: `api/src/discovery/discoveryService.ts`
- Test: `api/test/discovery/discoveryService.test.ts`

**Interfaces:**
- Consumes: `JobSource`, `RawJobPosting` (Task 2), `normalizeUrl` (Task 2), `connectMongo` (M1 Task 3, for the test's `mongodb-memory-server` setup).
- Produces: `ensureJobIndexes(db: Db): Promise<void>` and `runDiscovery(db: Db, sources: JobSource[]): Promise<DiscoveryResult>` (`DiscoveryResult = { discovered: number, duplicates: number, errors: Array<{ sourceId: string, message: string }> }`) from `api/src/discovery/discoveryService.ts` — both consumed by `api/src/server.ts` and `api/src/routes/discovery.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

`api/test/discovery/discoveryService.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { runDiscovery, ensureJobIndexes } from '../../src/discovery/discoveryService'
import type { JobSource, RawJobPosting } from '../../src/discovery/types'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function fakeSource(id: JobSource['id'], jobs: RawJobPosting[]): JobSource {
  return { id, fetchJobs: async () => jobs }
}

function failingSource(id: JobSource['id'], message: string): JobSource {
  return {
    id,
    fetchJobs: async () => {
      throw new Error(message)
    },
  }
}

const SAMPLE_JOB: RawJobPosting = {
  sourceId: 'remoteok',
  sourceJobId: '1',
  url: 'https://remoteok.com/remote-jobs/1',
  title: 'Backend Engineer',
  company: 'Acme',
  rawDescription: 'desc',
  location: null,
  salaryMin: null,
  salaryMax: null,
  postedAt: null,
}

describe('runDiscovery', () => {
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

  it('inserts a newly discovered job', async () => {
    const result = await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    expect(result).toEqual({ discovered: 1, duplicates: 0, errors: [] })

    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.status).toBe('discovered')
    expect(stored?.normalizedUrl).toBe('https://remoteok.com/remote-jobs/1')
  })

  it('skips a job already seen by sourceId+sourceJobId', async () => {
    await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    const result = await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    expect(result).toEqual({ discovered: 0, duplicates: 1, errors: [] })
  })

  it('skips a job already seen by normalized URL even with a different sourceJobId', async () => {
    await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    const sameUrlDifferentId = { ...SAMPLE_JOB, sourceJobId: '2' }
    const result = await runDiscovery(db, [fakeSource('remoteok', [sameUrlDifferentId])])
    expect(result).toEqual({ discovered: 0, duplicates: 1, errors: [] })
  })

  it('skips a job already seen by company+title within the dedupe window', async () => {
    await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    const sameRoleDifferentUrl = {
      ...SAMPLE_JOB,
      sourceJobId: '3',
      url: 'https://remoteok.com/remote-jobs/3',
    }
    const result = await runDiscovery(db, [fakeSource('remoteok', [sameRoleDifferentUrl])])
    expect(result).toEqual({ discovered: 0, duplicates: 1, errors: [] })
  })

  it('records a per-source error without blocking other sources', async () => {
    const result = await runDiscovery(db, [
      failingSource('weworkremotely', 'network timeout'),
      fakeSource('remoteok', [SAMPLE_JOB]),
    ])
    expect(result.discovered).toBe(1)
    expect(result.errors).toEqual([{ sourceId: 'weworkremotely', message: 'network timeout' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/discovery/discoveryService` does not exist.

- [ ] **Step 3: Implement the service**

`api/src/discovery/discoveryService.ts`:
```ts
import type { Db } from 'mongodb'
import { normalizeUrl } from './normalizeUrl'
import type { JobSource, RawJobPosting } from './types'

const DEDUPE_WINDOW_DAYS = 60

export interface DiscoveryResult {
  discovered: number
  duplicates: number
  errors: Array<{ sourceId: string; message: string }>
}

export async function ensureJobIndexes(db: Db): Promise<void> {
  const jobs = db.collection('jobs')
  await jobs.createIndex({ sourceId: 1, sourceJobId: 1 }, { unique: true })
  await jobs.createIndex({ normalizedUrl: 1 }, { unique: true })
}

async function isDuplicate(
  db: Db,
  posting: RawJobPosting,
  normalizedUrl: string
): Promise<boolean> {
  const jobs = db.collection('jobs')

  const bySourceId = await jobs.findOne({
    sourceId: posting.sourceId,
    sourceJobId: posting.sourceJobId,
  })
  if (bySourceId) return true

  const byUrl = await jobs.findOne({ normalizedUrl })
  if (byUrl) return true

  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const byCompanyTitle = await jobs.findOne({
    company: posting.company,
    title: posting.title,
    discoveredAt: { $gte: cutoff },
  })
  return byCompanyTitle !== null
}

export async function runDiscovery(db: Db, sources: JobSource[]): Promise<DiscoveryResult> {
  const results = await Promise.allSettled(sources.map((source) => source.fetchJobs()))

  let discovered = 0
  let duplicates = 0
  const errors: DiscoveryResult['errors'] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const source = sources[i]

    if (result.status === 'rejected') {
      const reason = result.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      errors.push({ sourceId: source.id, message })
      continue
    }

    for (const posting of result.value) {
      const normalizedPostingUrl = normalizeUrl(posting.url)
      const duplicate = await isDuplicate(db, posting, normalizedPostingUrl)
      if (duplicate) {
        duplicates += 1
        continue
      }

      const now = new Date().toISOString()
      await db.collection('jobs').insertOne({
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
      })
      discovered += 1
    }
  }

  return { discovered, duplicates, errors }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (34 total: 29 + 5 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/discovery/discoveryService.ts api/test/discovery/discoveryService.test.ts
git commit -m "Add discovery service with dedupe and index setup"
```

---

### Task 7: Discovery route and server wiring

**Files:**
- Create: `api/src/routes/discovery.ts`
- Modify: `api/src/server.ts`
- Test: `api/test/discovery.test.ts`

**Interfaces:**
- Consumes: `createRequireAuth`/`AuthVariables` (M1 Task 6), `runDiscovery`/`ensureJobIndexes` (Task 6), `JobSource` (Task 2), `remoteOkSource`/`weWorkRemotelySource`/`himalayasSource` (Tasks 3-5).
- Produces: `createDiscoveryRoutes(db: Db, jwtSecret: string, sources: JobSource[]): Hono` — a DI factory like `createAuthRoutes`/`createProfileRoutes`, so tests inject fake sources instead of hitting the network. Endpoint: `POST /discovery/run` → `200` with `DiscoveryResult` JSON. Requires `Authorization: Bearer <token>`; absent/invalid token → `401` (via `createRequireAuth`, already tested in M1 Task 6). Mounted at `/discovery` in `api/src/server.ts`, wired with the 3 real adapters.

- [ ] **Step 1: Write the failing test**

`api/test/discovery.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createDiscoveryRoutes } from '../src/routes/discovery'
import { ensureJobIndexes } from '../src/discovery/discoveryService'
import type { JobSource } from '../src/discovery/types'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function fakeSource(id: JobSource['id']): JobSource {
  return {
    id,
    fetchJobs: async () => [
      {
        sourceId: id,
        sourceJobId: '1',
        url: `https://example.com/${id}/1`,
        title: 'Engineer',
        company: 'Acme',
        rawDescription: 'desc',
        location: null,
        salaryMin: null,
        salaryMax: null,
        postedAt: null,
      },
    ],
  }
}

interface AuthResponseBody {
  token: string
}

interface DiscoveryResponseBody {
  discovered: number
  duplicates: number
  errors: unknown[]
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'discovery-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

describe('discovery routes', () => {
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
    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/discovery', createDiscoveryRoutes(db, JWT_SECRET, [fakeSource('remoteok')]))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/discovery/run', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('runs discovery and returns counts', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/discovery/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as DiscoveryResponseBody
    expect(body.discovered).toBe(1)
    expect(body.duplicates).toBe(0)
    expect(body.errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../src/routes/discovery` does not exist.

- [ ] **Step 3: Implement the route**

`api/src/routes/discovery.ts`:
```ts
import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireAuth, type AuthVariables } from '../middleware/auth'
import { runDiscovery } from '../discovery/discoveryService'
import type { JobSource } from '../discovery/types'

export function createDiscoveryRoutes(db: Db, jwtSecret: string, sources: JobSource[]) {
  const discoveryRoutes = new Hono<{ Variables: AuthVariables }>()
  discoveryRoutes.use('*', createRequireAuth(jwtSecret))

  discoveryRoutes.post('/run', async (c) => {
    const result = await runDiscovery(db, sources)
    return c.json(result)
  })

  return discoveryRoutes
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
import { ensureJobIndexes } from './discovery/discoveryService'
import { remoteOkSource } from './discovery/sources/remoteok'
import { weWorkRemotelySource } from './discovery/sources/weworkremotely'
import { himalayasSource } from './discovery/sources/himalayas'

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
Expected: PASS (36 total: 34 + 2 new)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/discovery.ts api/src/server.ts api/test/discovery.test.ts
git commit -m "Add discovery route and wire the 3 real adapters into the server"
```

---

## M2 Definition of Done

- `npm test` passes across `api` (36 tests) and `shared` (9 tests) — 45 total.
- `npm run typecheck` and `npm run build` pass across all three workspaces (dashboard is untouched by this milestone — no new dashboard work).
- Manual smoke test: start the api (`npm run dev --workspace=api` against local Mongo), register/login to get a token, `curl -X POST http://localhost:8787/discovery/run -H "Authorization: Bearer <token>"` returns a `{discovered, duplicates, errors}` JSON body with `discovered > 0` on a first run (assuming the three live sources are reachable), and a second identical run returns `discovered: 0` with `duplicates` equal to the first run's `discovered` count.
- Explicitly NOT in scope for M2 (deferred to later milestones): seeded-company/Greenhouse/Lever/key-gated sources, verification, scoring, materials generation, automation, `node-cron`/queue worker, dashboard UI for jobs, CI, deployment.
