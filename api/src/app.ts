import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Vercel mints a new random preview URL (job-hunter-<hash>-nurulkomors-projects.vercel.app)
// on every deploy, so hardcoding each one in DASHBOARD_URL means CORS breaks on every
// preview. Any origin matching this project's preview URL shape is allowed automatically;
// DASHBOARD_URL stays for origins that don't fit the pattern (localhost, a custom domain).
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/job-hunter-[a-z0-9]+-nurulkomors-projects\.vercel\.app$/

export function createApp() {
  const app = new Hono()
  const allowedOrigins = (process.env.DASHBOARD_URL ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
  app.use(
    '*',
    cors({
      origin: (origin) =>
        allowedOrigins.includes(origin) || VERCEL_PREVIEW_ORIGIN.test(origin) ? origin : undefined,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    })
  )
  app.get('/health', (c) => c.json({ status: 'ok' }))
  return app
}
