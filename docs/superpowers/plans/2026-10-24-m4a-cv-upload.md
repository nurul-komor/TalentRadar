# M4a — CV Upload and Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user upload their master CV as a PDF or DOCX file, parse it to plain text, and store that text on their profile (`Profile.cvText`, which M1 already defined and M3b's scoring already consumes) — behind the existing authenticated profile route.

**Architecture:** A pure `parseCvFile(buffer, mimeType)` function dispatches to a PDF extractor (`pdfjs-dist`) or a DOCX extractor (`mammoth`) based on the upload's MIME type. A new `POST /profile/cv` endpoint, added to the existing `createProfileRoutes` factory (same file, same auth middleware, same owner-profile pattern as the existing `GET`/`PUT /profile`), accepts a `multipart/form-data` upload, validates its size and type, parses it, and writes the resulting text onto the caller's profile exactly like `PUT /profile` writes `preferences`/`eligibility`.

**Scope decision — split from the rest of M4.** The design spec's "Materials generation" section bundles CV upload/parsing together with AI-driven tailored-document generation (CV tailoring, cover letters, outreach messages, draft answers) and PDF/DOCX *export*. Those are a different subsystem: they need a master CV to already exist as text, introduce Claude Opus (the first Opus call in this codebase — M3b used Haiku only), and need their own versioning/export design. This plan (M4a) covers only getting the master CV *in* as text; M4b covers generating and exporting materials *from* it. M4a produces working, independently testable software on its own (a user can upload a CV and see it parsed) without needing any of M4b's AI/export machinery to exist first.

**Tech Stack:** Same as M1-M3b (TypeScript strict, Hono 4, `mongodb` driver 6, Zod 3, Vitest + `mongodb-memory-server`), plus `pdfjs-dist` and `mammoth` (new dependencies — the first file-parsing libraries in this codebase). Node 22's built-in `File`/`FormData`/`Blob` web APIs (no new dependency needed for multipart handling — Hono's `c.req.parseBody()` already returns web-standard `File` objects for multipart uploads).

**Spec:** `docs/superpowers/specs/2026-10-20-ai-remote-job-hunter-design.md` (see "Materials generation" — this plan implements only the CV-ingestion half; tailored-document generation is a separate M4b plan)

## Global Constraints

- Node.js 22 (pinned via the repo's `.nvmrc` — verify `node --version` prints v22.x before trusting any test run; this repo's shell has repeatedly defaulted to Node 18 across M2/M3a/M3b, which breaks unrelated tests with `crypto is not defined` and is easy to mistake for a real failure).
- TypeScript strict mode everywhere.
- `api`/`shared` tests use Vitest; MongoDB-touching tests use a real `mongodb-memory-server` instance. The PDF/DOCX parsing libraries are mocked at the module level in `cvParser.test.ts` (`vi.mock('pdfjs-dist/...')`, `vi.mock('mammoth')`) rather than fed real binary fixtures — this mirrors the precedent M3b's Task 3 set for `@anthropic-ai/sdk`: a thin wrapper around a third-party library is tested by asserting what you pass to and read from the library's API, not by constructing real exotic binary input. The route-level test (`profile.test.ts`) injects a fake `CvParser` via dependency injection rather than exercising the real parsers a second time — the real parsing logic is already covered in `cvParser.test.ts`.
- **`pdf.js` detaches the buffer you pass it** (the underlying `ArrayBuffer` is transferred, not copied) — this was already discovered and is a documented gotcha from the design spec. `parsePdf` must pass pdf.js a *copy* of the input buffer, never the caller's original reference, so the caller's buffer is never silently mutated. One of this plan's tests asserts this directly.
- **`pdfjs-dist`'s exact Node-compatible import path is a real uncertainty** — training knowledge suggests `pdfjs-dist/legacy/build/pdf.mjs` as the package's documented Node/no-DOM entry point, but this has shifted across major versions before. Before writing `cvParser.ts`, check the installed `pdfjs-dist` version's own `package.json` `"exports"` field or README for its current Node-compatible entry point, and use whatever that actually is. Whatever import path Task 1 ends up using, the test's `vi.mock(...)` call must use the exact same module specifier string, or Vitest's mock won't intercept the import.
- `mammoth` in Node takes a buffer via `mammoth.extractRawText({ buffer })` — not a path, not a browser `File`/`Blob`. This is also a documented gotcha from the design spec ("tests must feed mammoth Node-compatible input").
- `npm run typecheck --workspace=api` must exit 0 clean after every task.
- `POST /profile/cv` requires the same bearer-token auth as the rest of `/profile` (`createRequireAuth`), and only ever updates the authenticated caller's own profile — identical ownership scoping to the existing `GET`/`PUT /profile` handlers.
- Max upload size: 10 MB (`MAX_CV_FILE_BYTES`). Only `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX) are accepted; anything else is a `400`, not a silent best-effort parse attempt.
- Package manager: npm workspaces (unchanged).

---

### Task 1: CV file parser (PDF via pdf.js, DOCX via mammoth)

**Files:**
- Modify: `api/package.json` (add `pdfjs-dist`, `mammoth`)
- Create: `api/src/profile/cvParser.ts`
- Test: `api/test/profile/cvParser.test.ts`

**Interfaces:**
- Produces: `CvParser` (`(buffer: Buffer, mimeType: string) => Promise<string>`) type and `parseCvFile: CvParser` from `api/src/profile/cvParser.ts` — consumed by `api/src/routes/profile.ts` (Task 2).

- [ ] **Step 1: Add the dependencies**

`api/package.json` — add to `dependencies`:

```json
"mammoth": "^1.8.0",
"pdfjs-dist": "^4.7.76",
```

Run: `npm install`

Before writing Task 1 Step 4's implementation, open `node_modules/pdfjs-dist/package.json` and confirm its `"exports"` field (or the package's README) for the correct Node/no-DOM import path. This plan assumes `pdfjs-dist/legacy/build/pdf.mjs` based on the package's documented history, but verify against what's actually installed — if it differs, use the real path in both the implementation (Step 4) and the test's `vi.mock(...)` call (Step 2) below.

- [ ] **Step 2: Write the failing tests**

`api/test/profile/cvParser.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'

const mockGetDocument = vi.fn()
const mockExtractRawText = vi.fn()

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mockGetDocument,
}))

vi.mock('mammoth', () => ({
  default: { extractRawText: mockExtractRawText },
}))

describe('parseCvFile', () => {
  afterEach(() => {
    mockGetDocument.mockReset()
    mockExtractRawText.mockReset()
  })

  it('extracts and joins text from every page of a PDF, in page order', async () => {
    const fakeDoc = {
      numPages: 2,
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: vi.fn(async () => ({
          items:
            pageNumber === 1
              ? [{ str: 'Page one.' }, { str: 'More text.' }]
              : [{ str: 'Page two.' }],
        })),
      })),
    }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc) })

    const { parseCvFile } = await import('../../src/profile/cvParser')
    const text = await parseCvFile(Buffer.from('fake pdf bytes'), 'application/pdf')

    expect(text).toBe('Page one. More text.\nPage two.')
  })

  it('passes a copy of the buffer to pdf.js, never the original reference', async () => {
    const fakeDoc = { numPages: 0, getPage: vi.fn() }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc) })

    const { parseCvFile } = await import('../../src/profile/cvParser')
    const originalBuffer = Buffer.from('fake pdf bytes')
    await parseCvFile(originalBuffer, 'application/pdf')

    const passedData = mockGetDocument.mock.calls[0][0].data
    expect(passedData).not.toBe(originalBuffer)
    expect(Buffer.compare(passedData, originalBuffer)).toBe(0)
  })

  it('extracts and trims text from a DOCX file via mammoth, passing a buffer not a path', async () => {
    mockExtractRawText.mockResolvedValue({ value: '  Resume text here.  ' })

    const { parseCvFile } = await import('../../src/profile/cvParser')
    const text = await parseCvFile(
      Buffer.from('fake docx bytes'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )

    expect(text).toBe('Resume text here.')
    expect(mockExtractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) })
  })

  it('throws for an unsupported mime type', async () => {
    const { parseCvFile } = await import('../../src/profile/cvParser')
    await expect(parseCvFile(Buffer.from('x'), 'image/png')).rejects.toThrow(
      'unsupported CV mime type'
    )
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/profile/cvParser` does not exist.

- [ ] **Step 4: Implement the parser**

`api/src/profile/cvParser.ts`:

```ts
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth'

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type CvParser = (buffer: Buffer, mimeType: string) => Promise<string>

export const parseCvFile: CvParser = async (buffer, mimeType) => {
  if (mimeType === 'application/pdf') {
    return parsePdf(buffer)
  }
  if (mimeType === DOCX_MIME_TYPE) {
    return parseDocx(buffer)
  }
  throw new Error(`unsupported CV mime type: ${mimeType}`)
}

async function parsePdf(buffer: Buffer): Promise<string> {
  // pdf.js takes ownership of the ArrayBuffer backing `data` and detaches it —
  // copy first so the caller's original buffer is never mutated.
  const copy = Buffer.from(buffer)
  const doc = await pdfjsLib.getDocument({ data: copy }).promise

  const pageTexts: string[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: { str?: string }) => item.str ?? '')
      .join(' ')
    pageTexts.push(pageText)
  }

  return pageTexts.join('\n').trim()
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (96 total: 92 + 4 new)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

If `pdfjs-dist`'s type declarations don't line up exactly with the `getDocument({ data }).promise` / `doc.numPages` / `doc.getPage()` / `page.getTextContent()` shape used above (its types can be stricter or shaped differently across versions), adjust the implementation to match what actually typechecks against the installed version — the test's mock return shapes should still satisfy the real interface either way, since they only exercise `numPages`, `getPage`, and `getTextContent`.

- [ ] **Step 7: Commit**

```bash
git add api/package.json package-lock.json api/src/profile/cvParser.ts api/test/profile/cvParser.test.ts
git commit -m "Add PDF/DOCX CV parser"
```

---

### Task 2: CV upload route

**Files:**
- Modify: `api/src/routes/profile.ts`
- Test: `api/test/profile.test.ts`

**Interfaces:**
- Consumes: `CvParser`, `parseCvFile` (Task 1).
- Modifies: `createProfileRoutes(db: Db, jwtSecret: string, cvParser: CvParser = parseCvFile)` — adds an optional, defaulted third parameter so tests can inject a fake parser instead of exercising the real PDF/DOCX libraries a second time (that's already covered by Task 1's tests). The existing two-argument call site in `api/src/server.ts` is unaffected — it keeps using the real `parseCvFile` via the default. New endpoint: `POST /profile/cv` → `200` with the updated profile JSON (same shape as `PUT /profile`'s response, `passwordHash` excluded) on success; `400` for a missing file, an oversized file, or an unsupported MIME type; `401` for a missing/invalid token (via the already-mounted `createRequireAuth`); `404` if the profile somehow doesn't exist (matches the existing `PUT /profile` 404 behavior).

- [ ] **Step 1: Write the failing tests**

In `api/test/profile.test.ts`, add this import and this constant near the top of the file (alongside the existing imports/constants):

```ts
import type { CvParser } from '../src/profile/cvParser'
```

```ts
const fakeCvParser: CvParser = async () => 'Parsed CV text from the fake extractor.'
```

Change the existing `beforeEach`'s route-mounting line from:

```ts
    app.route('/profile', createProfileRoutes(db, JWT_SECRET))
```

to:

```ts
    app.route('/profile', createProfileRoutes(db, JWT_SECRET, fakeCvParser))
```

Then add these four `it()` blocks inside the existing `describe('profile routes', ...)` block, after the existing four:

```ts
  it('rejects a CV upload with no token', async () => {
    const res = await app.request('/profile/cv', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('parses an uploaded CV and stores the extracted text on the profile', async () => {
    const token = await registerAndGetToken(app)
    const file = new File([Buffer.from('fake pdf bytes')], 'resume.pdf', {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', file)

    const res = await app.request('/profile/cv', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { cvText: string }
    expect(body.cvText).toBe('Parsed CV text from the fake extractor.')
  })

  it('rejects an unsupported file type', async () => {
    const token = await registerAndGetToken(app)
    const file = new File([Buffer.from('not a cv')], 'resume.png', { type: 'image/png' })
    const formData = new FormData()
    formData.append('file', file)

    const res = await app.request('/profile/cv', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    expect(res.status).toBe(400)
  })

  it('rejects a file over the 10 MB size limit', async () => {
    const token = await registerAndGetToken(app)
    const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 1)
    const file = new File([oversizedBytes], 'resume.pdf', { type: 'application/pdf' })
    const formData = new FormData()
    formData.append('file', file)

    const res = await app.request('/profile/cv', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    expect(res.status).toBe(400)
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `POST /profile/cv` doesn't exist yet (404, not the expected status in each new test), and `createProfileRoutes` doesn't yet accept a third argument (this one is a type error caught by Step 2 of the typecheck, not a test failure — expect a TypeScript compile error if you try to run the suite before implementing, since the test file now calls `createProfileRoutes` with 3 args against the current 2-arg signature).

- [ ] **Step 3: Implement the route**

Replace the full contents of `api/src/routes/profile.ts`:

```ts
import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import { ProfileUpdateSchema } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth'
import { parseCvFile, DOCX_MIME_TYPE, type CvParser } from '../profile/cvParser'

const MAX_CV_FILE_BYTES = 10 * 1024 * 1024

export function createProfileRoutes(db: Db, jwtSecret: string, cvParser: CvParser = parseCvFile) {
  const profileRoutes = new Hono<{ Variables: AuthVariables }>()
  profileRoutes.use('*', createRequireAuth(jwtSecret))

  profileRoutes.get('/', async (c) => {
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

  profileRoutes.put('/', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = ProfileUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400)
    }

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

  profileRoutes.post('/cv', async (c) => {
    const body = await c.req.parseBody()
    const file = body.file
    if (!(file instanceof File)) {
      return c.json({ error: 'file is required' }, 400)
    }
    if (file.size > MAX_CV_FILE_BYTES) {
      return c.json({ error: 'file too large' }, 400)
    }
    if (file.type !== 'application/pdf' && file.type !== DOCX_MIME_TYPE) {
      return c.json({ error: 'unsupported file type' }, 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let cvText: string
    try {
      cvText = await cvParser(buffer, file.type)
    } catch {
      return c.json({ error: 'failed to parse file' }, 400)
    }

    const profiles = db.collection('profiles')
    const result = await profiles.findOneAndUpdate(
      { _id: new ObjectId(c.get('profileId')) },
      { $set: { cvText, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', projection: { passwordHash: 0 } }
    )
    if (!result) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json(result)
  })

  return profileRoutes
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (100 total: 96 + 4 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/profile.ts api/test/profile.test.ts
git commit -m "Add CV upload route"
```

---

## M4a Definition of Done

- `npm test` passes across `api` (100 tests) and `shared` (15 tests, unchanged) — 115 total.
- `npm run typecheck` passes across all three workspaces.
- Manual smoke test: start the api (`npm run dev --workspace=api` against local Mongo), register/login, `curl -X POST http://localhost:8787/profile/cv -H "Authorization: Bearer <token>" -F "file=@/path/to/real-resume.pdf"` (and separately with a real `.docx` resume) returns the updated profile JSON with a non-empty `cvText` field containing recognizable text from the actual file — this is the one check nothing in the automated suite can replace, since Tasks 1-2 mock both parsing libraries.
- Explicitly NOT in scope for M4a (deferred to M4b): tailored CV/cover-letter/outreach/draft-answer generation, Claude Opus integration, PDF/DOCX export of generated materials, materials versioning.
