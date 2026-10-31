import { chromium, type Browser } from 'playwright'

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true })
}

export type { Browser, Page } from 'playwright'
