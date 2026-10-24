import { z } from 'zod'

export const JobSourceIdSchema = z.enum(['remoteok', 'weworkremotely', 'himalayas'])

export const JobStatusSchema = z.enum(['discovered', 'verified', 'rejected'])

export const JobSchema = z.object({
  _id: z.string().optional(),
  sourceId: JobSourceIdSchema,
  sourceJobId: z.string(),
  normalizedUrl: z.string(),
  title: z.string(),
  company: z.string(),
  rawDescription: z.string(),
  location: z.string().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  postedAt: z.string().nullable(),
  status: JobStatusSchema,
  discoveredAt: z.string(),
  updatedAt: z.string(),
  verifiedAt: z.string().nullable(),
  verificationEvidence: z.string().nullable(),
})

export type JobSourceId = z.infer<typeof JobSourceIdSchema>
export type JobStatus = z.infer<typeof JobStatusSchema>
export type Job = z.infer<typeof JobSchema>
