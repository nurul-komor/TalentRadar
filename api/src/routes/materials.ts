import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import type { Materials, Profile } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { generateMaterials } from '../materials/materialsService.js'
import { exportToPdf, exportToDocx } from '../materials/exporters.js'
import { DOCX_MIME_TYPE } from '../profile/cvParser.js'
import { NotFoundError } from '../lib/errors.js'
import type { MaterialsGenerator } from '../materials/types.js'

const EXPORTABLE_DOCS = ['tailoredCv', 'coverLetter', 'outreachMessage'] as const
type ExportableDoc = (typeof EXPORTABLE_DOCS)[number]

export function createMaterialsRoutes(db: Db, jwtSecret: string, generator: MaterialsGenerator) {
  const materialsRoutes = new Hono<{ Variables: AuthVariables }>()
  materialsRoutes.use('*', createRequireAuth(jwtSecret))

  materialsRoutes.post('/:jobId/generate', async (c) => {
    const [sourceId, sourceJobId] = c.req.param('jobId').split(':')
    if (!sourceId || !sourceJobId) {
      return c.json({ error: 'invalid job id' }, 400)
    }

    const profile = (await db
      .collection('profiles')
      .findOne({ _id: new ObjectId(c.get('profileId')) })) as Profile | null
    if (!profile) {
      return c.json({ error: 'profile not found' }, 404)
    }

    try {
      const result = await generateMaterials(
        db,
        { sourceId, sourceJobId },
        profile,
        c.get('profileId'),
        generator
      )
      return c.json(result)
    } catch (reason) {
      if (reason instanceof NotFoundError) return c.json({ error: reason.message }, 404)
      console.error('failed to generate materials', reason)
      return c.json({ error: 'failed to generate materials' }, 500)
    }
  })

  materialsRoutes.get('/:jobId', async (c) => {
    const jobId = c.req.param('jobId')
    const latest = await db
      .collection<Materials>('materials')
      .find({ jobId })
      .sort({ version: -1 })
      .limit(1)
      .toArray()
    const materials = latest[0] ?? null
    if (!materials) {
      return c.json({ error: 'materials not found' }, 404)
    }
    if (materials.profileId !== c.get('profileId')) {
      return c.json({ error: 'forbidden' }, 403)
    }
    return c.json(materials)
  })

  materialsRoutes.get('/:jobId/:version/export', async (c) => {
    const jobId = c.req.param('jobId')
    const version = Number(c.req.param('version'))
    const doc = c.req.query('doc')
    const format = c.req.query('format')

    if (!EXPORTABLE_DOCS.includes(doc as ExportableDoc)) {
      return c.json({ error: 'invalid doc' }, 400)
    }
    if (format !== 'pdf' && format !== 'docx') {
      return c.json({ error: 'invalid format' }, 400)
    }

    const materials = await db.collection<Materials>('materials').findOne({ jobId, version })
    if (!materials) {
      return c.json({ error: 'materials not found' }, 404)
    }
    if (materials.profileId !== c.get('profileId')) {
      return c.json({ error: 'forbidden' }, 403)
    }

    const text = materials[doc as ExportableDoc]
    const buffer = format === 'pdf' ? await exportToPdf(text) : await exportToDocx(text)
    const contentType = format === 'pdf' ? 'application/pdf' : DOCX_MIME_TYPE

    c.header('Content-Type', contentType)
    c.header('Content-Disposition', `attachment; filename="${doc}.${format}"`)
    // Hono's `c.body()` types accept ArrayBuffer/Uint8Array<ArrayBuffer>, not Node's
    // Buffer<ArrayBufferLike> directly — slice to a definite ArrayBuffer view.
    return c.body(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
  })

  return materialsRoutes
}
