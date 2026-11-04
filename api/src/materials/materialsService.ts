import type { Db } from 'mongodb'
import type { Job, Materials, Profile } from '@job-hunter/shared'
import { isWithinBudget, recordUsage } from '../scoring/aiUsageService.js'
import { NotFoundError } from '../lib/errors.js'
import type { MaterialsGenerator } from './types'

export interface GenerateMaterialsResult {
  status: 'generated' | 'deferred'
  materials: Materials | null
  reason: string | null
}

export async function ensureMaterialsIndexes(db: Db): Promise<void> {
  await db.collection('materials').createIndex({ jobId: 1, version: 1 }, { unique: true })
}

export async function generateMaterials(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string },
  profile: Profile,
  profileId: string,
  generator: MaterialsGenerator
): Promise<GenerateMaterialsResult> {
  // `jobKey.sourceId` arrives as a plain string from the route layer (an unvalidated URL param),
  // while `Job['sourceId']` is narrowed to the `JobSourceId` enum — cast at the query boundary
  // rather than widening the stored type. A `sourceId` that isn't a real enum value simply won't
  // match any document, so this falls through to the "job not found" branch below, same as any
  // other unmatched key.
  const job = await db
    .collection<Job>('jobs')
    .findOne({ sourceId: jobKey.sourceId as Job['sourceId'], sourceJobId: jobKey.sourceJobId })
  if (!job) {
    throw new NotFoundError(`job not found: ${jobKey.sourceId}:${jobKey.sourceJobId}`)
  }

  if (!(await isWithinBudget(db))) {
    return { status: 'deferred', materials: null, reason: 'AI budget exceeded' }
  }

  const generation = await generator({ job, profile, requirements: job.extractedRequirements })
  await recordUsage(db, generation.usage, 'opus')

  const jobId = `${job.sourceId}:${job.sourceJobId}`
  const materialsCollection = db.collection<Materials>('materials')
  const latestVersions = await materialsCollection
    .find({ jobId })
    .sort({ version: -1 })
    .limit(1)
    .toArray()
  const nextVersion = (latestVersions[0]?.version ?? 0) + 1

  const materials: Materials = {
    jobId,
    profileId,
    version: nextVersion,
    unmetRequirements: generation.content.unmetRequirements,
    tailoredCv: generation.content.tailoredCv,
    coverLetter: generation.content.coverLetter,
    outreachMessage: generation.content.outreachMessage,
    createdAt: new Date().toISOString(),
  }
  await materialsCollection.insertOne(materials)

  return { status: 'generated', materials, reason: null }
}
