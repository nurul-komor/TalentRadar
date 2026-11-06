import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import type { Job } from '@job-hunter/shared'
import { AiSettingsUpdateSchema } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { createRequireAdmin } from '../middleware/admin.js'
import type { AiRuntime } from '../ai/aiRuntime.js'
import { updateAiSettings } from '../settings/settingsService.js'
import { embedJobs } from '../suggestions/embeddingService.js'
import { SUGGESTIBLE_JOB_STATUSES, isVectorSearchUnavailable } from '../suggestions/vectorSearch.js'
import { createCloudinaryFileManager } from '../profile/cloudinaryStorage.js'

export function createAdminRoutes(db: Db, jwtSecret: string, aiRuntime: AiRuntime) {
  const adminRoutes = new Hono<{ Variables: AuthVariables }>()
  adminRoutes.use('*', createRequireAuth(jwtSecret))
  adminRoutes.use('*', createRequireAdmin(db))

  adminRoutes.get('/users', async (c) => {
    const users = await db
      .collection('profiles')
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray()
    return c.json({ users })
  })

  adminRoutes.get('/discovery/status', async (c) => {
    const jobs = db.collection('jobs')
    const [totalJobs, mostRecent] = await Promise.all([
      jobs.countDocuments({}),
      jobs.find({}, { projection: { discoveredAt: 1 } }).sort({ discoveredAt: -1 }).limit(1).next(),
    ])
    return c.json({ totalJobs, mostRecentDiscoveredAt: mostRecent?.discoveredAt ?? null })
  })

  // --- AI credentials -------------------------------------------------------------------

  // Masked view of the current AI settings (never returns raw secrets).
  adminRoutes.get('/settings/ai', (c) => c.json(aiRuntime.view()))

  // Update AI settings, persist to DB, and hot-reload the runtime so the change takes
  // effect immediately (no redeploy). Returns the new masked view.
  adminRoutes.put('/settings/ai', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = AiSettingsUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid settings', issues: parsed.error.issues }, 400)
    }
    const profile = await db
      .collection('profiles')
      .findOne({ _id: new ObjectId(c.get('profileId')) }, { projection: { email: 1 } })
    await updateAiSettings(db, process.env, parsed.data, profile?.email ?? null, new Date().toISOString())
    await aiRuntime.reload()
    return c.json(aiRuntime.view())
  })

  // Live connection test: validates the embedder end-to-end (a real embed call — this both
  // verifies an OpenAI key and warms/loads a local HF model) and reports LLM readiness.
  adminRoutes.post('/settings/ai/test', async (c) => {
    const llm = aiRuntime.llm
    const llmResult = llm
      ? { ok: true as const, provider: llm.providerName }
      : { ok: false as const, error: 'No API key configured for the selected provider.' }

    let embedderResult: { ok: boolean; dimensions?: number; model?: string; error?: string }
    const embedder = aiRuntime.embedder
    if (!embedder) {
      embedderResult = { ok: false, error: 'No embedder configured.' }
    } else {
      try {
        const { vectors } = await embedder.embed(['connection test'])
        embedderResult = { ok: true, dimensions: vectors[0]?.length ?? embedder.dimensions, model: embedder.model }
      } catch (reason) {
        embedderResult = { ok: false, error: reason instanceof Error ? reason.message : String(reason) }
      }
    }
    return c.json({ llm: llmResult, embedder: embedderResult })
  })

  // --- Vector manager -------------------------------------------------------------------

  // Index health + embedding coverage. "mode" reflects how vectors are generated (ai vs the
  // local HF model); "vectorSearch" reports whether Atlas $vectorSearch is in use or the
  // process has fallen back to in-memory cosine similarity.
  adminRoutes.get('/vectors/status', async (c) => {
    const jobs = db.collection<Job>('jobs')
    const suggestible = { status: { $in: SUGGESTIBLE_JOB_STATUSES } }
    const [total, embedded, pending] = await Promise.all([
      jobs.countDocuments(suggestible),
      jobs.countDocuments({ ...suggestible, embedding: { $type: 'array' } }),
      jobs.countDocuments({ ...suggestible, embeddingHash: null }),
    ])
    return c.json({
      mode: aiRuntime.settings.embeddingMode,
      embeddingModel: aiRuntime.embedder?.model ?? aiRuntime.settings.embeddingModel,
      dimensions: aiRuntime.embedder?.dimensions ?? aiRuntime.settings.embeddingDimensions,
      embedderReady: aiRuntime.embedder !== null,
      vectorSearch: isVectorSearchUnavailable() ? 'in-memory-fallback' : 'atlas-or-untried',
      counts: { total, embedded, pending, unembedded: total - embedded },
    })
  })

  // Re-embed suggestible jobs. force=true re-embeds everything (e.g. after a model/dimension
  // change); otherwise only missing ones. Returns the embed run summary.
  adminRoutes.post('/vectors/reindex', async (c) => {
    const embedder = aiRuntime.embedder
    if (!embedder) return c.json({ error: 'embedder not configured' }, 503)
    const force = c.req.query('force') === 'true'
    const result = await embedJobs(db, embedder, { force })
    return c.json(result)
  })

  // Paginated list of suggestible jobs with their embedding status, for manual inspection.
  adminRoutes.get('/vectors/jobs', async (c) => {
    const jobs = db.collection<Job>('jobs')
    const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '25', 10) || 25, 1), 100)
    const skip = Math.max(Number.parseInt(c.req.query('skip') ?? '0', 10) || 0, 0)
    const filter = c.req.query('filter') // 'embedded' | 'unembedded' | undefined
    const query: Record<string, unknown> = { status: { $in: SUGGESTIBLE_JOB_STATUSES } }
    if (filter === 'embedded') query.embedding = { $type: 'array' }
    if (filter === 'unembedded') query.$or = [{ embedding: null }, { embedding: { $exists: false } }]

    const [total, docs] = await Promise.all([
      jobs.countDocuments(query),
      // Aggregation so we can compute the `embedded` boolean with $isArray and project the
      // 1536-float vector out — a find() projection can't evaluate expressions.
      jobs
        .aggregate([
          { $match: query },
          { $sort: { discoveredAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              title: 1,
              company: 1,
              status: 1,
              embeddingModel: 1,
              embeddedAt: 1,
              embedded: { $isArray: '$embedding' },
            },
          },
        ])
        .toArray(),
    ])

    const items = docs.map((d) => ({
      _id: String(d._id),
      title: d.title,
      company: d.company,
      status: d.status,
      embedded: Boolean(d.embedded),
      embeddingModel: d.embeddingModel ?? null,
      embeddedAt: d.embeddedAt ?? null,
    }))
    return c.json({ items, total, limit, skip })
  })

  // Re-embed a single job on demand.
  adminRoutes.post('/vectors/jobs/:id/reembed', async (c) => {
    const embedder = aiRuntime.embedder
    if (!embedder) return c.json({ error: 'embedder not configured' }, 503)
    let _id: ObjectId
    try {
      _id = new ObjectId(c.req.param('id'))
    } catch {
      return c.json({ error: 'invalid id' }, 400)
    }
    const job = await db.collection<Job>('jobs').findOne({ _id: _id as never })
    if (!job) return c.json({ error: 'job not found' }, 404)
    // Clear the hash so the targeted (non-force) embed pass treats it as pending, then run a
    // bounded embed. embedJobs re-scans but limit=... keeps it cheap for a single-job intent.
    await db.collection('jobs').updateOne({ _id: _id as never }, { $set: { embeddingHash: null } })
    const result = await embedJobs(db, embedder, { limit: 1 })
    return c.json(result)
  })

  // Clear a single job's embedding (tombstone it so the lazy pass won't re-embed until the
  // text changes or a force reindex runs).
  adminRoutes.delete('/vectors/jobs/:id/embedding', async (c) => {
    let _id: ObjectId
    try {
      _id = new ObjectId(c.req.param('id'))
    } catch {
      return c.json({ error: 'invalid id' }, 400)
    }
    const result = await db
      .collection('jobs')
      .updateOne(
        { _id: _id as never },
        { $set: { embedding: null, embeddingModel: null, embeddingHash: null, embeddedAt: null } }
      )
    if (result.matchedCount === 0) return c.json({ error: 'job not found' }, 404)
    return c.json({ ok: true })
  })

  // --- File manager ---------------------------------------------------------------------

  adminRoutes.get('/files', async (c) => {
    const manager = createCloudinaryFileManager(process.env)
    if (!manager) return c.json({ configured: false, files: [] })
    try {
      const files = await manager.list()
      return c.json({ configured: true, files })
    } catch (reason) {
      return c.json({ error: reason instanceof Error ? reason.message : 'failed to list files' }, 502)
    }
  })

  adminRoutes.delete('/files', async (c) => {
    const manager = createCloudinaryFileManager(process.env)
    if (!manager) return c.json({ error: 'storage not configured' }, 503)
    const publicId = c.req.query('publicId')
    if (!publicId) return c.json({ error: 'publicId required' }, 400)
    try {
      const removed = await manager.remove(publicId)
      if (!removed) return c.json({ error: 'delete failed' }, 502)
      // Clear any profile reference to the now-deleted file so stale links disappear.
      await db
        .collection('profiles')
        .updateMany(
          { cvFilePublicId: publicId },
          { $set: { cvFileUrl: null, cvFilePublicId: null } }
        )
      return c.json({ ok: true })
    } catch (reason) {
      return c.json({ error: reason instanceof Error ? reason.message : 'delete failed' }, 502)
    }
  })

  adminRoutes.post('/files', async (c) => {
    const manager = createCloudinaryFileManager(process.env)
    if (!manager) return c.json({ error: 'storage not configured' }, 503)
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file required' }, 400)
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const uploaded = await manager.upload(buffer, file.name || 'upload')
      return c.json(uploaded, 201)
    } catch (reason) {
      return c.json({ error: reason instanceof Error ? reason.message : 'upload failed' }, 502)
    }
  })

  return adminRoutes
}
