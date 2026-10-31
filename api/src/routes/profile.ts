import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import { ProfileUpdateSchema } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { parseCvFile, DOCX_MIME_TYPE, type CvParser } from '../profile/cvParser.js'

const MAX_CV_FILE_BYTES = 10 * 1024 * 1024

export function createProfileRoutes(db: Db, jwtSecret: string, cvParser: CvParser = parseCvFile) {
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

    const profiles = db.collection('profiles')
    const result = await profiles.findOneAndUpdate(
      { _id: new ObjectId(c.get('profileId')) },
      { $set: { cvText, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', projection: { passwordHash: 0 } }
    )
    if (!result) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json(result)
  })

  return profileRoutes
}
