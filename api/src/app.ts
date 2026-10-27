import { Hono } from 'hono'
import { cors } from 'hono/cors'

export function createApp() {
  const app = new Hono()
  // Dashboard runs on a different origin (Vite dev server, or a deployed
  // preview/production URL) than the API, so browser requests need CORS.
  // DASHBOARD_URL accepts a comma-separated list so a preview deploy can be
  // tested against a local API without losing local dev access. Not
  // exercised by the in-process Vitest suites (same-process fetch has no
  // Origin header), only surfaced by a real browser.
  const allowedOrigins = (process.env.DASHBOARD_URL ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    })
  )
  app.get('/health', (c) => c.json({ status: 'ok' }))
  return app
}
