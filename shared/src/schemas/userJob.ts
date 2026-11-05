import { z } from 'zod'

// Jobs a user adds themselves — either typed in manually or synced from a pasted
// URL. These are kept entirely separate from the global discovery `jobs`
// collection (which has a fixed source enum and feeds scoring/verification);
// a userJob is owned by one profile and its private/public visibility is the
// owner's to manage.
export const UserJobVisibilitySchema = z.enum(['private', 'public'])

export const UserJobSchema = z.object({
  _id: z.string().optional(),
  profileId: z.string(),
  title: z.string(),
  company: z.string(),
  description: z.string(),
  location: z.string().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  url: z.string().nullable(),
  visibility: UserJobVisibilitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

// Payload for saving a job (from the manual form or an edited sync preview).
// New jobs default to private; the owner flips them public later if they choose.
export const UserJobInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.'),
  company: z.string().trim().min(1, 'Company is required.'),
  description: z.string().default(''),
  location: z.string().nullable().optional(),
  salaryMin: z.number().nullable().optional(),
  salaryMax: z.number().nullable().optional(),
  url: z.string().url().nullable().optional(),
  visibility: UserJobVisibilitySchema.default('private'),
})

// Partial update — today only the visibility toggle is exposed, but the shape
// leaves room to edit saved fields later.
export const UserJobUpdateSchema = z
  .object({
    visibility: UserJobVisibilitySchema.optional(),
  })
  .refine((value) => value.visibility !== undefined, {
    message: 'Nothing to update.',
  })

// The not-yet-saved result of syncing a URL. Same shape as a saved job minus
// ownership/persistence fields, so the form can bind to it directly.
export const UserJobPreviewSchema = z.object({
  title: z.string(),
  company: z.string(),
  description: z.string(),
  location: z.string().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  url: z.string(),
})

export type UserJobVisibility = z.infer<typeof UserJobVisibilitySchema>
export type UserJob = z.infer<typeof UserJobSchema>
export type UserJobInput = z.infer<typeof UserJobInputSchema>
export type UserJobUpdate = z.infer<typeof UserJobUpdateSchema>
export type UserJobPreview = z.infer<typeof UserJobPreviewSchema>
