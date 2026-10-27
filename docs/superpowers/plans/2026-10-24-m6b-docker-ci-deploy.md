# M6b — Docker Compose, CI, and Deployment Implementation Plan

> **For agentic workers:** This plan is infrastructure-as-code, not application code — there is no Vitest suite to drive it with TDD. Each task is verified by actually running the thing it configures (a real `docker compose up`, a real CI run, a real deploy), not by a test file. Use superpowers:executing-plans to work through it task-by-task; subagent-driven-development's per-task TDD review loop doesn't apply here in its usual form — each task's "review" is "did the real thing actually come up / actually go green / actually deploy."

**Goal:** Make the whole stack runnable with one command locally (`docker compose up`), make every push and PR run the full test suite in CI, and make a push to `main` deploy the API to a real host — closing out the "Operations" section of the design spec.

**Architecture:** A single multi-stage-free `Dockerfile` for the `api` service builds from the repo root (not from inside `api/`), because `api` depends on `@job-hunter/shared` through an npm workspace link — the Docker build context has to include `shared/` alongside `api/`, or `npm ci` inside the image can't resolve the workspace dependency. `docker-compose.yml` runs that image alongside a plain `mongo:7` container for local dev. One GitHub Actions workflow has two jobs: `test` (every push and PR — install, typecheck, build, test) and `deploy` (only on push to `main`, only after `test` passes, deploying to Fly.io via `fly.toml` at the repo root for the same build-context reason as the Dockerfile).

**Scope decision — the container runs `tsx` directly, not a compiled build.** This project has never had a `tsc`-compiled production build for `api` — `npm run dev` already runs TypeScript directly via `tsx`, and no milestone so far has needed anything else. Introducing a real compiled-JS production build would be a reasonable future optimization, but it's new scope this plan doesn't need to take on just to get a working container; the Docker image runs the exact same `tsx`-based execution the dev environment already uses, just without `watch` mode.

**Tech Stack:** Docker, Docker Compose, GitHub Actions, Fly.io (`flyctl`). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md` (see "Operations" — the last three bullets: Docker Compose for local dev, GitHub Actions CI with a Fly.io deploy step)

## Global Constraints

- **The production container must have the Chromium binary M5b's Playwright engine needs at runtime, not only in CI.** It's easy to remember "install Playwright's browser" for CI and forget that the *deployed* container runs the exact same automation code and needs the exact same binary — the Dockerfile's `RUN npx playwright install --with-deps chromium` step is not optional, and skipping it means the deployed API works for everything except the one feature (M5b) that most needed infrastructure like this in the first place.
- The Docker build context is the **repo root**, not `api/` — every `COPY` in the Dockerfile, and every path in `fly.toml`'s `[build]` section, is written relative to the repo root for exactly this reason.
- CI does **not** run a `mongo` service container — every test in this codebase uses `mongodb-memory-server` (a self-contained, embedded Mongo binary downloaded at test-run time), so there is nothing an external Mongo service would be doing for CI. Don't add one back in out of habit; it would sit there unused.
- No test in this codebase reads `ANTHROPIC_API_KEY`, `JWT_SECRET`, `MONGODB_URI`, or any other runtime env var directly — they're all only read inside `server.ts`'s `main()`, which the test suite never calls (tests construct Hono apps directly from route factories). CI's `test` job needs **no secrets at all** to pass; don't add placeholder env vars to it that nothing actually consumes.
- Fly.io's exact `fly.toml` schema has shifted before across versions; if anything in Task 3 doesn't match what `fly launch`'s interactive scaffold produces against the currently-installed `flyctl`, prefer what `fly launch` generates and adjust this plan's config to match rather than fighting the CLI.
- Secrets this plan assumes exist in the GitHub repo's Actions secrets before Task 3 can succeed: `FLY_API_TOKEN` (from `fly tokens create deploy`). Creating the Fly.io app itself (`fly launch`, done once, interactively, by a human) is a prerequisite this plan documents but cannot automate — CI only ever runs `fly deploy` against an app that already exists.

---

### Task 1: Dockerfile and docker-compose.yml for local dev

**Files:**
- Create: `api/Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Write the Dockerfile**

`api/Dockerfile` (build context is the repo root — see Global Constraints):

```dockerfile
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY api/package.json api/package.json
RUN npm ci --workspace=shared --workspace=api

RUN npx playwright install --with-deps chromium

COPY shared/ shared/
COPY api/ api/

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npx", "tsx", "api/src/server.ts"]
```

- [ ] **Step 2: Write the Compose file**

`docker-compose.yml` (repo root):

```yaml
services:
  mongo:
    image: mongo:7
    ports:
      - '27017:27017'
    volumes:
      - mongo-data:/data/db

  api:
    build:
      context: .
      dockerfile: api/Dockerfile
    ports:
      - '8787:8787'
    environment:
      MONGODB_URI: mongodb://mongo:27017
      MONGODB_DB_NAME: job_hunter
      JWT_SECRET: dev-secret-change-me
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      ANTHROPIC_DAILY_BUDGET_USD: '1'
      ANTHROPIC_MONTHLY_BUDGET_USD: '20'
      PORT: '8787'
    depends_on:
      - mongo
```

- [ ] **Step 3: Write `.dockerignore`**

`.dockerignore` (repo root — keeps `node_modules` and dev artifacts out of the build context, since they're reinstalled fresh inside the image):

```
node_modules
*/node_modules
.git
.env
*/.env
dashboard/dist
docs
resumes
.claude
```

- [ ] **Step 4: Verify by actually running it**

From the repo root:

```bash
docker compose up --build
```

Expected: the `mongo` container starts, the `api` image builds (including the `playwright install` step — this one takes noticeably longer than the rest; that's expected, not a hang), and once both are up, `curl http://localhost:8787/health` from another terminal returns `{"status":"ok"}`. Stop with `docker compose down` when confirmed.

If the build fails at `npm ci --workspace=shared --workspace=api` with a workspace-resolution error, confirm `package.json`/`package-lock.json`/`shared/package.json`/`api/package.json` were actually copied before that `RUN` step runs — the two-stage `COPY` (package files first, full source after) is there specifically for Docker layer caching and is easy to get the ordering wrong on a first pass.

- [ ] **Step 5: Commit**

```bash
git add api/Dockerfile docker-compose.yml .dockerignore
git commit -m "Add Dockerfile and docker-compose.yml for local dev"
```

---

### Task 2: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces a `test` job that runs on every push and pull request, and a `deploy` job (completed in Task 3) that will depend on it.

- [ ] **Step 1: Write the workflow's `test` job**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: npm ci

      - name: Install Playwright's Chromium binary
        run: npx playwright install --with-deps chromium
        working-directory: api

      - run: npm run typecheck

      - run: npm run build

      - run: npm test
```

- [ ] **Step 2: Verify by actually running it**

Push this branch (or open a PR) and watch the Actions tab. Expected: the `test` job runs all the same commands this project's own Definition of Done sections have been asking for manually since M1 (`typecheck`, `build`, `test` across all three workspaces), and goes green. If `npm test` fails in CI but passes locally, check `node --version` in the job logs first — this repo's own shell has repeatedly defaulted to the wrong Node version locally, and `actions/setup-node@v4` pinning to `'22'` is exactly what prevents that class of failure in CI, so a CI failure here is more likely a real difference (e.g., a flaky `mongodb-memory-server` download under GitHub's network) than the Node-version issue that's bitten this project locally.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add GitHub Actions CI workflow"
```

---

### Task 3: Fly.io deployment

**Files:**
- Create: `fly.toml`
- Modify: `.github/workflows/ci.yml` (add the `deploy` job)

**Interfaces:**
- Adds a `deploy` job to the existing workflow: `needs: test`, runs only when the event is a push to `main`, runs `flyctl deploy` from the repo root.

- [ ] **Step 1: One-time, manual, interactive setup (not automated by this plan)**

From the repo root, with `flyctl` installed and logged in (`fly auth login`):

```bash
fly launch --no-deploy
```

This interactively creates the Fly.io app and generates a `fly.toml` scaffold. **Let it detect the Dockerfile at `api/Dockerfile`** — if it instead offers to generate a different runtime (e.g. detecting Node and proposing its own buildpack), decline and point it at the existing Dockerfile; this project's image already does everything a generic buildpack would, plus the Playwright binary a generic buildpack wouldn't know to install. Confirm the generated `fly.toml` ends up at the **repo root**, not inside `api/` — if `fly launch` was run from inside `api/`, move the generated file up a level and fix its `[build] dockerfile` path to `api/Dockerfile` (relative to the repo root).

Then, still manually and once:

```bash
fly secrets set MONGODB_URI="<a real MongoDB Atlas connection string>" \
  JWT_SECRET="<a real random secret>" \
  ANTHROPIC_API_KEY="<a real Anthropic API key>" \
  ANTHROPIC_DAILY_BUDGET_USD="1" \
  ANTHROPIC_MONTHLY_BUDGET_USD="20"

fly tokens create deploy
```

Take the token `fly tokens create deploy` prints and add it as a GitHub Actions repository secret named `FLY_API_TOKEN` (repo Settings → Secrets and variables → Actions). This whole step is a one-time, human, interactive setup — nothing in this plan's remaining steps re-runs it, and CI never creates or modifies the Fly.io app itself, only deploys new versions to it.

- [ ] **Step 2: Confirm (or write, if `fly launch` didn't produce exactly this) `fly.toml`**

`fly.toml` (repo root):

```toml
app = "job-hunter-api"
primary_region = "iad"

[build]
  dockerfile = "api/Dockerfile"

[env]
  PORT = "8787"

[http_service]
  internal_port = 8787
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

Replace `app = "job-hunter-api"` with whatever name `fly launch` actually assigned if it differs (app names are globally unique on Fly.io, so the interactive step may have picked something else).

- [ ] **Step 3: Add the `deploy` job to the CI workflow**

Append this job to `.github/workflows/ci.yml`, alongside the existing `test` job:

```yaml
  deploy:
    needs: test
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

No `working-directory` override here — `flyctl deploy` needs to run from the repo root, where `fly.toml` and the Dockerfile's build context both actually are.

- [ ] **Step 4: Verify by actually running it**

Merge this branch's changes to `main` (or push directly, if that's this repo's convention). Watch the Actions tab: `test` runs first, `deploy` runs only after it passes, and only on this push to `main` (confirm a PR build does *not* trigger `deploy` — check an open PR's checks list for this same workflow run and confirm only `test` appears there, not `deploy`). Once `deploy` finishes, `curl https://<your-app-name>.fly.dev/health` should return `{"status":"ok"}` from the real, deployed instance.

- [ ] **Step 5: Commit**

```bash
git add fly.toml .github/workflows/ci.yml
git commit -m "Add Fly.io deployment via GitHub Actions"
```

---

## M6b Definition of Done

- `docker compose up --build` brings up a working local stack (confirmed via `curl http://localhost:8787/health` in Task 1).
- The GitHub Actions `test` job runs and passes on every push and pull request.
- The `deploy` job runs only on pushes to `main`, only after `test` passes, and successfully deploys to a real Fly.io app (confirmed via `curl` against the real `.fly.dev` URL in Task 3).
- This is the final plan in the roadmap this session produced. With M1 through M6b all written (M1-M3a already implemented and merged; M3b, M4a, M4b, M5a, M5b, M6a, M6b written but not yet implemented), the only features explicitly out of scope anywhere in this whole set — per the original design spec's own non-goals — are: supporting any AI provider other than Claude, and submitting any application without the explicit human approval M5a's gate enforces. Nothing in this plan set builds a path around either.
