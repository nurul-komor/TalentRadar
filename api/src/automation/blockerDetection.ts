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
