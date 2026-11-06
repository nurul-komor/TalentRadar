import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { createRequireAdmin } from '../middleware/admin.js'
import type { Embedder } from '../embeddings/embeddingProvider.js'
import { getSuggestions } from '../suggestions/suggestionsService.js'
import { embedJobs } from '../suggestions/embeddingService.js'

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

// `getEmbedder` is read per request so a runtime embedding-mode/credential change (via the
// admin settings page) applies immediately; it returns null when no embedder is configured.
export function createSuggestionsRoutes(
  db: Db,
  jwtSecret: string,
  getEmbedder: () => Embedder | null
) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  routes.use('*', createRequireAuth(jwtSecret))

  // Semantic job suggestions for the authenticated user: jobs ranked by similarity to their
  // resume/skills, blended with the existing rule-based score.
  routes.get('/', async (c) => {
    const embedder = getEmbedder()
    if (!embedder) return c.json({ error: 'suggestions are not configured' }, 503)
    const raw = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), MAX_LIMIT) : DEFAULT_LIMIT

    const result = await getSuggestions(db, embedder, c.get('profileId'), limit)
    return c.json(result)
  })

  // Operator-only bulk (re)embedding of the global job feed. `force=true` re-embeds every
  // verified job regardless of hash (e.g. after changing the embedding model).
  routes.post('/reindex', createRequireAdmin(db), async (c) => {
    const embedder = getEmbedder()
    if (!embedder) return c.json({ error: 'embedder not configured' }, 503)
    const force = c.req.query('force') === 'true'
    const result = await embedJobs(db, embedder, { force })
    return c.json(result)
  })

  return routes
}
