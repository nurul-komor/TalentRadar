import { Hono, type Context } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import type { Materials, Profile } from '@job-hunter/shared'
import { SaveMaterialsInputSchema } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { generateMaterials, saveMaterials, getSavedMaterials } from '../materials/materialsService.js'
import { exportToPdf, exportToDocx } from '../materials/exporters.js'
import { DOCX_MIME_TYPE } from '../profile/cvParser.js'
import { NotFoundError } from '../lib/errors.js'
import type { MaterialsGenerator } from '../materials/types.js'

const EXPORTABLE_DOCS = ['tailoredCv', 'coverLetter', 'outreachMessage'] as const
type ExportableDoc = (typeof EXPORTABLE_DOCS)[number]

// `getGenerator` is read per request so runtime-saved AI credentials apply immediately; it
// returns null when no LLM is configured (only the /generate endpoint needs it — the
// save/fetch/export endpoints work regardless).
export function createMaterialsRoutes(
  db: Db,
  jwtSecret: string,
  getGenerator: () => MaterialsGenerator | null
) {
  const materialsRoutes = new Hono<{ Variables: AuthVariables }>()
  materialsRoutes.use('*', createRequireAuth(jwtSecret))

  materialsRoutes.post('/:jobId/generate', async (c) => {
    const generator = getGenerator()
    if (!generator) return c.json({ error: 'AI is not configured' }, 503)

    const jobIdParam = c.req.param('jobId')
    const separatorIndex = jobIdParam.indexOf(':')
    const sourceId = separatorIndex === -1 ? '' : jobIdParam.slice(0, separatorIndex)
    const sourceJobId = separatorIndex === -1 ? '' : jobIdParam.slice(separatorIndex + 1)
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

  // Save the user's chosen cover letter / tailored CV for this job under their
  // profile. Overwrites any prior saved copy for the same (user, job) pair and
  // leaves the base profile résumé untouched.
  materialsRoutes.post('/:jobId/save', async (c) => {
    const jobId = c.req.param('jobId')
    const payload = await c.req.json().catch(() => null)
    const parsed = SaveMaterialsInputSchema.safeParse(payload)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid payload' }, 400)
    }
    const saved = await saveMaterials(db, jobId, c.get('profileId'), parsed.data)
    return c.json(saved)
  })

  // Fetch the saved cover letter / tailored CV for this job, scoped to the caller.
  materialsRoutes.get('/:jobId/saved', async (c) => {
    const jobId = c.req.param('jobId')
    const saved = await getSavedMaterials(db, jobId, c.get('profileId'))
    if (!saved) {
      return c.json({ error: 'no saved materials' }, 404)
    }
    return c.json(saved)
  })

  materialsRoutes.get('/:jobId', async (c) => {
    const jobId = c.req.param('jobId')
    // Scope by profileId so each user retrieves the cover letter saved under
    // their own profile, rather than the globally-latest version for this job
    // (which would 403 a user whenever someone else generated a newer version).
    const latest = await db
      .collection<Materials>('materials')
      .find({ jobId, profileId: c.get('profileId') })
      .sort({ version: -1 })
      .limit(1)
      .toArray()
    const materials = latest[0] ?? null
    if (!materials) {
      return c.json({ error: 'materials not found' }, 404)
    }
    return c.json(materials)
  })

  // Renders a single document from a materials record to PDF/DOCX. The tailored CV
  // is rendered with resume structure (headings, bullets); other docs stay plain.
  async function renderExport(c: Context, materials: Materials, doc: ExportableDoc, format: 'pdf' | 'docx') {
    const text = materials[doc]
    const asResume = doc === 'tailoredCv'
    const buffer =
      format === 'pdf'
        ? await exportToPdf(text, { resume: asResume })
        : await exportToDocx(text, { resume: asResume })
    const contentType = format === 'pdf' ? 'application/pdf' : DOCX_MIME_TYPE
    const filename = doc === 'tailoredCv' ? `tailored-cv.${format}` : `${doc}.${format}`

    c.header('Content-Type', contentType)
    c.header('Content-Disposition', `attachment; filename="${filename}"`)
    // Exports are regenerated per request from the latest materials version; never
    // let the browser serve a stale previously-downloaded blob for the same URL.
    c.header('Cache-Control', 'no-store')
    // Hono's `c.body()` types accept ArrayBuffer/Uint8Array<ArrayBuffer>, not Node's
    // Buffer<ArrayBufferLike> directly — slice to a definite ArrayBuffer view.
    return c.body(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
  }

  function parseExportQuery(c: Context): { doc: ExportableDoc; format: 'pdf' | 'docx' } | { error: string } {
    const doc = c.req.query('doc')
    const format = c.req.query('format')
    if (!EXPORTABLE_DOCS.includes(doc as ExportableDoc)) return { error: 'invalid doc' }
    if (format !== 'pdf' && format !== 'docx') return { error: 'invalid format' }
    return { doc: doc as ExportableDoc, format }
  }

  // Export the latest version of a document for the caller's profile — lets the UI
  // download the tailored CV without tracking the exact version number.
  materialsRoutes.get('/:jobId/export', async (c) => {
    const jobId = c.req.param('jobId')
    const parsed = parseExportQuery(c)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)

    const latest = await db
      .collection<Materials>('materials')
      .find({ jobId, profileId: c.get('profileId') })
      .sort({ version: -1 })
      .limit(1)
      .toArray()
    const materials = latest[0]
    if (!materials) {
      return c.json({ error: 'materials not found' }, 404)
    }
    return renderExport(c, materials, parsed.doc, parsed.format)
  })

  materialsRoutes.get('/:jobId/:version/export', async (c) => {
    const jobId = c.req.param('jobId')
    const version = Number(c.req.param('version'))
    const parsed = parseExportQuery(c)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)

    const materials = await db.collection<Materials>('materials').findOne({ jobId, version })
    if (!materials) {
      return c.json({ error: 'materials not found' }, 404)
    }
    if (materials.profileId !== c.get('profileId')) {
      return c.json({ error: 'forbidden' }, 403)
    }
    return renderExport(c, materials, parsed.doc, parsed.format)
  })

  return materialsRoutes
}
