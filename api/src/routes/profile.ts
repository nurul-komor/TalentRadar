import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import type { Profile, Resume } from '@job-hunter/shared'
import { ProfileUpdateSchema, emptyResume, isResumeEmpty } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { parseCvFile, DOCX_MIME_TYPE, type CvParser } from '../profile/cvParser.js'
import { renderResumePdf } from '../profile/cvExporter.js'
import type { ResumeExtractor } from '../profile/types.js'
import { isWithinBudget, recordUsage } from '../scoring/aiUsageService.js'

const MAX_CV_FILE_BYTES = 10 * 1024 * 1024

export function createProfileRoutes(
  db: Db,
  jwtSecret: string,
  cvParser: CvParser = parseCvFile,
  resumeExtractor: ResumeExtractor | null = null
) {
  const profileRoutes = new Hono<{ Variables: AuthVariables }>()
  profileRoutes.use('*', createRequireAuth(jwtSecret))

  profileRoutes.get('/', async (c) => {
    const profile = await db
      .collection('profiles')
      .findOne(
        { _id: new ObjectId(c.get('profileId')) },
        { projection: { passwordHash: 0 } }
      )
    if (!profile) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json(profile)
  })

  profileRoutes.put('/', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = ProfileUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400)
    }

    const profiles = db.collection('profiles')
    const result = await profiles.findOneAndUpdate(
      { _id: new ObjectId(c.get('profileId')) },
      { $set: { ...parsed.data, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', projection: { passwordHash: 0 } }
    )
    if (!result) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json(result)
  })

  profileRoutes.get('/cv/export', async (c) => {
    const profile = (await db
      .collection('profiles')
      .findOne(
        { _id: new ObjectId(c.get('profileId')) },
        { projection: { passwordHash: 0 } }
      )) as Profile | null
    if (!profile) {
      return c.json({ error: 'profile not found' }, 404)
    }

    // Profiles created before the resume field existed won't have it on the stored document.
    const pdfBuffer = await renderResumePdf({ ...profile, resume: profile.resume ?? emptyResume() })

    c.header('Content-Type', 'application/pdf')
    c.header('Content-Disposition', 'attachment; filename="cv.pdf"')
    return c.body(pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength) as ArrayBuffer)
  })

  profileRoutes.post('/cv', async (c) => {
    const body = await c.req.parseBody()
    const file = body.file
    if (!(file instanceof File)) {
      return c.json({ error: 'file is required' }, 400)
    }
    if (file.size > MAX_CV_FILE_BYTES) {
      return c.json({ error: 'file too large' }, 400)
    }
    if (file.type !== 'application/pdf' && file.type !== DOCX_MIME_TYPE) {
      return c.json({ error: 'unsupported file type' }, 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let cvText: string
    try {
      cvText = await cvParser(buffer, file.type)
    } catch {
      return c.json({ error: 'failed to parse file' }, 400)
    }

    const profileId = new ObjectId(c.get('profileId'))
    const profiles = db.collection('profiles')

    // Try to auto-fill the structured resume from the uploaded CV. This never blocks or fails
    // the upload itself — extraction is best-effort: skipped if no extractor is configured, the
    // AI budget is exceeded, or Claude errors, in which case the upload just stores cvText as before.
    let resumeUpdate: Resume | undefined
    let suggestedResume: Resume | null = null
    console.error('DEBUG typeof env', typeof process.env.ANTHROPIC_DAILY_BUDGET_USD, JSON.stringify(process.env.ANTHROPIC_DAILY_BUDGET_USD), 'parsed', Number.parseFloat(process.env.ANTHROPIC_DAILY_BUDGET_USD ?? '1'))
    if (resumeExtractor && (await isWithinBudget(db))) {
      try {
        const existing = (await profiles.findOne({ _id: profileId })) as Profile | null
        const extraction = await resumeExtractor(cvText)
        await recordUsage(db, extraction.usage, 'haiku')
        console.error('DEBUG existing.resume', JSON.stringify(existing?.resume))
        console.error('DEBUG isResumeEmpty', isResumeEmpty(existing?.resume ?? emptyResume()))
        if (isResumeEmpty(existing?.resume ?? emptyResume())) {
          resumeUpdate = extraction.resume
        } else {
          suggestedResume = extraction.resume
        }
      } catch (reason) {
        console.error('failed to extract structured resume from CV', reason)
      }
    } else {
      console.error('DEBUG skipped extraction, resumeExtractor=', Boolean(resumeExtractor))
    }

    const update: Record<string, unknown> = { cvText, updatedAt: new Date().toISOString() }
    if (resumeUpdate) update.resume = resumeUpdate

    const result = await profiles.findOneAndUpdate(
      { _id: profileId },
      { $set: update },
      { returnDocument: 'after', projection: { passwordHash: 0 } }
    )
    if (!result) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json({ ...result, suggestedResume })
  })

  return profileRoutes
}
