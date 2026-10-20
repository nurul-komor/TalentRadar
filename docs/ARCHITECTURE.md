# Architecture

AI Remote Job Hunter — discovers remote job postings, verifies and scores
them, generates tailored application materials, and automates form-filling
behind a hard human-approval gate.

This is the living technical reference. The design rationale and
alternatives considered live in
`docs/superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md`.

## System overview

```
┌─────────────┐      HTTP       ┌──────────────────────────┐
│  dashboard  │ ───────────────▶│            api            │
│ React+Vite  │                 │   Cloudflare Workers+Hono │
│ (CF Pages)  │◀─────────────── │                            │
└─────────────┘                 └──────────┬────────────────┘
                                            │
                      ┌─────────────────────┼─────────────────────┐
                      ▼                     ▼                     ▼
              ┌───────────────┐   ┌─────────────────┐   ┌──────────────────┐
              │ MongoDB Atlas │   │  Cron Triggers   │   │  Queue (+ DLQ)   │
              └───────────────┘   └────────┬─────────┘   └─────────┬────────┘
                                            │                       │
                                            ▼                       ▼
                                   discovery / verify      document gen /
                                   / digest / reminders     automation runs
                                                                     │
                                                                     ▼
                                                        ┌─────────────────────┐
                                                        │  Playwright engine  │
                                                        │ local worker  OR    │
                                                        │ CF Browser Rendering│
                                                        └─────────────────────┘
```

## Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `api/` | HTTP API, business logic, scheduled/queued handlers | `shared/`, MongoDB Atlas, Anthropic API |
| `dashboard/` | User-facing UI: profile, jobs, materials, approvals, settings | `shared/`, `api/` (HTTP only) |
| `shared/` | Domain types/schemas shared across packages | — |

Workers-specific constraint: `MongoClient` must be created per-invocation
and closed via `ctx.waitUntil()`, not held at module scope — Workers
isolates don't keep a TCP connection alive across requests the way a
long-lived Node process would.

## Domain model

See the spec's [Data model](./superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md#data-model)
section for the full collection list. Core invariant: an `applications`
record cannot reach `submitted` without an `approvals` record, all
required answers resolved, and an explicit user confirmation on the
specific `automationRuns` entry — enforced at the data-write layer, not
just in the UI.

## Request flow: job → application

1. **Discovery** (cron) — source adapters pull candidate postings into
   `jobs` as unverified.
2. **Verification** (queue) — source-API check, then page-evidence check.
   Only evidenced-open jobs are scored.
3. **Scoring** (queue, Claude haiku for extraction + deterministic
   formula) — weighted match score written onto the `jobs` record.
4. **Materials** (user-triggered, Claude opus) — tailored CV, cover
   letter, outreach message, draft answers generated and versioned under
   `materials`.
5. **Automation run** (user-triggered) — Playwright engine claims a run,
   fills the target form from approved data, uploads CV, stops on
   CAPTCHA/login walls, reports `submitted` only on confirmed success.
6. **Approval gate** — regardless of what the automation run reports, the
   `applications` record only flips to `submitted` once the user has an
   `approvals` record and has clicked to confirm that specific run.

## External services

| Service | Used for | Required? |
|---|---|---|
| Anthropic API | Extraction, matching, document generation | Yes |
| MongoDB Atlas | Primary datastore | Yes |
| Cloudflare Workers/Pages/Queues/Browser Rendering | Hosting, scheduling, automation | Yes |
| Resend | Digest/reminder email delivery | No — system degrades to no email |
| Adzuna, Google search API | Extra discovery sources | No — key-gated, optional sources |

## Testing

- `api`, `shared`: Vitest.
- Form engine: Playwright against local mock application pages.
- `dashboard`: typecheck + Vite build as the CI gate.
- Integration: `wrangler dev` smoke test — register → profile → sources →
  add job → cron tick — run in the real Workers runtime, not just unit
  tests.

## Known gap as of 2026-10-20

This doc was written from a prior Claude Code cloud session's summary,
not from the session's actual source. That session has a complete,
tested implementation (73 API tests, 7 shared-package tests, 6 Playwright
tests, clean dashboard build, passing `wrangler dev` smoke test) sitting
in a sandbox at `/home/user/jobhunter`, but its push to
`github.com/nurul-komor/job-hunter` is blocked on connecting a GitHub
account to that session. Once unblocked, this doc and the spec should be
reconciled against the real code — see the spec's "Open items" section.
