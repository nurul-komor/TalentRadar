# M1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo (api/dashboard/shared), the Cloudflare Workers MongoDB connection pattern, JWT-based auth, and profile CRUD — the foundation every later milestone (discovery, scoring, materials, automation, operations) builds on.

**Architecture:** npm-workspaces monorepo. `api/` is a Cloudflare Workers + Hono app talking to MongoDB Atlas with a per-invocation client closed via `ctx.waitUntil()`. `dashboard/` is a React + Vite SPA that talks only to `api/` over HTTP. `shared/` holds Zod schemas both packages import so request/response shapes can't drift. Login rate limiting and full CI/deploy are explicitly out of scope here — they belong to M6 (Operations).

**Tech Stack:** TypeScript (strict), Hono 4, `mongodb` driver 6 (not Mongoose), Zod 3, `hono/jwt` for tokens, Web Crypto PBKDF2 for password hashing, Vitest + `mongodb-memory-server` for api/shared tests, React 18 + Vite 5 + react-router-dom 6 + Tailwind CSS 3 for the dashboard.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md`

## Global Constraints

- Node.js 22+ for all local tooling/dev.
- TypeScript strict mode everywhere.
- Cloudflare Workers runtime: `MongoClient` must be created per-invocation and closed via `ctx.waitUntil()` — never module-scoped (spec: Architecture).
- `api` and `shared` are tested with Vitest against a real `mongodb-memory-server` instance (not mocks); `dashboard` is gated by typecheck + Vite build only — no e2e UI tests in M1 (spec: Testing strategy).
- Dashboard auth: JWT bearer token via `Authorization: Bearer <token>` header (spec: "Decisions made during planning").
- Claude is the only AI provider for this project — not used in M1, but no other AI SDK is ever introduced (spec: Non-goals).
- Package manager: npm workspaces (built into Node — no new tool introduced for monorepo management).

---

### Task 1: Monorepo scaffold + health check

**Files:**
- Create: `package.json` (root)
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `docs/SETUP.md`
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/vitest.config.ts`
- Create: `api/wrangler.toml`
- Create: `api/.dev.vars.example`
- Create: `api/src/env.ts`
- Create: `api/src/index.ts`
- Test: `api/test/health.test.ts`

**Interfaces:**
- Produces: `Env` interface (`MONGODB_URI: string`, `MONGODB_DB_NAME: string`, `JWT_SECRET: string`) from `api/src/env.ts` — every later api task imports this.
- Produces: default-exported Hono `app` from `api/src/index.ts` — later tasks mount routes onto it with `app.route(...)`.

- [ ] **Step 1: Create root files**

`package.json`:
```json
{
  "name": "job-hunter",
  "private": true,
  "workspaces": [
    "shared",
    "api",
    "dashboard"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.wrangler/
.dev.vars
*.log
```

`docker-compose.yml`:
```yaml
services:
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

volumes:
  mongo-data:
```

`docs/SETUP.md`:
```markdown
# Local Setup

## Prerequisites
- Node.js 22+
- Docker (for local MongoDB)

## Install

    npm install

## Local MongoDB

    docker compose up -d mongo

## API

    cp api/.dev.vars.example api/.dev.vars
    # edit api/.dev.vars: set JWT_SECRET to any random string;
    # MONGODB_URI can stay as mongodb://localhost:27017 for local dev
    npm run dev --workspace=api

API runs at http://localhost:8787.

## Dashboard

    npm run dev --workspace=dashboard

Dashboard runs at http://localhost:5173 and talks to the API at
http://localhost:8787 by default (override with VITE_API_BASE_URL).

## Tests

    npm test
```

- [ ] **Step 2: Create the `api` package**

`api/package.json`:
```json
{
  "name": "@job-hunter/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@job-hunter/shared": "*",
    "hono": "^4.6.9",
    "mongodb": "^6.9.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241022.0",
    "mongodb-memory-server": "^10.1.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.3",
    "wrangler": "^3.84.0"
  }
}
```

`api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
  },
})
```

`api/wrangler.toml`:
```toml
name = "job-hunter-api"
main = "src/index.ts"
compatibility_date = "2026-10-20"

[vars]
MONGODB_DB_NAME = "job_hunter"

# MONGODB_URI and JWT_SECRET are set via `wrangler secret put` in production,
# and via .dev.vars (gitignored) for local `wrangler dev`.
```

`api/.dev.vars.example`:
```
MONGODB_URI=mongodb://localhost:27017
JWT_SECRET=change-me-in-dev
```

`api/src/env.ts`:
```ts
export interface Env {
  MONGODB_URI: string
  MONGODB_DB_NAME: string
  JWT_SECRET: string
}
```

`api/src/index.ts`:
```ts
import { Hono } from 'hono'
import type { Env } from './env'

const app = new Hono<{ Bindings: Env }>()

app.get('/health', (c) => c.json({ status: 'ok' }))

export default app
```

- [ ] **Step 3: Write the failing test**

`api/test/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import app from '../src/index'

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 4: Install dependencies and run the test**

Run: `npm install && npm run test --workspace=api`
Expected: PASS (1 test) — this confirms the scaffold wiring (package.json, tsconfig, vitest config) is correct, not just the handler logic.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore docker-compose.yml docs/SETUP.md api/
git commit -m "Scaffold monorepo and api package with health check"
```

---

### Task 2: Shared package — Zod schemas

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/vitest.config.ts`
- Create: `shared/src/schemas/auth.ts`
- Create: `shared/src/schemas/profile.ts`
- Create: `shared/src/index.ts`
- Test: `shared/test/schemas.test.ts`

**Interfaces:**
- Produces: `RegisterRequestSchema`, `LoginRequestSchema` and their inferred types `RegisterRequest`, `LoginRequest` from `shared/src/schemas/auth.ts` — consumed by `api/src/routes/auth.ts` (Task 6).
- Produces: `ProfileSchema`, `ProfileUpdateSchema`, `EligibilitySchema`, `ProfilePreferencesSchema` and inferred types `Profile`, `ProfileUpdate`, `Eligibility`, `ProfilePreferences` from `shared/src/schemas/profile.ts` — consumed by `api/src/routes/profile.ts` (Task 7) and `dashboard/src/pages/Profile.tsx` (Task 9).
- All exported together from `shared/src/index.ts` as `@job-hunter/shared`.

- [ ] **Step 1: Create the package scaffold**

`shared/package.json`:
```json
{
  "name": "@job-hunter/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.3"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 2: Write the failing test**

`shared/test/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  ProfileSchema,
  ProfileUpdateSchema,
} from '../src/index'

describe('auth schemas', () => {
  it('accepts a valid register request', () => {
    const result = RegisterRequestSchema.safeParse({
      email: 'a@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a password shorter than 8 characters', () => {
    const result = RegisterRequestSchema.safeParse({
      email: 'a@example.com',
      password: 'short',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email on login', () => {
    const result = LoginRequestSchema.safeParse({
      email: 'not-an-email',
      password: 'whatever',
    })
    expect(result.success).toBe(false)
  })
})

describe('profile schemas', () => {
  it('accepts a full profile with defaults applied to preferences', () => {
    const result = ProfileSchema.safeParse({
      email: 'a@example.com',
      eligibility: { workAuthorization: 'unknown', countries: [] },
      preferences: {},
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.preferences.remoteOnly).toBe(true)
      expect(result.data.preferences.targetRoles).toEqual([])
    }
  })

  it('rejects an unknown workAuthorization enum value', () => {
    const result = ProfileSchema.safeParse({
      email: 'a@example.com',
      eligibility: { workAuthorization: 'alien', countries: [] },
      preferences: {},
    })
    expect(result.success).toBe(false)
  })

  it('allows a partial update with only preferences', () => {
    const result = ProfileUpdateSchema.safeParse({
      preferences: { targetRoles: ['Software Engineer'] },
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=shared`
Expected: FAIL — `../src/index` has no exported members yet (module doesn't exist).

- [ ] **Step 4: Implement the schemas**

`shared/src/schemas/auth.ts`:
```ts
import { z } from 'zod'

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>
export type LoginRequest = z.infer<typeof LoginRequestSchema>
```

`shared/src/schemas/profile.ts`:
```ts
import { z } from 'zod'

export const EligibilitySchema = z.object({
  workAuthorization: z.enum(['citizen', 'permanent_resident', 'visa_required', 'unknown']),
  countries: z.array(z.string()).default([]),
})

export const ProfilePreferencesSchema = z.object({
  targetRoles: z.array(z.string()).default([]),
  remoteOnly: z.boolean().default(true),
  minSalaryUsd: z.number().int().nonnegative().nullable().default(null),
  locations: z.array(z.string()).default([]),
})

export const ProfileSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  eligibility: EligibilitySchema,
  preferences: ProfilePreferencesSchema,
  cvText: z.string().nullable().default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const ProfileUpdateSchema = z
  .object({
    eligibility: EligibilitySchema,
    preferences: ProfilePreferencesSchema,
  })
  .partial()

export type Eligibility = z.infer<typeof EligibilitySchema>
export type ProfilePreferences = z.infer<typeof ProfilePreferencesSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>
```

`shared/src/index.ts`:
```ts
export * from './schemas/auth'
export * from './schemas/profile'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=shared`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add shared/
git commit -m "Add shared Zod schemas for auth and profile"
```

---

### Task 3: MongoDB per-invocation connection helper

**Files:**
- Modify: `api/package.json` (no change needed — `mongodb` and `mongodb-memory-server` already added in Task 1)
- Create: `api/src/db.ts`
- Test: `api/test/db.test.ts`

**Interfaces:**
- Consumes: `Env` from `api/src/env.ts` (Task 1).
- Produces: `withDb<T>(env: Env, ctx: ExecutionContext, fn: (db: Db) => Promise<T>): Promise<T>` from `api/src/db.ts` — every route handler in Tasks 6–7 wraps its DB access in this.

- [ ] **Step 1: Write the failing test**

`api/test/db.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { withDb } from '../src/db'
import type { Env } from '../src/env'

function fakeCtx(): ExecutionContext {
  return {
    waitUntil: (p: Promise<unknown>) => {
      p.catch(() => {})
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext
}

describe('withDb', () => {
  let mongod: MongoMemoryServer
  let env: Env

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    env = {
      MONGODB_URI: mongod.getUri(),
      MONGODB_DB_NAME: 'test',
      JWT_SECRET: 'test-secret',
    }
  })

  afterAll(async () => {
    await mongod.stop()
  })

  it('connects, runs the callback, and returns its result', async () => {
    const result = await withDb(env, fakeCtx(), async (db) => {
      await db.collection('ping').insertOne({ ok: 1 })
      return db.collection('ping').countDocuments()
    })
    expect(result).toBe(1)
  })

  it('opens a fresh connection on every call — data from one call is visible in the next', async () => {
    await withDb(env, fakeCtx(), async (db) => {
      await db.collection('cross_call').insertOne({ marker: 'written-in-call-1' })
    })
    const found = await withDb(env, fakeCtx(), async (db) => {
      return db.collection('cross_call').findOne({ marker: 'written-in-call-1' })
    })
    expect(found?.marker).toBe('written-in-call-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../src/db` does not exist.

- [ ] **Step 3: Implement `withDb`**

`api/src/db.ts`:
```ts
import { MongoClient, type Db } from 'mongodb'
import type { Env } from './env'

export async function withDb<T>(
  env: Env,
  ctx: ExecutionContext,
  fn: (db: Db) => Promise<T>
): Promise<T> {
  const client = new MongoClient(env.MONGODB_URI)
  await client.connect()
  const db = client.db(env.MONGODB_DB_NAME)
  try {
    return await fn(db)
  } finally {
    ctx.waitUntil(client.close())
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (3 tests total: health + 2 db tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/db.ts api/test/db.test.ts
git commit -m "Add per-invocation MongoDB connection helper"
```

---

### Task 4: Password hashing

**Files:**
- Create: `api/src/lib/password.ts`
- Test: `api/test/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>` and `verifyPassword(password: string, stored: string): Promise<boolean>` from `api/src/lib/password.ts` — consumed by `api/src/routes/auth.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

`api/test/password.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/password'

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('produces a different hash each time due to random salt', async () => {
    const hash1 = await hashPassword('same-password')
    const hash2 = await hashPassword('same-password')
    expect(hash1).not.toBe(hash2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../src/lib/password` does not exist.

- [ ] **Step 3: Implement password hashing**

`api/src/lib/password.ts`:
```ts
const ITERATIONS = 100_000
const HASH_ALGORITHM = 'SHA-256'
const SALT_BYTES = 16
const KEY_LENGTH_BITS = 256

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: HASH_ALGORITHM },
    keyMaterial,
    KEY_LENGTH_BITS
  )
}

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const derived = await deriveBits(password, salt, ITERATIONS)
  return `pbkdf2:${ITERATIONS}:${toHex(salt)}:${toHex(derived)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsStr, saltHex, hashHex] = stored.split(':')
  if (scheme !== 'pbkdf2') return false
  const iterations = Number(iterationsStr)
  const salt = fromHex(saltHex)
  const derived = await deriveBits(password, salt, iterations)
  return toHex(derived) === hashHex
}
```

Note: uses the global `crypto` object (Web Crypto API), available natively in both Node 22 and the real Workers runtime — no `nodejs_compat` flag or extra dependency required.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (6 tests total)

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/password.ts api/test/password.test.ts
git commit -m "Add PBKDF2 password hashing"
```

---

### Task 5: JWT helpers

**Files:**
- Create: `api/src/lib/jwt.ts`
- Test: `api/test/jwt.test.ts`

**Interfaces:**
- Produces: `AuthTokenPayload` (`{ sub: string, exp: number }`), `createAuthToken(profileId: string, secret: string): Promise<string>`, `verifyAuthToken(token: string, secret: string): Promise<AuthTokenPayload>` from `api/src/lib/jwt.ts` — consumed by `api/src/routes/auth.ts` (Task 6) and `api/src/middleware/auth.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

`api/test/jwt.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createAuthToken, verifyAuthToken } from '../src/lib/jwt'

describe('auth tokens', () => {
  const secret = 'test-secret'

  it('round-trips a profile id through sign and verify', async () => {
    const token = await createAuthToken('profile-123', secret)
    const payload = await verifyAuthToken(token, secret)
    expect(payload.sub).toBe('profile-123')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await createAuthToken('profile-123', secret)
    await expect(verifyAuthToken(token, 'wrong-secret')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../src/lib/jwt` does not exist.

- [ ] **Step 3: Implement JWT helpers**

`api/src/lib/jwt.ts`:
```ts
import { sign, verify } from 'hono/jwt'

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export interface AuthTokenPayload {
  sub: string
  exp: number
}

export async function createAuthToken(profileId: string, secret: string): Promise<string> {
  const payload: AuthTokenPayload = {
    sub: profileId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  }
  return sign(payload, secret)
}

export async function verifyAuthToken(token: string, secret: string): Promise<AuthTokenPayload> {
  return verify(token, secret) as Promise<AuthTokenPayload>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (8 tests total)

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/jwt.ts api/test/jwt.test.ts
git commit -m "Add JWT sign/verify helpers"
```

---

### Task 6: Auth routes (register, login) and auth middleware

**Files:**
- Create: `api/src/middleware/auth.ts`
- Create: `api/src/routes/auth.ts`
- Modify: `api/src/index.ts`
- Test: `api/test/auth.test.ts`

**Interfaces:**
- Consumes: `withDb` (Task 3), `hashPassword`/`verifyPassword` (Task 4), `createAuthToken`/`verifyAuthToken` (Task 5), `RegisterRequestSchema`/`LoginRequestSchema` (Task 2).
- Produces: `requireAuth` middleware and `AuthVariables` (`{ profileId: string }`) from `api/src/middleware/auth.ts` — consumed by `api/src/routes/profile.ts` (Task 7).
- Produces: `authRoutes` Hono sub-app from `api/src/routes/auth.ts`, mounted at `/auth` in `api/src/index.ts`. Endpoints: `POST /auth/register` → `201 { token }` or `409` on duplicate email; `POST /auth/login` → `200 { token }` or `401` on bad credentials.

- [ ] **Step 1: Write the failing test**

`api/test/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import app from '../src/index'
import type { Env } from '../src/env'

function fakeCtx(): ExecutionContext {
  return {
    waitUntil: (p: Promise<unknown>) => {
      p.catch(() => {})
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext
}

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

describe('auth routes', () => {
  let mongod: MongoMemoryServer
  let env: Env

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
  })

  afterAll(async () => {
    await mongod.stop()
  })

  beforeEach(() => {
    env = {
      MONGODB_URI: mongod.getUri(),
      MONGODB_DB_NAME: uniqueDbName(),
      JWT_SECRET: 'test-secret',
    }
  })

  it('registers a new profile and returns a token', async () => {
    const res = await app.request(
      '/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
      },
      env,
      fakeCtx()
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
  })

  it('rejects registering the same email twice', async () => {
    const payload = { email: 'dup@example.com', password: 'password123' }
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
    await app.request('/auth/register', init, env, fakeCtx())
    const res = await app.request('/auth/register', init, env, fakeCtx())
    expect(res.status).toBe(409)
  })

  it('rejects an invalid register payload', async () => {
    const res = await app.request(
      '/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: 'short' }),
      },
      env,
      fakeCtx()
    )
    expect(res.status).toBe(400)
  })

  it('logs in with correct credentials and rejects wrong ones', async () => {
    const payload = { email: 'login@example.com', password: 'password123' }
    const registerInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
    await app.request('/auth/register', registerInit, env, fakeCtx())

    const ok = await app.request(
      '/auth/login',
      registerInit,
      env,
      fakeCtx()
    )
    expect(ok.status).toBe(200)
    expect(typeof (await ok.json()).token).toBe('string')

    const bad = await app.request(
      '/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, password: 'wrong-password' }),
      },
      env,
      fakeCtx()
    )
    expect(bad.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `/auth/register` and `/auth/login` return 404 (no route mounted yet).

- [ ] **Step 3: Implement the auth middleware**

`api/src/middleware/auth.ts`:
```ts
import { createMiddleware } from 'hono/factory'
import { verifyAuthToken } from '../lib/jwt'
import type { Env } from '../env'

export interface AuthVariables {
  profileId: string
}

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const header = c.req.header('Authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'missing bearer token' }, 401)
    }
    const token = header.slice('Bearer '.length)
    try {
      const payload = await verifyAuthToken(token, c.env.JWT_SECRET)
      c.set('profileId', payload.sub)
      await next()
    } catch {
      return c.json({ error: 'invalid or expired token' }, 401)
    }
  }
)
```

- [ ] **Step 4: Implement the auth routes**

`api/src/routes/auth.ts`:
```ts
import { Hono } from 'hono'
import { RegisterRequestSchema, LoginRequestSchema } from '@job-hunter/shared'
import { withDb } from '../db'
import { hashPassword, verifyPassword } from '../lib/password'
import { createAuthToken } from '../lib/jwt'
import type { Env } from '../env'

export const authRoutes = new Hono<{ Bindings: Env }>()

authRoutes.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = RegisterRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400)
  }
  const { email, password } = parsed.data

  return withDb(c.env, c.executionCtx, async (db) => {
    const profiles = db.collection('profiles')
    const existing = await profiles.findOne({ email })
    if (existing) {
      return c.json({ error: 'email already registered' }, 409)
    }

    const passwordHash = await hashPassword(password)
    const now = new Date().toISOString()
    const result = await profiles.insertOne({
      email,
      passwordHash,
      eligibility: { workAuthorization: 'unknown', countries: [] },
      preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
      cvText: null,
      createdAt: now,
      updatedAt: now,
    })

    const token = await createAuthToken(result.insertedId.toString(), c.env.JWT_SECRET)
    return c.json({ token }, 201)
  })
})

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = LoginRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400)
  }
  const { email, password } = parsed.data

  return withDb(c.env, c.executionCtx, async (db) => {
    const profiles = db.collection('profiles')
    const profile = await profiles.findOne({ email })
    if (!profile || !(await verifyPassword(password, profile.passwordHash))) {
      return c.json({ error: 'invalid email or password' }, 401)
    }

    const token = await createAuthToken(profile._id.toString(), c.env.JWT_SECRET)
    return c.json({ token })
  })
})
```

- [ ] **Step 5: Mount the routes**

`api/src/index.ts`:
```ts
import { Hono } from 'hono'
import type { Env } from './env'
import { authRoutes } from './routes/auth'

const app = new Hono<{ Bindings: Env }>()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/auth', authRoutes)

export default app
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (12 tests total)

- [ ] **Step 7: Commit**

```bash
git add api/src/middleware/auth.ts api/src/routes/auth.ts api/src/index.ts api/test/auth.test.ts
git commit -m "Add register/login routes and bearer-token auth middleware"
```

---

### Task 7: Profile routes (GET, PUT)

**Files:**
- Create: `api/src/routes/profile.ts`
- Modify: `api/src/index.ts`
- Test: `api/test/profile.test.ts`

**Interfaces:**
- Consumes: `withDb` (Task 3), `requireAuth`/`AuthVariables` (Task 6), `ProfileUpdateSchema` (Task 2).
- Produces: `profileRoutes` Hono sub-app mounted at `/profile`. `GET /profile` → `200` with the profile (no `passwordHash` field) or `404`; `PUT /profile` → `200` with the updated profile, `400` on invalid body, `404` if the profile is gone. Both require `Authorization: Bearer <token>`; absent/invalid token → `401` (via `requireAuth`, already tested in Task 6).

- [ ] **Step 1: Write the failing test**

`api/test/profile.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import app from '../src/index'
import type { Env } from '../src/env'

function fakeCtx(): ExecutionContext {
  return {
    waitUntil: (p: Promise<unknown>) => {
      p.catch(() => {})
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext
}

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function registerAndGetToken(env: Env): Promise<string> {
  const res = await app.request(
    '/auth/register',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'profile-owner@example.com', password: 'password123' }),
    },
    env,
    fakeCtx()
  )
  const body = await res.json()
  return body.token
}

describe('profile routes', () => {
  let mongod: MongoMemoryServer
  let env: Env

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
  })

  afterAll(async () => {
    await mongod.stop()
  })

  beforeEach(() => {
    env = {
      MONGODB_URI: mongod.getUri(),
      MONGODB_DB_NAME: uniqueDbName(),
      JWT_SECRET: 'test-secret',
    }
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/profile', {}, env, fakeCtx())
    expect(res.status).toBe(401)
  })

  it('returns the caller profile without the password hash', async () => {
    const token = await registerAndGetToken(env)
    const res = await app.request(
      '/profile',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
      fakeCtx()
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('profile-owner@example.com')
    expect(body.passwordHash).toBeUndefined()
  })

  it('updates preferences and returns the updated profile', async () => {
    const token = await registerAndGetToken(env)
    const res = await app.request(
      '/profile',
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            targetRoles: ['Software Engineer'],
            remoteOnly: true,
            minSalaryUsd: 80000,
            locations: ['Remote'],
          },
        }),
      },
      env,
      fakeCtx()
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preferences.targetRoles).toEqual(['Software Engineer'])
    expect(body.preferences.minSalaryUsd).toBe(80000)
  })

  it('rejects an invalid update payload', async () => {
    const token = await registerAndGetToken(env)
    const res = await app.request(
      '/profile',
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { minSalaryUsd: -5 } }),
      },
      env,
      fakeCtx()
    )
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `/profile` returns 404 (no route mounted yet).

- [ ] **Step 3: Implement the profile routes**

`api/src/routes/profile.ts`:
```ts
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { ProfileUpdateSchema } from '@job-hunter/shared'
import { withDb } from '../db'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import type { Env } from '../env'

export const profileRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

profileRoutes.use('*', requireAuth)

profileRoutes.get('/', async (c) => {
  return withDb(c.env, c.executionCtx, async (db) => {
    const profile = await db
      .collection('profiles')
      .findOne(
        { _id: new ObjectId(c.get('profileId')) },
        { projection: { passwordHash: 0 } }
      )
    if (!profile) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json(profile)
  })
})

profileRoutes.put('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = ProfileUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400)
  }

  return withDb(c.env, c.executionCtx, async (db) => {
    const profiles = db.collection('profiles')
    const result = await profiles.findOneAndUpdate(
      { _id: new ObjectId(c.get('profileId')) },
      { $set: { ...parsed.data, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', projection: { passwordHash: 0 } }
    )
    if (!result) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json(result)
  })
})
```

- [ ] **Step 4: Mount the routes**

`api/src/index.ts`:
```ts
import { Hono } from 'hono'
import type { Env } from './env'
import { authRoutes } from './routes/auth'
import { profileRoutes } from './routes/profile'

const app = new Hono<{ Bindings: Env }>()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/auth', authRoutes)
app.route('/profile', profileRoutes)

export default app
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (16 tests total)

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/profile.ts api/src/index.ts api/test/profile.test.ts
git commit -m "Add authenticated profile GET/PUT routes"
```

---

### Task 8: Dashboard scaffold, Tailwind design system, routing, login/register pages

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/vite.config.ts`
- Create: `dashboard/tailwind.config.js`
- Create: `dashboard/postcss.config.js`
- Create: `dashboard/index.html`
- Create: `dashboard/src/index.css`
- Create: `dashboard/src/main.tsx`
- Create: `dashboard/src/App.tsx`
- Create: `dashboard/src/api/client.ts`
- Create: `dashboard/src/auth/AuthContext.tsx`
- Create: `dashboard/src/auth/ProtectedRoute.tsx`
- Create: `dashboard/src/components/Card.tsx`
- Create: `dashboard/src/components/TextField.tsx`
- Create: `dashboard/src/components/Checkbox.tsx`
- Create: `dashboard/src/components/Button.tsx`
- Create: `dashboard/src/components/FormError.tsx`
- Create: `dashboard/src/components/Header.tsx`
- Create: `dashboard/src/pages/Login.tsx`
- Create: `dashboard/src/pages/Register.tsx`

**Interfaces:**
- Consumes: `/auth/register` and `/auth/login` from Task 6, via `apiFetch`.
- Produces: `getToken()`, `setToken(token: string)`, `clearToken()`, `apiFetch(path: string, init?: RequestInit): Promise<Response>` from `dashboard/src/api/client.ts` — consumed by `dashboard/src/pages/Profile.tsx` (Task 9).
- Produces: `useAuth(): { isAuthenticated: boolean, login(token: string): void, logout(): void }` from `dashboard/src/auth/AuthContext.tsx` — consumed by `Profile.tsx` (Task 9) for the logout button and `Header` component.
- Produces design primitives consumed by `Profile.tsx` (Task 9): `Card` (`dashboard/src/components/Card.tsx`), `TextField` (props: `label: string` + all native `input` props), `Checkbox` (props: `label: string` + all native `input` props), `Button` (props: `variant?: 'primary' | 'secondary'` + all native `button` props), `FormError` (props: `message: string`), `Header` (no props — renders app name + logout button via `useAuth`).

**Design system:** Tailwind CSS. Palette: `slate` for neutrals/background/text, `indigo-600` as the primary action color, `red` for errors, `green` for success/confirmation. Layout: auth pages (`Login`/`Register`) are a centered card on a `slate-50` background; `Profile` (Task 9) uses a `Header` bar + a single content card. All five components above are the only styled primitives — later milestones' screens (jobs list, materials, approvals) reuse them rather than hand-writing Tailwind classes inline, per DRY.

This task has no automated tests — per the spec's testing strategy, the dashboard is gated by typecheck + build only.

- [ ] **Step 1: Create the package scaffold**

`dashboard/package.json`:
```json
{
  "name": "@job-hunter/dashboard",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@job-hunter/shared": "*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.13",
    "typescript": "^5.6.3",
    "vite": "^5.4.9"
  }
}
```

`dashboard/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

`dashboard/postcss.config.js`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

`dashboard/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`dashboard/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`dashboard/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

`dashboard/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>AI Remote Job Hunter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`dashboard/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 2: Create the API client**

`dashboard/src/api/client.ts`:
```ts
const TOKEN_STORAGE_KEY = 'job-hunter-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
}
```

- [ ] **Step 3: Create the auth context and protected route**

`dashboard/src/auth/AuthContext.tsx`:
```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { getToken, setToken, clearToken } from '../api/client'

interface AuthContextValue {
  isAuthenticated: boolean
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken())

  const login = useCallback((newToken: string) => {
    setToken(newToken)
    setTokenState(newToken)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setTokenState(null)
  }, [])

  const value = useMemo(
    () => ({ isAuthenticated: token !== null, login, logout }),
    [token, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
```

`dashboard/src/auth/ProtectedRoute.tsx`:
```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}
```

- [ ] **Step 4: Create the design system primitives**

`dashboard/src/components/Card.tsx`:
```tsx
import type { ReactNode } from 'react'

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      {children}
    </div>
  )
}
```

`dashboard/src/components/TextField.tsx`:
```tsx
import type { InputHTMLAttributes } from 'react'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function TextField({ label, id, ...inputProps }: TextFieldProps) {
  const fieldId = id ?? inputProps.name
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={fieldId}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        {...inputProps}
      />
    </div>
  )
}
```

`dashboard/src/components/Checkbox.tsx`:
```tsx
import type { InputHTMLAttributes } from 'react'

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function Checkbox({ label, id, ...inputProps }: CheckboxProps) {
  const fieldId = id ?? inputProps.name
  return (
    <label htmlFor={fieldId} className="flex items-center gap-2 text-sm text-slate-700">
      <input
        id={fieldId}
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        {...inputProps}
      />
      {label}
    </label>
  )
}
```

`dashboard/src/components/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-indigo-600 disabled:bg-indigo-300',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400',
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  )
}
```

`dashboard/src/components/FormError.tsx`:
```tsx
export function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {message}
    </p>
  )
}
```

`dashboard/src/components/Header.tsx`:
```tsx
import { useAuth } from '../auth/AuthContext'
import { Button } from './Button'

export function Header() {
  const { logout } = useAuth()
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <span className="text-lg font-semibold text-slate-900">AI Remote Job Hunter</span>
        <Button variant="secondary" onClick={logout}>
          Log out
        </Button>
      </div>
    </header>
  )
}
```

- [ ] **Step 5: Create the login and register pages**

`dashboard/src/pages/Login.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { TextField } from '../components/TextField'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'login failed' }))
        setError(body.error ?? 'login failed')
        return
      }
      const { token } = await res.json()
      login(token)
      navigate('/profile')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card>
        <h1 className="text-xl font-semibold text-slate-900">Log in</h1>
        <p className="mt-1 text-sm text-slate-500">Welcome back to AI Remote Job Hunter.</p>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {error && <FormError message={error} />}
          <TextField
            label="Email"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-slate-500">
          Need an account?{' '}
          <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
            Register
          </Link>
        </p>
      </Card>
    </div>
  )
}
```

`dashboard/src/pages/Register.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { TextField } from '../components/TextField'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'

export function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'registration failed' }))
        setError(body.error ?? 'registration failed')
        return
      }
      const { token } = await res.json()
      login(token)
      navigate('/profile')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card>
        <h1 className="text-xl font-semibold text-slate-900">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">Start automating your remote job search.</p>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {error && <FormError message={error} />}
          <TextField
            label="Email"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Wire up routing**

`dashboard/src/App.tsx` (the `/profile` route itself is added in Task 9 — for now it 404s, which is fine since Task 8 ends with a typecheck+build gate, not a profile smoke test):
```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>{/* /profile added in Task 9 */}</Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

- [ ] **Step 7: Install, typecheck, and build**

Run: `npm install && npm run typecheck --workspace=dashboard && npm run build --workspace=dashboard`
Expected: both commands exit 0 with no errors.

- [ ] **Step 8: Commit**

```bash
git add dashboard/
git commit -m "Scaffold dashboard with Tailwind design system, routing, login/register"
```

---

### Task 9: Dashboard profile page (view + edit)

**Files:**
- Create: `dashboard/src/pages/Profile.tsx`
- Modify: `dashboard/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 8), `Profile` type from `@job-hunter/shared` (Task 2), `GET /profile` and `PUT /profile` (Task 7), and the design primitives from Task 8: `Header`, `TextField`, `Checkbox`, `Button`, `FormError`.

No automated tests for this task either — typecheck + build is the gate, consistent with Task 8 and the spec's testing strategy.

- [ ] **Step 1: Create the profile page**

`dashboard/src/pages/Profile.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react'
import type { Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { Header } from '../components/Header'
import { TextField } from '../components/TextField'
import { Checkbox } from '../components/Checkbox'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [targetRoles, setTargetRoles] = useState('')
  const [locations, setLocations] = useState('')
  const [remoteOnly, setRemoteOnly] = useState(true)
  const [minSalaryUsd, setMinSalaryUsd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    apiFetch('/profile').then(async (res) => {
      if (!res.ok) {
        setError('Failed to load profile.')
        return
      }
      const data: Profile = await res.json()
      setProfile(data)
      setTargetRoles(data.preferences.targetRoles.join(', '))
      setLocations(data.preferences.locations.join(', '))
      setRemoteOnly(data.preferences.remoteOnly)
      setMinSalaryUsd(data.preferences.minSalaryUsd?.toString() ?? '')
    })
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const res = await apiFetch('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          preferences: {
            targetRoles: targetRoles.split(',').map((s) => s.trim()).filter(Boolean),
            locations: locations.split(',').map((s) => s.trim()).filter(Boolean),
            remoteOnly,
            minSalaryUsd: minSalaryUsd ? Number(minSalaryUsd) : null,
          },
        }),
      })
      if (!res.ok) {
        setError('Failed to save profile.')
        return
      }
      setProfile(await res.json())
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {error && (
          <div className="mb-4">
            <FormError message={error} />
          </div>
        )}
        {!profile ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">Profile</h1>
            <p className="mt-1 text-sm text-slate-500">{profile.email}</p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
              <TextField
                label="Target roles (comma-separated)"
                name="targetRoles"
                value={targetRoles}
                onChange={(e) => setTargetRoles(e.target.value)}
                placeholder="Software Engineer, Backend Engineer"
              />
              <TextField
                label="Locations (comma-separated)"
                name="locations"
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
                placeholder="Remote, Dhaka"
              />
              <Checkbox
                label="Remote only"
                name="remoteOnly"
                checked={remoteOnly}
                onChange={(e) => setRemoteOnly(e.target.checked)}
              />
              <TextField
                label="Minimum salary (USD)"
                name="minSalaryUsd"
                type="number"
                min={0}
                value={minSalaryUsd}
                onChange={(e) => setMinSalaryUsd(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                {saved && <span className="text-sm text-green-600">Saved.</span>}
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into routing**

`dashboard/src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'
import { ProfilePage } from './pages/Profile'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/profile" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck --workspace=dashboard && npm run build --workspace=dashboard`
Expected: both commands exit 0 with no errors.

- [ ] **Step 4: Full-stack manual smoke test**

Run: `docker compose up -d mongo`, then in separate terminals `npm run dev --workspace=api` and `npm run dev --workspace=dashboard`. In the browser at `http://localhost:5173`: register a new account → redirected to `/profile` → fill in target roles/locations/salary → Save → reload the page → values persist → Log out → redirected to `/login`.
Expected: the flow works end to end with no console errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/Profile.tsx dashboard/src/App.tsx
git commit -m "Add dashboard profile view/edit page"
```

---

## M1 Definition of Done

- `npm test` passes across `api` and `shared` (16+ tests).
- `npm run typecheck` and `npm run build` pass across all three workspaces.
- Manual smoke test (Task 9, Step 4) works end to end against local Docker Mongo.
- Explicitly NOT in scope for M1 (deferred to later milestones): job discovery, verification/scoring, materials generation, automation engine, cron/queues, login rate limiting, CI pipeline, Cloudflare deployment. These land in M2–M6.
