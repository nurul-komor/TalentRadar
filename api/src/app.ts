import { Hono } from 'hono'
import { cors } from 'hono/cors'

export function createApp() {
  const app = new Hono()
  // Dashboard runs on a different origin (Vite dev server) than the API, so
  // browser requests need CORS. Not exercised by the in-process Vitest
  // suites (same-process fetch has no Origin header), only surfaced by the
  // Task 9 full-stack smoke test driving a real browser.
  app.use(
    '*',
    cors({
      origin: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    })
  )
  app.get('/health', (c) => c.json({ status: 'ok' }))
  return app
}
