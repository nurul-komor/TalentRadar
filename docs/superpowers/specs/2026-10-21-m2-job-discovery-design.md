# M2 — Job Discovery Design

Date: 2026-10-21
Status: Approved (brainstormed and reviewed in chat; this doc is the record
before the implementation plan is written)

## Purpose

Add the first stage of the job pipeline described in the main spec
(`docs/superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md`):
discover candidate remote job postings from external sources and store
them, unverified, in a `jobs` collection — without ever passing untrusted
scraped content to the Claude layer. This milestone builds only discovery;
verification, scoring, materials, and automation are explicitly later
milestones.

## Scope decisions made during brainstorming

- **Sources:** only the three no-credential sources — Remote OK, We Work
  Remotely, Himalayas. The spec's other two tiers (seeded-company career
  pages/Greenhouse/Lever, and key-gated Adzuna/Google search) are deferred
  to a later milestone. Reason: fastest path to a working, testable
  pipeline with zero external setup (no API keys, no company seeding to
  validate first).
- **Trigger mechanism:** a manually-triggered `POST /discovery/run` API
  endpoint that runs synchronously and returns counts. No `node-cron`, no
  queue, no background worker — M1 already deferred all scheduling/queue
  infrastructure to M6 (Operations), and this milestone doesn't reverse
  that call. Automated scheduling is a thin wrapper around this same
  endpoint once M6 exists.
- **Verification boundary:** this milestone stores raw discovered postings
  with `status: 'discovered'`. The main spec's "never stored without going
  through verification first" is read as "never sent to the Claude layer
  without verification first" — the actual hard boundary, which this
  milestone respects by simply containing no Claude-calling code at all.
  Storing with an explicit, narrow status field lets the next milestone
  pick up `'discovered'` jobs and verify/score them without re-discovering.
- **Himalayas pagination:** fetch only the first page (~50-100 most-recent
  results) per sweep, not the full ~124k-listing catalog. A single-user,
  manually-triggered tool has no use for exhaustive pagination on every
  run; full/incremental sync is a natural addition once a real scheduler
  exists (M6+) to run sweeps repeatedly over time.

## Verified source facts (researched 2026-10-21)

All three are genuinely no-auth, machine-readable, and none disallow the
specific endpoint needed per their `robots.txt`.

| Source | Endpoint | Format | Unique key | Rate-limit signal |
|---|---|---|---|---|
| Remote OK | `https://remoteok.com/api` | JSON array (first element is a legal blob — skip it) | `id` | `robots.txt`: `Crawl-delay: 1` |
| We Work Remotely | `https://weworkremotely.com/categories/remote-programming-jobs.rss` | RSS/XML | `guid` (= link) | none stated |
| Himalayas | `https://himalayas.app/jobs/api` | JSON, cursor-paginated (`{totalCount, nextCursor, jobs: [...]}`) | `guid` (no `id` field) | none stated |

Field shapes differ meaningfully (Remote OK has flat `salary_min`/`salary_max`;
We Work Remotely has no structured salary, only free text in the
description; Himalayas has structured salary + currency + period) — the
adapter layer normalizes per-source, there is no shared parser.

Since none of the three state a hard requests-per-minute limit (Remote
OK's `Crawl-delay: 1` is the only numeric signal found), a conservative
self-imposed rate (1 req/sec per host) is applied uniformly as a judgment
call, not a derived requirement.

## Architecture

New code under `api/src/discovery/`:

- `types.ts` — the `JobSource` interface (`id: string`,
  `fetchJobs(): Promise<RawJobPosting[]>`) and the common `RawJobPosting`
  shape adapters normalize into.
- `sources/remoteok.ts`, `sources/weworkremotely.ts`,
  `sources/himalayas.ts` — one `JobSource` implementation per source, each
  owning its own response parsing and field normalization.
- `fetchWithPolicy.ts` — shared helper wrapping `fetch` with a named
  User-Agent, a 10s timeout (`AbortController`), and the 1 req/sec/host
  throttle.
- `normalizeUrl.ts` — lowercases host, strips tracking query params, drops
  trailing slash.
- `discoveryService.ts` — orchestrates: run all sources via
  `Promise.allSettled`, normalize, dedupe-check against the `jobs`
  collection, upsert. Returns `{ discovered, duplicates, errors }`.

New route: `api/src/routes/discovery.ts`, a DI factory
`createDiscoveryRoutes(db, jwtSecret, sources: JobSource[])` exposing a
single endpoint, `POST /discovery/run` (mounted at `/discovery` in
`server.ts` with the route itself defined at `/run`), behind
`createRequireAuth` (same bearer-token middleware as `/profile` — this
endpoint triggers outbound fetches and DB writes in a single-user app, so
it isn't left open). `server.ts`'s composition root wires in the 3 real
adapters; tests inject fakes.

New shared schema: `shared/src/schemas/job.ts` — `JobSchema` (Zod),
following the same pattern as `profile.ts`, exported from
`shared/src/index.ts`.

## Data model

`jobs` collection documents:

```ts
{
  _id: ObjectId,
  sourceId: 'remoteok' | 'weworkremotely' | 'himalayas',
  sourceJobId: string,       // remoteok: id; wwr: guid/link; himalayas: guid
  normalizedUrl: string,
  title: string,
  company: string,
  rawDescription: string,    // untrusted, never sent to Claude in this milestone
  location: string | null,
  salaryMin: number | null,
  salaryMax: number | null,
  postedAt: string | null,   // ISO, from source if available
  status: 'discovered',      // future values ('verified'/'rejected') land in M3
  discoveredAt: string,      // ISO, when our sweep found it
  updatedAt: string,
}
```

### Dedupe

Per the main spec: source id, normalized URL, and company+title within a
60-day window.

- Two hard-unique indexes catch exact re-discovery: `{sourceId,
  sourceJobId}` and `{normalizedUrl}`.
- The company+title/60-day rule is a *window* check, not something a DB
  index can express directly — an application-level query
  (`findOne({company, title, discoveredAt: {$gte: cutoff}})`) runs before
  insert.
- Any match on any of the three checks → skip, don't touch the existing
  document. No match → insert fresh with `status: 'discovered'`.

## Error handling

- `Promise.allSettled` across the 3 adapters: one source failing
  (network error, bad JSON, timeout) never blocks or fails the others.
  The route response surfaces per-source errors:
  `{ discovered: N, duplicates: M, errors: [{ sourceId, message }] }`.
- Each adapter's fetch has its own `AbortController` timeout (~10s) so a
  hanging source can't stall the whole sweep.
- `fetchWithPolicy()` is the single place the named User-Agent and
  per-host throttle are enforced, so every adapter gets this for free
  rather than reimplementing it.

## Testing strategy

- **Adapter tests** mock `fetch` with realistic fixtures matching the
  real response shapes found during research — no live network calls in
  the test suite (third-party uptime shouldn't gate CI/local tests).
- **`discoveryService` tests** use a real `mongodb-memory-server` for the
  dedupe/upsert logic (no mocks there, consistent with the project's
  existing convention), with adapters stubbed via dependency injection so
  the test fully controls what "raw jobs" come back.
- **Route tests** follow the same pattern as `auth.test.ts`/
  `profile.test.ts`: mount `createDiscoveryRoutes(db, jwtSecret,
  fakeSources)`, assert the response shape, assert the route requires a
  bearer token (401 without one).

## Explicitly out of scope for M2

- Seeded-company career-page / Greenhouse / Lever adapters (uses
  `data/seed-companies-bd.json` — deferred to a later milestone).
- Key-gated sources (Adzuna, Google search).
- Verification (page-evidence checking) and scoring — the next milestone
  after this one.
- Any Claude/Anthropic API usage.
- `node-cron` scheduling and the MongoDB-backed queue worker — both
  remain deferred to M6 (Operations), per M1's plan.
- Himalayas full pagination / incremental sync.
