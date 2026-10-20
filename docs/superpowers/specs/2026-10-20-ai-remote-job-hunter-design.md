# AI Remote Job Hunter — Design Spec

Date: 2026-10-20
Status: Approved (reproducing a design already built and tested in a prior
Claude Code cloud session; this spec is the local record before
implementation starts here).

## Purpose

Automate the remote-job search pipeline end to end: discover postings,
verify they're genuinely open, score them against the user's profile,
generate tailored application materials, and fill out application forms —
while keeping a hard human-approval gate before anything is ever submitted.

## Non-goals

- Not a general-purpose scraper or lead-gen tool.
- Does not submit any application without an explicit user approval click.
- Does not support AI providers other than Claude.

## Architecture

Monorepo with three packages:

- `api/` — Cloudflare Workers + [Hono](https://hono.dev), stateless HTTP
  API. Talks to MongoDB Atlas with a **per-invocation** `MongoClient`,
  closed via `ctx.waitUntil()` — Workers isolates cannot keep a TCP
  connection alive across requests, so the client cannot be module-scoped
  the way it would be on a long-lived Node server.
- `dashboard/` — React + Vite, deployed as a static build to Cloudflare
  Pages. Talks to `api/` only over HTTP; no direct DB access.
- `shared/` — TypeScript types and Zod schemas for the domain objects
  below, imported by both `api` and `dashboard` so request/response
  shapes can't drift.

Cross-cutting infra:

- **Cron Triggers** drive scheduled work: job discovery sweeps,
  verification re-checks, digest emails, follow-up reminders.
- **Cloudflare Queues** carry background work — discovery, verification,
  document generation, automation runs — with retries and a dead-letter
  queue for alerts.
- **Playwright** drives form-filling, two execution modes:
  - local worker process, browser left open so the user can watch/review
    a run live;
  - Cloudflare Browser Rendering, for runs triggered from the hosted
    dashboard without a local machine.

## Data model

MongoDB Atlas collections (names indicative, not final):

| Collection | Purpose |
|---|---|
| `profiles` | User identity, eligibility, preferences, parsed master CV text |
| `companies` | Target company directory (seedable via script) |
| `jobs` | Discovered postings: source id, normalized URL, company, title, verification evidence, score |
| `materials` | Tailored CV / cover letter / outreach message / draft answers, versioned per job, exported as PDF + DOCX |
| `applications` | Application status machine; duplicate-guarded independently of ingest-level dedupe |
| `automationRuns` | Claim → fill → result → approval → confirmation lifecycle for one form-fill attempt |
| `approvals` | Explicit approval record — required before an application can reach `submitted` |
| `auditLog` | Append-only record of state-changing actions |
| `notifications` | Digest/reminder delivery tracking |

Dedupe keys on `jobs`: source id, normalized URL, and (company + title)
within a 60-day window. Dedupe is enforced again at the `applications`
level (not just at ingest) so a job that slips past ingest-level merging
still can't be double-applied-to.

## Discovery

Nine source adapters behind one `JobSource` interface:

- No credentials required: Himalayas, Remote OK, We Work Remotely.
- Require seeded `companies`: official career pages (schema.org
  `JobPosting`), Greenhouse, Lever.
- Key-gated: Adzuna, Google search-based discovery.

All adapters enforce robots.txt, per-host rate limiting, and a named
User-Agent. Discovery output is untrusted input — never passed to the
Claude layer or stored without going through verification first.

## Verification and scoring

Two-stage verification: a source-API check first where available, then a
page-evidence check. An HTTP 200 alone is never sufficient to mark a job
open — the page content must show positive evidence of an open listing.

Claude layer (Anthropic SDK, Claude as the only AI provider):

- `claude-opus-4-8` for matching and document generation (CV tailoring,
  cover letters, outreach messages, draft answers).
- `claude-haiku-4-5-20251001` for cheap structured extraction (parsing
  job page content into normalized fields).
- All Claude calls use schema-validated structured output.
- Content-hash cache: unchanged job content never re-triggers a Claude
  call.
- Daily and monthly budget caps with deferral when exceeded.
- Prompts explicitly treat scraped listings/pages as untrusted content —
  instructions embedded in job postings must not be followed.

Matching produces a deterministic weighted score; unknown eligibility or
unknown salary pulls the score down rather than being ignored.

## Materials generation

Master CV uploaded as PDF/DOCX, parsed to plain text (pdf.js for PDF;
mammoth for DOCX — tests must feed mammoth Node-compatible input, and the
upload buffer must be copied before parsing since pdf.js detaches it).
From that, per job: tailored CV, cover letter, outreach message, and
draft answers to application questions — each versioned per job and
exportable as PDF and DOCX. The generation prompt must list requirements
the candidate doesn't meet rather than inventing matching experience.

Field-matching in the automation engine is intentionally narrow: only
explicit cover/motivation-letter labels trigger auto-fill from the cover
letter. Open-ended questions (e.g. "Why do you want to work with us?")
are left for the user to answer, not auto-filled from the cover letter.

## Automation and the approval gate

Shared form-filling engine (used by both the local Playwright worker and
Cloudflare Browser Rendering):

- Fills fields from the user's approved profile/materials data.
- Radio and checkbox groups are labeled from their fieldset legend, not
  from the individual option text.
- Uploads the tailored CV file.
- Never ticks consent/terms checkboxes automatically.
- Stops and surfaces a manual link on CAPTCHA or login walls.
- Reports `submitted` only when the destination page shows an actual
  confirmation — not merely "form posted without error."

`submitted` on an `applications` record is unreachable without all three:
an explicit `approvals` record, all required answers resolved, and a user
click confirming the specific automation run. There is no code path that
skips this gate.

## Operations

- Cron-triggered discovery/verification/digest/reminder jobs.
- Durable queue with retries and dead-letter alerting for background work.
- Daily digest and follow-up reminder emails (Resend, optional — system
  functions without it, just no email delivery).
- Append-only audit log for state-changing actions.
- Login rate limiting on the dashboard's auth.
- Docker Compose for local dev (API + local Mongo).
- GitHub Actions CI, with a deploy step for Cloudflare.

## Testing strategy

- Vitest for `api` (HTTP handlers, verification/dedupe logic, automation
  lifecycle: claim, result handling, approval gate, confirmation
  requirement) and `shared`.
- Playwright tests against local mock application pages for the form
  engine (radio/checkbox labeling, field matching, upload).
- Dashboard: typecheck + Vite build as a gate (no e2e UI tests initially).
- `wrangler dev` smoke test exercising the real Workers runtime end to
  end: register → profile → sources → add job → cron tick.

## Environment / secrets

`ANTHROPIC_API_KEY`, MongoDB Atlas connection URI, Cloudflare account
(Workers Paid recommended for cron CPU time and Browser Rendering),
optional `RESEND_API_KEY` for email delivery.

## Open items to reconcile once the real repo is available

This spec was reconstructed from a prior Claude Code cloud session's chat
summary, not read directly from its source code (that session's GitHub
push is currently blocked on a missing GitHub App connection). Once the
code is available, reconcile:

- Exact collection/field names and indexes.
- Exact API route list and request/response shapes.
- Exact weighting formula used in match scoring.
- Package manager / build tooling specifics (Node 22, Express 5 was the
  pre-Cloudflare-pivot stack; confirm nothing from that phase lingers).
- Exact queue/cron binding names in `wrangler.toml`.
- Dashboard auth mechanism (session cookie vs. token) — referenced via
  "login rate limiting" but not otherwise specified here; decide during
  planning if the real repo isn't available in time.
