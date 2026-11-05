import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ForbiddenError, NotFoundError } from './lib/errors.js'

// Vercel mints a new random preview URL on every deploy, so hardcoding each one in
// DASHBOARD_URL means CORS breaks on every preview. Any origin matching this project's
// production or preview URL shape is allowed automatically; DASHBOARD_URL stays for
// origins that don't fit the pattern (localhost, a custom domain).
//   - production:        https://tech-job-hunter-ai.vercel.app
//   - project previews:  https://tech-job-hunter-ai-<hash>.vercel.app
//   - legacy previews:   https://job-hunter-<hash>-nurulkomors-projects.vercel.app
const VERCEL_ORIGIN =
  /^https:\/\/(tech-job-hunter-ai(-[a-z0-9-]+)?|job-hunter-[a-z0-9]+-nurulkomors-projects)\.vercel\.app$/

export function createApp() {
  const app = new Hono()
  const allowedOrigins = (process.env.DASHBOARD_URL ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
  app.use(
    '*',
    cors({
      origin: (origin) =>
        allowedOrigins.includes(origin) || VERCEL_ORIGIN.test(origin) ? origin : undefined,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    })
  )
  app.get('/health', (c) => c.json({ status: 'ok' }))

  // Catch-all so an error that escapes a handler is logged with its stack and
  // returned as JSON, instead of Hono's opaque bare-text "Internal Server Error"
  // that hides the cause. Domain errors keep their intended status as a safety
  // net for any handler that forgets to map them locally.
  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403)
    console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err)
    return c.json({ error: 'internal server error' }, 500)
  })

  return app
}
