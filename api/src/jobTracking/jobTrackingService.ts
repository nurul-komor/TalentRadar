import { ObjectId, type Db } from 'mongodb'
import type { TrackedJob, TrackedJobInput, TrackedJobUpdate, TrackedJobSourceRef } from '@job-hunter/shared'

const COLLECTION = 'jobTracking'

export async function ensureJobTrackingIndexes(db: Db): Promise<void> {
  // Board + table views both query by owner; status/order drive column grouping
  // and ordering. createdAt gives a stable fallback sort for the table.
  await db.collection(COLLECTION).createIndex({ profileId: 1, status: 1, order: 1 })
  await db.collection(COLLECTION).createIndex({ profileId: 1, createdAt: -1 })
}

// New cards land at the top of their column. Ordering is a single global counter
// per profile (lower = earlier); using a negative "now" keeps inserts cheap
// without reading the column first, and drag reordering rewrites it anyway.
function nextOrder(): number {
  return -Date.now()
}

export async function listTrackedJobs(db: Db, profileId: string): Promise<TrackedJob[]> {
  const docs = await db
    .collection(COLLECTION)
    .find({ profileId })
    .sort({ order: 1, createdAt: -1 })
    .toArray()
  return docs.map((doc) => ({ ...doc, _id: doc._id.toString() })) as unknown as TrackedJob[]
}

export async function createTrackedJob(
  db: Db,
  profileId: string,
  input: TrackedJobInput,
  sourceRef: TrackedJobSourceRef | null = null,
  materialsJobId: string | null = null
): Promise<TrackedJob> {
  const now = new Date().toISOString()
  const doc: Omit<TrackedJob, '_id'> = {
    profileId,
    company: input.company,
    position: input.position,
    jobUrl: input.jobUrl ?? null,
    appliedDate: input.appliedDate ?? null,
    salary: input.salary ?? null,
    contactPerson: input.contactPerson ?? null,
    contactUrl: input.contactUrl ?? null,
    location: input.location ?? null,
    locationType: input.locationType ?? null,
    status: input.status ?? 'not_applied',
    followUpDate: input.followUpDate ?? null,
    notes: input.notes ?? null,
    sourceRef,
    materialsJobId,
    order: nextOrder(),
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection(COLLECTION).insertOne(doc as Record<string, unknown>)
  return { ...doc, _id: result.insertedId.toString() }
}

// Called when materials (tailored CV + cover letter) are generated for a job.
// Ensures the application appears in the tracker without ever clobbering a row the
// user has already been managing: if one already links to this materialsJobId,
// it's left untouched (status, notes, and all); otherwise a fresh "not applied"
// row is created and linked. Idempotent across regenerations.
export async function upsertTrackedJobForMaterials(
  db: Db,
  profileId: string,
  materialsJobId: string,
  company: string,
  position: string
): Promise<void> {
  const existing = await db.collection(COLLECTION).findOne({ profileId, materialsJobId })
  if (existing) return
  await createTrackedJob(
    db,
    profileId,
    { company, position, status: 'not_applied' },
    null,
    materialsJobId
  )
}

// Partial update scoped to the owner. Returns null for a missing/invalid id or a
// row owned by someone else, so callers can't probe another user's tracker.
export async function updateTrackedJob(
  db: Db,
  profileId: string,
  id: string,
  update: TrackedJobUpdate
): Promise<TrackedJob | null> {
  if (!ObjectId.isValid(id)) return null
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(id), profileId },
    { $set: { ...update, updatedAt: new Date().toISOString() } },
    { returnDocument: 'after' }
  )
  if (!result) return null
  return { ...result, _id: result._id.toString() } as unknown as TrackedJob
}

export async function deleteTrackedJob(db: Db, profileId: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false
  const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id), profileId })
  return result.deletedCount > 0
}

// Pre-filled fields resolved from an existing record for the import flow.
export interface ImportPrefill {
  company: string
  position: string
  jobUrl: string | null
  salary: string | null
  location: string | null
  locationType: TrackedJob['locationType']
  // The materials key for this source, when it can have generated docs.
  materialsJobId: string | null
}

function formatSalary(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return `${min.toLocaleString()} – ${max.toLocaleString()}`
  if (min != null) return `From ${min.toLocaleString()}`
  if (max != null) return `Up to ${max.toLocaleString()}`
  return null
}

// Resolve a `job`, `userJob`, or `application` the caller owns into tracker
// pre-fill fields. Returns null when the record is missing, invalid, or not the
// caller's — the route turns that into a 404.
export async function resolveImportPrefill(
  db: Db,
  profileId: string,
  kind: 'job' | 'userJob' | 'application',
  id: string
): Promise<ImportPrefill | null> {
  // application rows are keyed by a string jobId (not an ObjectId), so only the
  // job/userJob lookups need a valid ObjectId.
  if (kind !== 'application' && !ObjectId.isValid(id)) return null

  if (kind === 'userJob') {
    const doc = await db.collection('userJobs').findOne({ _id: new ObjectId(id), profileId })
    if (!doc) return null
    return {
      company: String(doc.company ?? ''),
      position: String(doc.title ?? ''),
      jobUrl: (doc.url as string | null) ?? null,
      salary: formatSalary((doc.salaryMin as number | null) ?? null, (doc.salaryMax as number | null) ?? null),
      location: (doc.location as string | null) ?? null,
      locationType: null,
      // User-added jobs aren't eligible for the materials generator (which keys
      // off discovered jobs), so there are no docs to link.
      materialsJobId: null,
    }
  }

  if (kind === 'job') {
    // Discovered jobs aren't profile-owned, but they're globally readable in the
    // app, so importing one into a private tracker is fine.
    const doc = await db.collection('jobs').findOne({ _id: new ObjectId(id) })
    if (!doc) return null
    const remoteType = (doc.extractedRequirements as { remoteType?: string } | null)?.remoteType
    const locationType =
      remoteType === 'fully_remote'
        ? 'remote'
        : remoteType === 'hybrid'
          ? 'hybrid'
          : remoteType === 'onsite'
            ? 'onsite'
            : null
    const materialsJobId =
      doc.sourceId && doc.sourceJobId ? `${String(doc.sourceId)}:${String(doc.sourceJobId)}` : null
    return {
      company: String(doc.company ?? ''),
      position: String(doc.title ?? ''),
      jobUrl: (doc.normalizedUrl as string | null) ?? null,
      salary: formatSalary((doc.salaryMin as number | null) ?? null, (doc.salaryMax as number | null) ?? null),
      location: (doc.location as string | null) ?? null,
      locationType,
      materialsJobId,
    }
  }

  // application — keyed by jobId + profileId (string jobId, not ObjectId). That
  // jobId is exactly the materials key, so any generated docs link straight in.
  const doc = await db.collection('applications').findOne({ profileId, jobId: id })
  if (!doc) return null
  return {
    company: String(doc.company ?? ''),
    position: String(doc.title ?? ''),
    jobUrl: null,
    salary: null,
    location: null,
    locationType: null,
    materialsJobId: id,
  }
}
