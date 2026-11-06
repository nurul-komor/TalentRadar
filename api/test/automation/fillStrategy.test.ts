import { describe, it, expect, afterEach } from 'vitest'
import { launchBrowser } from '../../src/automation/browser'
import { discoverForm } from '../../src/automation/formDiscovery'
import { fillForm } from '../../src/automation/fillStrategy'
import type { Browser } from '../../src/automation/browser'
import type { Materials, Profile } from '@job-hunter/shared'
import { emptyResume } from '@job-hunter/shared'

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
    resume: emptyResume(),
    onboardingCompletedAt: null,
  }
}

function materials(): Materials {
  return {
    jobId: 'remoteok:1',
    profileId: 'profile-1',
    version: 1,
    unmetRequirements: [],
    missingSkills: [],
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

    // vitest's `expect` is Chai-based and has no `toHaveValue`/`toBeChecked`
    // matchers (those come from `@playwright/test`, a different dependency
    // than this plan's Tech Stack calls for) — use the plain Locator API instead.
    expect(await page.locator('#email-field').inputValue()).toBe('candidate@example.com')
    expect(await page.locator('#cover-field').inputValue()).toBe('This is my cover letter.')
    expect(await page.locator('#consent-field').isChecked()).toBe(false)

    const cvInputFiles = await page.locator('#cv-field').evaluate((el: HTMLInputElement) =>
      el.files ? Array.from(el.files).map((f: any) => f.name) : []
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
