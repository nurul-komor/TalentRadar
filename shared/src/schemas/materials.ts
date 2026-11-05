import { z } from 'zod'

export const GeneratedContentSchema = z.object({
  unmetRequirements: z.array(z.string()),
  tailoredCv: z.string(),
  coverLetter: z.string(),
  outreachMessage: z.string(),
})

export const MaterialsSchema = GeneratedContentSchema.extend({
  _id: z.string().optional(),
  jobId: z.string(),
  profileId: z.string(),
  version: z.number().int().positive(),
  // Snapshot (taken at generation time) of the role's required skills the
  // candidate's profile didn't yet have. Persisted so the gap list survives for
  // later review even after those skills get added to the profile. Older records
  // predate this field, hence the default.
  missingSkills: z.array(z.string()).default([]),
  createdAt: z.string(),
})

// A document the user explicitly chose to keep for a job. Unlike `Materials`
// (the versioned generation history), there is at most one saved record per
// (profileId, jobId): saving again overwrites it. The base profile résumé
// (`profiles.resume`) is never touched — a tailored résumé/cover letter lives
// only here, attached to the specific job post and the user who saved it.
export const SavedMaterialsSchema = z.object({
  _id: z.string().optional(),
  jobId: z.string(),
  profileId: z.string(),
  coverLetter: z.string().nullable(),
  tailoredCv: z.string().nullable(),
  updatedAt: z.string(),
})

// Save payload: at least one document must be present. Fields left out are
// preserved from the existing saved record rather than cleared.
export const SaveMaterialsInputSchema = z
  .object({
    coverLetter: z.string().min(1).optional(),
    tailoredCv: z.string().min(1).optional(),
  })
  .refine((value) => value.coverLetter !== undefined || value.tailoredCv !== undefined, {
    message: 'Provide a cover letter or a tailored CV to save.',
  })

export type GeneratedContent = z.infer<typeof GeneratedContentSchema>
export type Materials = z.infer<typeof MaterialsSchema>
export type SavedMaterials = z.infer<typeof SavedMaterialsSchema>
export type SaveMaterialsInput = z.infer<typeof SaveMaterialsInputSchema>
