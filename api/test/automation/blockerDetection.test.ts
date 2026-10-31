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
