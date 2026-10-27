# M5b — Playwright Automation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a job's real application page with Playwright, fill in what it's safe to fill in automatically, leave everything else as a required answer for the user, and — only once M5a's gate says a specific run has been approved — actually click submit and confirm whether the destination page shows real evidence the application went through.

**Architecture:** `discoverForm` scans a loaded page for text/textarea/file inputs and radio/checkbox groups, tagging each with a stable `data-automation-id` attribute so it can be re-located reliably (never fragile guessed CSS selectors). `detectBlocker` checks the same page for CAPTCHA markers or a password field (a login wall) before any filling is attempted. `fillForm` matches only a narrow, explicitly-safe set of fields — an email input, a cover/motivation-letter-labeled textarea (from M4b's generated cover letter), and a file input (the tailored CV, exported to PDF on the fly via M4b's `exportToPdf`) — and turns everything else, including every radio/checkbox group except ones it explicitly refuses to touch, into a `requiredAnswers` entry on the application for a human to resolve later. `runAutomation` orchestrates one fill attempt end to end and records its outcome via M5a's `recordRunResult`. `submitApplication` is the one function in this codebase that can make an application actually happen — it re-checks M5a's `canSubmit` gate itself before doing anything, independent of whatever the caller already checked, then re-fills the real form and clicks the real submit button, and reports `submitted` only when the resulting page shows text that actually looks like a confirmation.

**Scope decision — auto-fill is narrower than it might look, because `Profile` is narrower than it might look.** `Profile` (from M1) has `email`, `eligibility`, `preferences`, and `cvText` — no name, phone, or address fields exist yet. This plan does not invent new profile fields to fill more of a typical application form; it fills exactly what the existing data actually supports (email, cover letter, CV) and surfaces everything else — including every radio/checkbox group, since none of them have an unambiguous, safe default — as a `requiredAnswers` entry. This matches the design spec's explicit framing of the field-matching as "intentionally narrow," and is honest about today's actual data rather than quietly over-promising. Extending `Profile` with more contact fields, if wanted, is a small, independent follow-up — not bundled into this plan.

**Scope decision — the approval gate is re-checked inside `submitApplication` itself, not just by its caller.** M5a's whole point is that nothing can skip the gate. The only way to make that true rather than merely conventional is for the one function capable of an irreversible real-world action to refuse on its own, from first principles, every time it runs — never trusting that whoever called it already checked. `submitApplication` calls `canSubmit` itself and throws if it returns false, regardless of what the route layer or anything else already verified.

**Tech Stack:** Same as M1-M5a, plus `playwright` (new dependency — the first browser-automation library in this codebase, and the first dependency in this project that needs a post-install step: run `npx playwright install chromium` after `npm install`, or test runs will fail with a missing-browser error that looks nothing like a code bug). Tests use Playwright's own `page.goto('data:text/html,' + encodeURIComponent(html))` technique to load literal mock HTML fixtures without needing a web server — this is the design spec's own stated testing strategy ("Playwright tests against local mock application pages"), and it exercises the real navigation code path, not a mock of it.

## Global Constraints

- Node.js 22 (pinned via `.nvmrc` — verify `node --version` prints v22.x before trusting any test run).
- TypeScript strict mode everywhere.
- `api`/`shared` tests use Vitest; MongoDB-touching tests use a real `mongodb-memory-server` instance. Every test that touches a page uses a real headless Chromium instance via Playwright, loaded with `data:` URLs carrying literal mock HTML — never a live third-party site, and never a mock of Playwright itself (the whole point of this plan is DOM behavior, which only a real browser engine reproduces faithfully).
- **This is a single-user tool** (an existing, already-stated architectural premise, not new to this plan) — `runAutomation` and `submitApplication` fetch "the" profile via `db.collection('profiles').findOne({})` with no filter, rather than scoping to a specific authenticated caller. This matches every other cross-cutting worker-style function in this codebase (M3b's `runScoring` is the one exception, since its route already has an authenticated caller's profile in hand — this plan's two entry points don't have an HTTP request to pull a caller from, since they're meant to run as an internal automation worker, triggered by a route but not acting "as" that specific caller's session beyond using the one profile that exists).
- `detectBlocker`'s CAPTCHA check is a plain substring match against the page's HTML for `"captcha"`/`"recaptcha"`/`"hcaptcha"` — a best-effort heuristic, not a guarantee. Its login-wall check (`input[type=password]` present) is similarly a heuristic, not a guarantee. Both existing false-negatives (missing a real captcha/login wall) are a known limitation worth a one-line note in a future README, same as M3a's page-evidence patterns — not something this plan can close completely against arbitrary third-party sites.
- `fillForm` **never** interacts with a radio/checkbox group whose fieldset legend (or, if ungrouped, its own label) matches `/consent|terms|privacy|agree/i` — it skips those entirely, leaving them unanswered and unticked, by explicit design per the spec ("Never ticks consent/terms checkboxes automatically"), not as an oversight.
- A second `runAutomation` call for the same job **merges** newly-discovered required-answer questions with the application's existing ones, preserving any non-null answer a human already provided for a question with the same text — it must never silently wipe out an answer the user already typed in, even though every other field this plan writes is otherwise fully replaced on each run.
- `submitApplication` throws (does not silently no-op) if `canSubmit` returns false for the given `(jobId, runNumber)` — the caller (the route in Task 7) is responsible for turning that into an HTTP error response, but the refusal itself happens inside this function, unconditionally.
- Confirmation detection in `submitApplication` is a best-effort regex match against the post-submit page's visible text (`/thank you|application (received|submitted)|successfully applied/i`) — this satisfies the spec's "not merely form posted without error" requirement by actually looking for confirmation language rather than just checking the HTTP response succeeded, but it is still a heuristic against arbitrary third-party copy. The manual smoke test in this plan's Definition of Done is the one check nothing in the automated suite can replace.
- `npm run typecheck --workspace=api` must exit 0 clean after every task.
- `jobId` is the same `${sourceId}:${sourceJobId}` composite string convention used everywhere since M3a.
- Package manager: npm workspaces (unchanged).

---

### Task 1: Browser session management

**Files:**
- Modify: `api/package.json` (add `playwright`)
- Create: `api/src/automation/browser.ts`
- Test: `api/test/automation/browser.test.ts`

**Interfaces:**
- Produces: `launchBrowser(): Promise<Browser>` from `api/src/automation/browser.ts` (re-exporting Playwright's own `Browser` type) — consumed by every other task in this plan.

- [ ] **Step 1: Add the dependency and install the browser binary**

`api/package.json` — add to `dependencies`:

```json
"playwright": "^1.47.0",
```

Run: `npm install`, then **`npx playwright install chromium`** from the `api/` directory — this downloads the actual browser binary Playwright drives. Without this step, every test in this plan fails with an "Executable doesn't exist" error that is easy to mistake for a code bug.

- [ ] **Step 2: Write the failing test**

`api/test/automation/browser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { launchBrowser } from '../../src/automation/browser'

describe('launchBrowser', () => {
  it('launches a browser that can open a page and navigate to a data URL', async () => {
    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.goto('data:text/html,' + encodeURIComponent('<h1>Hello</h1>'))
      const heading = await page.locator('h1').textContent()
      expect(heading).toBe('Hello')
    } finally {
      await browser.close()
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/automation/browser` does not exist.

- [ ] **Step 4: Implement the browser launcher**

`api/src/automation/browser.ts`:

```ts
import { chromium, type Browser } from 'playwright'

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true })
}

export type { Browser, Page } from 'playwright'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (140 total: 139 + 1 new). This test is slower than anything else in the suite so far (real browser launch) — that's expected, not a regression.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add api/package.json package-lock.json api/src/automation/browser.ts api/test/automation/browser.test.ts
git commit -m "Add Playwright browser session management"
```

---

### Task 2: Form discovery

**Files:**
- Create: `api/src/automation/formDiscovery.ts`
- Test: `api/test/automation/formDiscovery.test.ts`

**Interfaces:**
- Produces: `DiscoveredField` (`{ automationId: string; label: string }`), `DiscoveredOptionGroup` (`{ automationId: string; legend: string; kind: 'radio' | 'checkbox' }`), `DiscoveredForm` (`{ textFields: DiscoveredField[]; textareaFields: DiscoveredField[]; fileFields: DiscoveredField[]; optionGroups: DiscoveredOptionGroup[] }`), and `discoverForm(page: Page): Promise<DiscoveredForm>` from `api/src/automation/formDiscovery.ts` — consumed by `api/src/automation/fillStrategy.ts` (Task 4).

`discoverForm` tags every field it finds with a `data-automation-id` attribute directly in the page's DOM (via `page.evaluate`), so later code can reliably re-locate the exact element with `page.locator('[data-automation-id="..."]')` instead of guessing a CSS selector from the label text.

- [ ] **Step 1: Write the failing test**

`api/test/automation/formDiscovery.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { launchBrowser } from '../../src/automation/browser'
import { discoverForm } from '../../src/automation/formDiscovery'
import type { Browser, Page } from '../../src/automation/browser'

const MOCK_FORM_HTML = `
<form>
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />

  <label for="name-field">Full name</label>
  <input type="text" id="name-field" />

  <label for="cover-field">Cover Letter</label>
  <textarea id="cover-field"></textarea>

  <label for="cv-field">Upload your CV</label>
  <input type="file" id="cv-field" />

  <fieldset>
    <legend>Are you legally authorized to work in this country?</legend>
    <label><input type="radio" name="work-auth" value="yes" /> Yes</label>
    <label><input type="radio" name="work-auth" value="no" /> No</label>
  </fieldset>

  <label><input type="checkbox" id="consent-field" /> I agree to the terms and conditions</label>

  <button type="submit">Submit application</button>
</form>
`

describe('discoverForm', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
    await page.goto('data:text/html,' + encodeURIComponent(MOCK_FORM_HTML))
  })

  afterAll(async () => {
    await browser.close()
  })

  it('discovers text fields with their labels', async () => {
    const form = await discoverForm(page)
    const labels = form.textFields.map((f) => f.label)
    expect(labels).toEqual(['Email address', 'Full name'])
  })

  it('discovers textarea fields with their labels', async () => {
    const form = await discoverForm(page)
    expect(form.textareaFields.map((f) => f.label)).toEqual(['Cover Letter'])
  })

  it('discovers file fields with their labels', async () => {
    const form = await discoverForm(page)
    expect(form.fileFields.map((f) => f.label)).toEqual(['Upload your CV'])
  })

  it('discovers a fieldset-grouped radio group once per option, tagged with the legend text', async () => {
    const form = await discoverForm(page)
    const workAuthOptions = form.optionGroups.filter(
      (g) => g.legend === 'Are you legally authorized to work in this country?'
    )
    expect(workAuthOptions).toHaveLength(2)
    expect(workAuthOptions.every((g) => g.kind === 'radio')).toBe(true)
  })

  it('discovers an ungrouped checkbox using its own wrapping label as the legend', async () => {
    const form = await discoverForm(page)
    const consentOption = form.optionGroups.find((g) => g.kind === 'checkbox')
    expect(consentOption?.legend).toContain('I agree to the terms and conditions')
  })

  it('tags every discovered field with a unique automationId usable as a selector', async () => {
    const form = await discoverForm(page)
    const emailField = form.textFields.find((f) => f.label === 'Email address')
    const tagged = await page
      .locator(`[data-automation-id="${emailField?.automationId}"]`)
      .getAttribute('id')
    expect(tagged).toBe('email-field')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/automation/formDiscovery` does not exist.

- [ ] **Step 3: Implement form discovery**

`api/src/automation/formDiscovery.ts`:

```ts
import type { Page } from './browser'

export interface DiscoveredField {
  automationId: string
  label: string
}

export interface DiscoveredOptionGroup {
  automationId: string
  legend: string
  kind: 'radio' | 'checkbox'
}

export interface DiscoveredForm {
  textFields: DiscoveredField[]
  textareaFields: DiscoveredField[]
  fileFields: DiscoveredField[]
  optionGroups: DiscoveredOptionGroup[]
}

export async function discoverForm(page: Page): Promise<DiscoveredForm> {
  return page.evaluate(() => {
    let counter = 0
    const nextId = () => `automation-${counter++}`

    function labelFor(el: Element): string {
      const id = el.getAttribute('id')
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`)
        if (label?.textContent) return label.textContent.trim()
      }
      const wrappingLabel = el.closest('label')
      if (wrappingLabel?.textContent) return wrappingLabel.textContent.trim()
      return el.getAttribute('aria-label') ?? ''
    }

    const textFields: { automationId: string; label: string }[] = []
    document
      .querySelectorAll<HTMLInputElement>(
        'input[type=text], input[type=email], input[type=tel], input[type=url]'
      )
      .forEach((el) => {
        const automationId = nextId()
        el.setAttribute('data-automation-id', automationId)
        textFields.push({ automationId, label: labelFor(el) })
      })

    const textareaFields: { automationId: string; label: string }[] = []
    document.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((el) => {
      const automationId = nextId()
      el.setAttribute('data-automation-id', automationId)
      textareaFields.push({ automationId, label: labelFor(el) })
    })

    const fileFields: { automationId: string; label: string }[] = []
    document.querySelectorAll<HTMLInputElement>('input[type=file]').forEach((el) => {
      const automationId = nextId()
      el.setAttribute('data-automation-id', automationId)
      fileFields.push({ automationId, label: labelFor(el) })
    })

    const optionGroups: { automationId: string; legend: string; kind: 'radio' | 'checkbox' }[] = []
    const groupedInputs = new Set<Element>()

    document.querySelectorAll('fieldset').forEach((fieldset) => {
      const legend = fieldset.querySelector('legend')?.textContent?.trim() ?? ''
      fieldset
        .querySelectorAll<HTMLInputElement>('input[type=radio], input[type=checkbox]')
        .forEach((el) => {
          const automationId = nextId()
          el.setAttribute('data-automation-id', automationId)
          optionGroups.push({ automationId, legend, kind: el.type as 'radio' | 'checkbox' })
          groupedInputs.add(el)
        })
    })

    document.querySelectorAll<HTMLInputElement>('input[type=checkbox], input[type=radio]').forEach((el) => {
      if (groupedInputs.has(el)) return
      const automationId = nextId()
      el.setAttribute('data-automation-id', automationId)
      optionGroups.push({ automationId, legend: labelFor(el), kind: el.type as 'radio' | 'checkbox' })
    })

    return { textFields, textareaFields, fileFields, optionGroups }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (146 total: 140 + 6 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/automation/formDiscovery.ts api/test/automation/formDiscovery.test.ts
git commit -m "Add form discovery (text/textarea/file fields, fieldset-grouped option groups)"
```

---

### Task 3: Blocker detection (CAPTCHA, login wall)

**Files:**
- Create: `api/src/automation/blockerDetection.ts`
- Test: `api/test/automation/blockerDetection.test.ts`

**Interfaces:**
- Produces: `BlockerReason` (`'captcha' | 'login_wall' | null`) and `detectBlocker(page: Page): Promise<BlockerReason>` from `api/src/automation/blockerDetection.ts` — consumed by `api/src/automation/automationOrchestrator.ts` (Tasks 5-6).

- [ ] **Step 1: Write the failing tests**

`api/test/automation/blockerDetection.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { launchBrowser } from '../../src/automation/browser'
import { detectBlocker } from '../../src/automation/blockerDetection'
import type { Browser } from '../../src/automation/browser'

async function loadHtml(browser: Browser, html: string) {
  const page = await browser.newPage()
  await page.goto('data:text/html,' + encodeURIComponent(html))
  return page
}

describe('detectBlocker', () => {
  let browser: Browser | null = null

  afterEach(async () => {
    await browser?.close()
    browser = null
  })

  it('returns null for an ordinary form page', async () => {
    browser = await launchBrowser()
    const page = await loadHtml(browser, '<form><input type="text" /></form>')
    expect(await detectBlocker(page)).toBeNull()
  })

  it('returns captcha when a recaptcha marker is present', async () => {
    browser = await launchBrowser()
    const page = await loadHtml(
      browser,
      '<div class="g-recaptcha" data-sitekey="abc"></div><form></form>'
    )
    expect(await detectBlocker(page)).toBe('captcha')
  })

  it('returns login_wall when a password field is present', async () => {
    browser = await launchBrowser()
    const page = await loadHtml(browser, '<form><input type="password" /></form>')
    expect(await detectBlocker(page)).toBe('login_wall')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/automation/blockerDetection` does not exist.

- [ ] **Step 3: Implement blocker detection**

`api/src/automation/blockerDetection.ts`:

```ts
import type { Page } from './browser'

export type BlockerReason = 'captcha' | 'login_wall' | null

export async function detectBlocker(page: Page): Promise<BlockerReason> {
  const hasCaptcha = await page.evaluate(() => {
    const markers = ['captcha', 'recaptcha', 'hcaptcha']
    const html = document.documentElement.innerHTML.toLowerCase()
    return markers.some((marker) => html.includes(marker))
  })
  if (hasCaptcha) return 'captcha'

  const hasPasswordField = await page.evaluate(
    () => document.querySelector('input[type=password]') !== null
  )
  if (hasPasswordField) return 'login_wall'

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (149 total: 146 + 3 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/automation/blockerDetection.ts api/test/automation/blockerDetection.test.ts
git commit -m "Add CAPTCHA and login-wall blocker detection"
```

---

### Task 4: Fill strategy

**Files:**
- Create: `api/src/automation/fillStrategy.ts`
- Test: `api/test/automation/fillStrategy.test.ts`

**Interfaces:**
- Consumes: `DiscoveredForm` (Task 2), `exportToPdf` (M4b, from `api/src/materials/exporters.ts`), `Profile`, `Materials` (existing shared types).
- Produces: `FillOutcome` (`{ filledFields: Record<string, string>; requiredAnswers: Array<{ question: string; answer: string | null }> }`) and `fillForm(page: Page, form: DiscoveredForm, profile: Profile, materials: Materials): Promise<FillOutcome>` from `api/src/automation/fillStrategy.ts` — consumed by `api/src/automation/automationOrchestrator.ts` (Tasks 5-6).

- [ ] **Step 1: Write the failing tests**

`api/test/automation/fillStrategy.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { launchBrowser } from '../../src/automation/browser'
import { discoverForm } from '../../src/automation/formDiscovery'
import { fillForm } from '../../src/automation/fillStrategy'
import type { Browser } from '../../src/automation/browser'
import type { Materials, Profile } from '@job-hunter/shared'

const MOCK_FORM_HTML = `
<form>
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />

  <label for="name-field">Full name</label>
  <input type="text" id="name-field" />

  <label for="cover-field">Cover Letter</label>
  <textarea id="cover-field"></textarea>

  <label for="cv-field">Upload your CV</label>
  <input type="file" id="cv-field" />

  <fieldset>
    <legend>Are you legally authorized to work in this country?</legend>
    <label><input type="radio" name="work-auth" value="yes" /> Yes</label>
    <label><input type="radio" name="work-auth" value="no" /> No</label>
  </fieldset>

  <label><input type="checkbox" id="consent-field" /> I agree to the terms and conditions</label>
</form>
`

function profile(): Profile {
  return {
    email: 'candidate@example.com',
    eligibility: { workAuthorization: 'citizen', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: 'Experienced engineer.',
  }
}

function materials(): Materials {
  return {
    jobId: 'remoteok:1',
    version: 1,
    unmetRequirements: [],
    tailoredCv: 'Tailored CV text.',
    coverLetter: 'This is my cover letter.',
    outreachMessage: 'Outreach text.',
    createdAt: new Date().toISOString(),
  }
}

describe('fillForm', () => {
  let browser: Browser

  afterEach(async () => {
    await browser.close()
  })

  it('fills the email field and the cover-letter textarea, uploads the CV, and skips the consent checkbox', async () => {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.goto('data:text/html,' + encodeURIComponent(MOCK_FORM_HTML))
    const form = await discoverForm(page)

    const outcome = await fillForm(page, form, profile(), materials())

    await expect(page.locator('#email-field')).toHaveValue('candidate@example.com')
    await expect(page.locator('#cover-field')).toHaveValue('This is my cover letter.')
    await expect(page.locator('#consent-field')).not.toBeChecked()

    const cvInputFiles = await page.locator('#cv-field').evaluate((el: HTMLInputElement) =>
      el.files ? Array.from(el.files).map((f) => f.name) : []
    )
    expect(cvInputFiles).toEqual(['cv.pdf'])

    expect(outcome.filledFields['Email address']).toBe('candidate@example.com')
    expect(outcome.filledFields['Cover Letter']).toBe('This is my cover letter.')
  })

  it('surfaces the unmatched name field and the work-authorization question as required answers', async () => {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.goto('data:text/html,' + encodeURIComponent(MOCK_FORM_HTML))
    const form = await discoverForm(page)

    const outcome = await fillForm(page, form, profile(), materials())

    const questions = outcome.requiredAnswers.map((a) => a.question)
    expect(questions).toContain('Full name')
    expect(questions).toContain('Are you legally authorized to work in this country?')
  })

  it('does not surface a required answer for the consent checkbox', async () => {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.goto('data:text/html,' + encodeURIComponent(MOCK_FORM_HTML))
    const form = await discoverForm(page)

    const outcome = await fillForm(page, form, profile(), materials())

    const questions = outcome.requiredAnswers.map((a) => a.question)
    expect(questions.some((q) => q.includes('terms and conditions'))).toBe(false)
  })

  it('surfaces the work-authorization question exactly once despite having two radio inputs', async () => {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.goto('data:text/html,' + encodeURIComponent(MOCK_FORM_HTML))
    const form = await discoverForm(page)

    const outcome = await fillForm(page, form, profile(), materials())

    const workAuthQuestions = outcome.requiredAnswers.filter(
      (a) => a.question === 'Are you legally authorized to work in this country?'
    )
    expect(workAuthQuestions).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/automation/fillStrategy` does not exist.

- [ ] **Step 3: Implement the fill strategy**

`api/src/automation/fillStrategy.ts`:

```ts
import type { Materials, Profile } from '@job-hunter/shared'
import { exportToPdf } from '../materials/exporters'
import type { DiscoveredForm } from './formDiscovery'
import type { Page } from './browser'

const CONSENT_PATTERN = /consent|terms|privacy|agree/i
const COVER_LETTER_PATTERN = /cover letter|motivation letter/i
const EMAIL_LABEL_PATTERN = /e-?mail/i

export interface FillOutcome {
  filledFields: Record<string, string>
  requiredAnswers: Array<{ question: string; answer: string | null }>
}

export async function fillForm(
  page: Page,
  form: DiscoveredForm,
  profile: Profile,
  materials: Materials
): Promise<FillOutcome> {
  const filledFields: Record<string, string> = {}
  const requiredAnswers: Array<{ question: string; answer: string | null }> = []

  for (const field of form.textFields) {
    const selector = page.locator(`[data-automation-id="${field.automationId}"]`)
    if (EMAIL_LABEL_PATTERN.test(field.label)) {
      await selector.fill(profile.email)
      filledFields[field.label || field.automationId] = profile.email
    } else {
      requiredAnswers.push({ question: field.label || '(unlabeled text field)', answer: null })
    }
  }

  for (const field of form.textareaFields) {
    const selector = page.locator(`[data-automation-id="${field.automationId}"]`)
    if (COVER_LETTER_PATTERN.test(field.label)) {
      await selector.fill(materials.coverLetter)
      filledFields[field.label] = materials.coverLetter
    } else {
      requiredAnswers.push({ question: field.label || '(unlabeled text area)', answer: null })
    }
  }

  for (const field of form.fileFields) {
    const cvBuffer = await exportToPdf(materials.tailoredCv)
    await page.locator(`[data-automation-id="${field.automationId}"]`).setInputFiles({
      name: 'cv.pdf',
      mimeType: 'application/pdf',
      buffer: cvBuffer,
    })
    filledFields[field.label || field.automationId] = 'cv.pdf'
  }

  const seenLegends = new Set<string>()
  for (const group of form.optionGroups) {
    if (CONSENT_PATTERN.test(group.legend)) {
      continue // never auto-tick consent/terms checkboxes
    }
    if (seenLegends.has(group.legend)) {
      continue // one required-answer entry per legend, not per radio/checkbox input
    }
    seenLegends.add(group.legend)
    requiredAnswers.push({ question: group.legend || '(unlabeled option group)', answer: null })
  }

  return { filledFields, requiredAnswers }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (153 total: 149 + 4 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/automation/fillStrategy.ts api/test/automation/fillStrategy.test.ts
git commit -m "Add fill strategy: narrow auto-fill, consent-checkbox exclusion, deduped required answers"
```

---

### Task 5: Fill orchestrator (`runAutomation`)

**Files:**
- Create: `api/src/automation/automationOrchestrator.ts`
- Test: `api/test/automation/automationOrchestrator.test.ts`

**Interfaces:**
- Consumes: `launchBrowser` (Task 1), `discoverForm` (Task 2), `detectBlocker` (Task 3), `fillForm` (Task 4), `recordRunResult` (M5a), `Job`, `Materials`, `Profile`, `Application` (existing/M5a shared types).
- Produces: `runAutomation(db: Db, jobKey: { sourceId: string; sourceJobId: string }): Promise<AutomationRun>` from `api/src/automation/automationOrchestrator.ts` — consumed by `api/src/routes/automation.ts` (Task 7). Throws if the job doesn't exist, if no materials have been generated for it, or if no profile exists.

This task and Task 6 share one file since they're both orchestration logic over the same job/materials/profile lookups — Task 6 adds `submitApplication` to the same file rather than duplicating those lookups in a second file.

- [ ] **Step 1: Write the failing test**

`api/test/automation/automationOrchestrator.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { ensureApplicationIndexes } from '../../src/applications/applicationsService'
import { ensureAutomationRunIndexes } from '../../src/applications/automationRunsService'
import { runAutomation } from '../../src/automation/automationOrchestrator'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const MOCK_FORM_HTML = `
<form>
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />
  <label for="name-field">Full name</label>
  <input type="text" id="name-field" />
  <label for="cover-field">Cover Letter</label>
  <textarea id="cover-field"></textarea>
</form>
`

const MOCK_CAPTCHA_HTML = `<div class="g-recaptcha"></div><form></form>`

function dataUrl(html: string): string {
  return 'data:text/html,' + encodeURIComponent(html)
}

async function insertJob(db: Db, normalizedUrl: string) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId: '1',
    normalizedUrl,
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

async function insertMaterials(db: Db) {
  await db.collection('materials').insertOne({
    jobId: 'remoteok:1',
    version: 1,
    unmetRequirements: [],
    tailoredCv: 'Tailored CV text.',
    coverLetter: 'This is my cover letter.',
    outreachMessage: 'Outreach text.',
    createdAt: new Date().toISOString(),
  })
}

async function insertProfile(db: Db) {
  await db.collection('profiles').insertOne({
    email: 'candidate@example.com',
    eligibility: { workAuthorization: 'citizen', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: 'Experienced engineer.',
  })
}

async function insertApplication(db: Db) {
  const now = new Date().toISOString()
  await db.collection('applications').insertOne({
    jobId: 'remoteok:1',
    company: 'Acme',
    title: 'Backend Engineer',
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: now,
    updatedAt: now,
  })
}

describe('runAutomation', () => {
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
    await ensureAutomationRunIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('fills the form, records a ready_for_approval run, and merges required answers onto the application', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_HTML))
    await insertMaterials(db)
    await insertProfile(db)
    await insertApplication(db)

    const run = await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' })

    expect(run.status).toBe('ready_for_approval')
    expect(run.filledFields?.['Email address']).toBe('candidate@example.com')

    const application = await db.collection('applications').findOne({ jobId: 'remoteok:1' })
    const questions = (application?.requiredAnswers as Array<{ question: string }>).map(
      (a) => a.question
    )
    expect(questions).toContain('Full name')
  })

  it('records a blocked run with a manual apply link when a captcha is detected', async () => {
    await insertJob(db, dataUrl(MOCK_CAPTCHA_HTML))
    await insertMaterials(db)
    await insertProfile(db)
    await insertApplication(db)

    const run = await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' })

    expect(run.status).toBe('blocked')
    expect(run.blockReason).toBe('captcha')
    expect(run.manualApplyUrl).toBe(dataUrl(MOCK_CAPTCHA_HTML))
  })

  it('preserves an existing non-null answer across a second run for the same question', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_HTML))
    await insertMaterials(db)
    await insertProfile(db)
    await insertApplication(db)

    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' })
    await db.collection('applications').updateOne(
      { jobId: 'remoteok:1', 'requiredAnswers.question': 'Full name' },
      { $set: { 'requiredAnswers.$.answer': 'Jane Doe' } }
    )

    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' })

    const application = await db.collection('applications').findOne({ jobId: 'remoteok:1' })
    const nameAnswer = (
      application?.requiredAnswers as Array<{ question: string; answer: string | null }>
    ).find((a) => a.question === 'Full name')
    expect(nameAnswer?.answer).toBe('Jane Doe')
  })

  it('throws when no materials have been generated for the job', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_HTML))
    await insertProfile(db)
    await insertApplication(db)

    await expect(
      runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' })
    ).rejects.toThrow('no materials')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../../src/automation/automationOrchestrator` does not exist.

- [ ] **Step 3: Implement the orchestrator**

`api/src/automation/automationOrchestrator.ts`:

```ts
import type { Db } from 'mongodb'
import type { Application, Job, Materials, Profile } from '@job-hunter/shared'
import { recordRunResult } from '../applications/automationRunsService'
import { launchBrowser } from './browser'
import { discoverForm } from './formDiscovery'
import { detectBlocker } from './blockerDetection'
import { fillForm } from './fillStrategy'

async function loadJobMaterialsAndProfile(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string }
): Promise<{ job: Job; materials: Materials; profile: Profile; jobId: string }> {
  const jobId = `${jobKey.sourceId}:${jobKey.sourceJobId}`
  const job = await db.collection<Job>('jobs').findOne(jobKey)
  if (!job) {
    throw new Error(`job not found: ${jobId}`)
  }

  const latestMaterials = await db
    .collection<Materials>('materials')
    .find({ jobId })
    .sort({ version: -1 })
    .limit(1)
    .toArray()
  const materials = latestMaterials[0]
  if (!materials) {
    throw new Error(`no materials have been generated for job ${jobId}`)
  }

  const profile = (await db.collection('profiles').findOne({})) as Profile | null
  if (!profile) {
    throw new Error('no profile exists')
  }

  return { job, materials, profile, jobId }
}

export async function runAutomation(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string }
) {
  const { job, materials, profile, jobId } = await loadJobMaterialsAndProfile(db, jobKey)

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.goto(job.normalizedUrl, { waitUntil: 'domcontentloaded' })

    const blocker = await detectBlocker(page)
    if (blocker) {
      return await recordRunResult(db, jobId, {
        status: 'blocked',
        filledFields: null,
        blockReason: blocker,
        manualApplyUrl: job.normalizedUrl,
      })
    }

    const form = await discoverForm(page)
    const { filledFields, requiredAnswers } = await fillForm(page, form, profile, materials)

    const existingApplication = await db.collection<Application>('applications').findOne({ jobId })
    const existingAnswers = new Map(
      (existingApplication?.requiredAnswers ?? []).map((a) => [a.question, a.answer])
    )
    const mergedAnswers = requiredAnswers.map((a) => ({
      question: a.question,
      answer: existingAnswers.get(a.question) ?? a.answer,
    }))

    await db.collection('applications').updateOne(
      { jobId },
      { $set: { requiredAnswers: mergedAnswers, updatedAt: new Date().toISOString() } }
    )

    return await recordRunResult(db, jobId, {
      status: 'filled',
      filledFields,
      blockReason: null,
      manualApplyUrl: null,
    })
  } finally {
    await browser.close()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (157 total: 153 + 4 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/automation/automationOrchestrator.ts api/test/automation/automationOrchestrator.test.ts
git commit -m "Add fill orchestrator with answer-preserving re-runs"
```

---

### Task 6: Submission action (gated by `canSubmit`)

**Files:**
- Modify: `api/src/automation/automationOrchestrator.ts`
- Test: `api/test/automation/automationOrchestrator.test.ts`

**Interfaces:**
- Consumes: `canSubmit` (M5a), everything Task 5 already consumes.
- Produces: `submitApplication(db: Db, jobKey: { sourceId: string; sourceJobId: string }, runNumber: number): Promise<AutomationRun>` — added to the same file as Task 5's `runAutomation`. Throws if `canSubmit` says no for this exact `(jobId, runNumber)`, or if the job/materials/profile/application/run don't all exist.

- [ ] **Step 1: Write the failing tests**

Add this mock confirmation page HTML constant and these four `it()` blocks to `api/test/automation/automationOrchestrator.test.ts`, inside a new `describe('submitApplication', ...)` block (keep the existing `describe('runAutomation', ...)` block as-is):

```ts
const MOCK_FORM_WITH_SUBMIT_HTML = `
<form id="application-form">
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />
  <button type="submit" onclick="event.preventDefault(); document.body.innerHTML = '<h1>Thank you! Your application has been received.</h1>'">Submit</button>
</form>
`

const MOCK_FORM_NO_CONFIRMATION_HTML = `
<form id="application-form">
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />
  <button type="submit" onclick="event.preventDefault(); document.body.innerHTML = '<p>An error occurred.</p>'">Submit</button>
</form>
`
```

```ts
import { approveRun } from '../../src/applications/automationRunsService'
import { submitApplication } from '../../src/automation/automationOrchestrator'
```

```ts
describe('submitApplication', () => {
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
    await ensureAutomationRunIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('throws when the run has not been approved', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_WITH_SUBMIT_HTML))
    await insertMaterials(db)
    await insertProfile(db)
    await insertApplication(db)
    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' })

    await expect(
      submitApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 1)
    ).rejects.toThrow('not been approved')
  })

  it('reports submitted when the destination page shows a real confirmation', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_WITH_SUBMIT_HTML))
    await insertMaterials(db)
    await insertProfile(db)
    await insertApplication(db)
    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' })
    await approveRun(db, 'remoteok:1', 1, 'profile-1')

    const run = await submitApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 1)

    expect(run.status).toBe('submitted')
  })

  it('reports failed when the destination page shows no confirmation language', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_NO_CONFIRMATION_HTML))
    await insertMaterials(db)
    await insertProfile(db)
    await insertApplication(db)
    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' })
    await approveRun(db, 'remoteok:1', 1, 'profile-1')

    const run = await submitApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 1)

    expect(run.status).toBe('failed')
  })

  it('throws when the job, run, or application cannot all be found', async () => {
    await expect(
      submitApplication(db, { sourceId: 'remoteok', sourceJobId: 'missing' }, 1)
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=api`
Expected: FAIL — `submitApplication` is not exported yet.

- [ ] **Step 3: Implement the submission action**

Add this to `api/src/automation/automationOrchestrator.ts`, alongside the existing imports and `runAutomation`:

```ts
import type { Approval, AutomationRun } from '@job-hunter/shared'
import { canSubmit } from '../applications/automationRunsService'
```

```ts
async function updateRunStatus(
  db: Db,
  jobId: string,
  runNumber: number,
  status: 'submitted' | 'failed'
): Promise<AutomationRun> {
  await db.collection('automationRuns').updateOne(
    { jobId, runNumber },
    { $set: { status, updatedAt: new Date().toISOString() } }
  )
  const updated = await db.collection<AutomationRun>('automationRuns').findOne({ jobId, runNumber })
  if (!updated) {
    throw new Error(`run disappeared while updating status: ${jobId} run ${runNumber}`)
  }
  return updated
}

export async function submitApplication(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string },
  runNumber: number
): Promise<AutomationRun> {
  const { job, materials, profile, jobId } = await loadJobMaterialsAndProfile(db, jobKey)

  const application = await db.collection<Application>('applications').findOne({ jobId })
  const run = await db.collection<AutomationRun>('automationRuns').findOne({ jobId, runNumber })
  const approval = await db.collection<Approval>('approvals').findOne({ jobId, runNumber })
  if (!application || !run) {
    throw new Error(`no application or run found for ${jobId} run ${runNumber}`)
  }
  if (!canSubmit(application, run, approval)) {
    throw new Error(`run ${runNumber} for ${jobId} has not been approved for submission`)
  }

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.goto(job.normalizedUrl, { waitUntil: 'domcontentloaded' })

    const blocker = await detectBlocker(page)
    if (blocker) {
      return await updateRunStatus(db, jobId, runNumber, 'failed')
    }

    const form = await discoverForm(page)
    await fillForm(page, form, profile, materials)

    await page.locator('button[type=submit], input[type=submit]').first().click()
    await page.waitForLoadState('domcontentloaded')

    const confirmed = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase()
      return /thank you|application (received|submitted)|successfully applied/.test(text)
    })

    return await updateRunStatus(db, jobId, runNumber, confirmed ? 'submitted' : 'failed')
  } finally {
    await browser.close()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=api`
Expected: PASS (161 total: 157 + 4 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/automation/automationOrchestrator.ts api/test/automation/automationOrchestrator.test.ts
git commit -m "Add gated submission action with confirmation-based status detection"
```

---

### Task 7: Automation routes and server wiring

**Files:**
- Create: `api/src/routes/automation.ts`
- Modify: `api/src/server.ts`
- Test: `api/test/automation.test.ts`

**Interfaces:**
- Consumes: `createRequireAuth`/`AuthVariables` (M1), `runAutomation`/`submitApplication` (Tasks 5-6).
- Produces: `createAutomationRoutes(db: Db, jwtSecret: string): Hono`. Two endpoints: `POST /automation/:jobId/run` (`:jobId` is the `sourceId:sourceJobId` composite) → `200` with the resulting `AutomationRun` JSON, `404` if the job/materials/profile prerequisites are missing; `POST /automation/:jobId/runs/:runNumber/submit` → `200` with the resulting `AutomationRun` JSON on success, `403` if the run has not been approved (distinct from `404`, since the run/application genuinely exist — the request is just not authorized yet), `404` if the job/application/run don't exist at all.

- [ ] **Step 1: Write the failing test**

`api/test/automation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createAutomationRoutes } from '../src/routes/automation'
import { ensureApplicationIndexes } from '../src/applications/applicationsService'
import { ensureAutomationRunIndexes } from '../src/applications/automationRunsService'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const MOCK_FORM_HTML = `
<form>
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />
</form>
`

function dataUrl(html: string): string {
  return 'data:text/html,' + encodeURIComponent(html)
}

interface AuthResponseBody {
  token: string
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'automation-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

async function insertJob(db: Db) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId: '1',
    normalizedUrl: dataUrl(MOCK_FORM_HTML),
    title: 'Engineer',
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

async function insertMaterials(db: Db) {
  await db.collection('materials').insertOne({
    jobId: 'remoteok:1',
    version: 1,
    unmetRequirements: [],
    tailoredCv: 'Tailored CV text.',
    coverLetter: 'Cover letter text.',
    outreachMessage: 'Outreach text.',
    createdAt: new Date().toISOString(),
  })
}

async function insertProfile(db: Db) {
  await db.collection('profiles').insertOne({
    email: 'candidate@example.com',
    eligibility: { workAuthorization: 'citizen', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: 'Experienced engineer.',
  })
}

async function insertApplication(db: Db) {
  const now = new Date().toISOString()
  await db.collection('applications').insertOne({
    jobId: 'remoteok:1',
    company: 'Acme',
    title: 'Engineer',
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: now,
    updatedAt: now,
  })
}

describe('automation routes', () => {
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
    await insertMaterials(db)
    await insertProfile(db)
    await insertApplication(db)

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/automation', createAutomationRoutes(db, JWT_SECRET))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a run request with no token', async () => {
    const res = await app.request('/automation/remoteok:1/run', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('runs automation and returns the resulting run', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/automation/remoteok:1/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ready_for_approval')
  })

  it('403s a submit request for a run that has not been approved', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/automation/remoteok:1/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = await app.request('/automation/remoteok:1/runs/1/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=api`
Expected: FAIL — `../src/routes/automation` does not exist.

- [ ] **Step 3: Implement the route**

`api/src/routes/automation.ts`:

```ts
import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireAuth, type AuthVariables } from '../middleware/auth'
import { runAutomation, submitApplication } from '../automation/automationOrchestrator'

export function createAutomationRoutes(db: Db, jwtSecret: string) {
  const automationRoutes = new Hono<{ Variables: AuthVariables }>()
  automationRoutes.use('*', createRequireAuth(jwtSecret))

  automationRoutes.post('/:jobId/run', async (c) => {
    const [sourceId, sourceJobId] = c.req.param('jobId').split(':')
    if (!sourceId || !sourceJobId) {
      return c.json({ error: 'invalid job id' }, 400)
    }

    try {
      const run = await runAutomation(db, { sourceId, sourceJobId })
      return c.json(run)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'failed to run automation'
      return c.json({ error: message }, 404)
    }
  })

  automationRoutes.post('/:jobId/runs/:runNumber/submit', async (c) => {
    const [sourceId, sourceJobId] = c.req.param('jobId').split(':')
    const runNumber = Number(c.req.param('runNumber'))
    if (!sourceId || !sourceJobId) {
      return c.json({ error: 'invalid job id' }, 400)
    }

    try {
      const run = await submitApplication(db, { sourceId, sourceJobId }, runNumber)
      return c.json(run)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'failed to submit application'
      const status = message.includes('not been approved') ? 403 : 404
      return c.json({ error: message }, status)
    }
  })

  return automationRoutes
}
```

- [ ] **Step 4: Wire the server composition root**

In `api/src/server.ts`, add this import alongside the existing ones:

```ts
import { createAutomationRoutes } from './routes/automation'
```

After the existing `/applications` route mount, add:

```ts
  app.route('/automation', createAutomationRoutes(db, jwtSecret))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=api`
Expected: PASS (164 total: 161 + 3 new)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=api`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/automation.ts api/src/server.ts api/test/automation.test.ts
git commit -m "Add automation routes and wire the Playwright engine into the server"
```

---

## M5b Definition of Done

- `npm test` passes across `api` (164 tests) and `shared` (25 tests, unchanged) — 189 total.
- `npm run typecheck` passes across all three workspaces.
- `npx playwright install chromium` has been run in the `api/` workspace — document this in the project's setup instructions (a future README/CI task, not this plan) since it's a step `npm install` alone does not cover.
- **Manual smoke test against a real job posting is the one check this plan's automated suite cannot replace.** With a real discovered→verified job, real generated materials, and a real profile: `POST /automation/<jobId>/run` against the job's actual `normalizedUrl` and inspect the resulting `filledFields`/`requiredAnswers` by hand — confirm nothing was mis-filled, confirm the consent checkbox (if the real form has one) was genuinely left unticked, and confirm the `requiredAnswers` list matches what a human looking at the real form would expect to need to answer. Only after that manual review should `POST /automation/<jobId>/runs/<runNumber>/submit` ever be exercised against a real third-party site — and even then, only after `POST /applications/<jobId>/runs/<runNumber>/approve` has genuinely been reviewed and clicked by the user, not scripted. Treat the first-ever real submission as a supervised, one-off test, not something to automate or sweep.
- Explicitly NOT in scope for M5b (deferred to M6): `node-cron`-triggered scheduling of any of this plan's routes, the MongoDB-backed background-job queue, retries/dead-lettering, and anything related to CI or deployment.
