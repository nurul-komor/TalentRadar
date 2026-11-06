import type { Db } from 'mongodb'
import type { Materials, Profile, SavedMaterials } from '@job-hunter/shared'
import { emptyResume } from '@job-hunter/shared'
import { isWithinBudget, recordUsage } from '../scoring/aiUsageService.js'
import { NotFoundError } from '../lib/errors.js'
import { upsertTrackedJobForMaterials } from '../jobTracking/jobTrackingService.js'
import { resolveJobForApply } from '../jobs/resolveJobForApply.js'
import type { MaterialsGenerator } from './types'

export interface GenerateMaterialsResult {
  status: 'generated' | 'deferred'
  materials: Materials | null
  reason: string | null
}

export async function ensureMaterialsIndexes(db: Db): Promise<void> {
  await db.collection('materials').createIndex({ jobId: 1, version: 1 }, { unique: true })
  // One saved record per user per job — saving again overwrites the prior one.
  await db.collection('savedMaterials').createIndex({ profileId: 1, jobId: 1 }, { unique: true })
}

// Persist the user's chosen cover letter / tailored CV for a job, keyed by
// (profileId, jobId). Fields that are undefined are left as-is on an existing
// record, so saving just the cover letter doesn't wipe a previously saved CV.
// This never mutates the user's base profile résumé.
export async function saveMaterials(
  db: Db,
  jobId: string,
  profileId: string,
  input: { coverLetter?: string; tailoredCv?: string }
): Promise<SavedMaterials> {
  const saved = db.collection<SavedMaterials>('savedMaterials')
  const updatedAt = new Date().toISOString()
  const set: Partial<SavedMaterials> = { updatedAt }
  if (input.coverLetter !== undefined) set.coverLetter = input.coverLetter
  if (input.tailoredCv !== undefined) set.tailoredCv = input.tailoredCv

  await saved.updateOne(
    { profileId, jobId },
    {
      $set: set,
      // Ensure both fields exist on first insert so the shape matches the schema.
      $setOnInsert: {
        profileId,
        jobId,
        ...(input.coverLetter === undefined ? { coverLetter: null } : {}),
        ...(input.tailoredCv === undefined ? { tailoredCv: null } : {}),
      },
    },
    { upsert: true }
  )

  const record = await saved.findOne({ profileId, jobId })
  // The upsert just ran, so a record is guaranteed; assert for the type system.
  return record as SavedMaterials
}

export async function getSavedMaterials(
  db: Db,
  jobId: string,
  profileId: string
): Promise<SavedMaterials | null> {
  return db.collection<SavedMaterials>('savedMaterials').findOne({ profileId, jobId })
}

// The role's required skills the candidate's profile doesn't already list,
// compared case-insensitively. This is the "skill gap" snapshot for a job, and
// the explicit list handed to the generator so those skills reliably land in the
// résumé's Skills section.
export function computeMissingSkills(profile: Profile, requiredSkills: string[]): string[] {
  const held = new Set(
    (profile.resume ?? emptyResume()).skillGroups
      .flatMap((group) => group.skills)
      .map((skill) => skill.trim().toLowerCase())
  )
  const seen = new Set<string>()
  const missing: string[] = []
  for (const skill of requiredSkills) {
    const key = skill.trim().toLowerCase()
    if (!key || held.has(key) || seen.has(key)) continue
    seen.add(key)
    missing.push(skill.trim())
  }
  return missing
}

export async function generateMaterials(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string },
  profile: Profile,
  profileId: string,
  generator: MaterialsGenerator
): Promise<GenerateMaterialsResult> {
  // Resolves a discovered job (shared `jobs` collection) or a user-added job
  // (`userJobs`, scoped to this profile via the `userJob:<id>` jobId scheme) into
  // the common apply shape — see resolveJobForApply.
  const job = await resolveJobForApply(db, jobKey.sourceId, jobKey.sourceJobId, profileId)
  if (!job) {
    throw new NotFoundError(`job not found: ${jobKey.sourceId}:${jobKey.sourceJobId}`)
  }

  if (!(await isWithinBudget(db))) {
    return { status: 'deferred', materials: null, reason: 'AI budget exceeded' }
  }

  const generation = await generator({ job, profile, requirements: job.extractedRequirements })
  await recordUsage(db, generation.usage, generation.model)

  // Snapshot the role's skill gap so it can be reviewed later, saved per job on
  // the materials record below. This is a read-only diff: generating materials
  // never mutates the candidate's master profile résumé — the missing skills
  // surface only in the per-job tailored CV (via the prompt) and this snapshot.
  const missingSkills = computeMissingSkills(profile, job.extractedRequirements?.requiredSkills ?? [])

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
    missingSkills,
    tailoredCv: generation.content.tailoredCv,
    coverLetter: generation.content.coverLetter,
    outreachMessage: generation.content.outreachMessage,
    createdAt: new Date().toISOString(),
  }
  await materialsCollection.insertOne(materials)

  // Surface the application in the tracker at "not applied" so generating docs
  // and tracking the application are one step. Idempotent — regenerating never
  // resets a row the user has already advanced.
  await upsertTrackedJobForMaterials(db, profileId, jobId, job.company, job.title)

  return { status: 'generated', materials, reason: null }
}
