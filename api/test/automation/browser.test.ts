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
