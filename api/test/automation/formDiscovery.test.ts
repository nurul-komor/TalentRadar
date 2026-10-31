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
