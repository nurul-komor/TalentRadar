import { chromium, type Browser, type Page } from 'playwright'

// tsx compiles this server with esbuild's `keepNames` on, which wraps every
// named function/arrow with a `__name(fn, "name")` helper. That helper is
// defined in the Node module scope only — but `page.evaluate(fn)` serializes
// just the callback body and runs it in the browser, where `__name` doesn't
// exist. Any evaluate callback containing a named function (e.g. discoverForm's
// `labelFor`/`nextId`) therefore throws "ReferenceError: __name is not defined"
// in the page context. Defining a no-op `__name` on the browser's global before
// our callbacks run makes those wrapper calls harmless. The script is passed as
// a raw string so esbuild can't rewrite it (and re-introduce the problem).
const KEEP_NAMES_SHIM = 'globalThis.__name = globalThis.__name || function (fn) { return fn }'

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true })
}

// Use this instead of `browser.newPage()` for any page we drive with
// page.evaluate(), so the keep-names shim is installed on every document the
// page navigates to before our callbacks execute.
export async function newAutomationPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage()
  await page.addInitScript({ content: KEEP_NAMES_SHIM })
  return page
}

export type { Browser, Page } from 'playwright'
