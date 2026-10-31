import { z } from 'zod'

export const JobSourceIdSchema = z.enum(['remoteok', 'weworkremotely', 'himalayas'])

export const JobStatusSchema = z.enum(['discovered', 'verified', 'rejected'])

export const JobRequirementsSchema = z.object({
  requiredSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  minExperienceYears: z.number().int().nonnegative().nullable(),
  workAuthRequirement: z.enum(['any', 'citizen_only', 'visa_sponsorship_available', 'unknown']),
  remoteType: z.enum(['fully_remote', 'hybrid', 'onsite', 'unknown']),
})

export const ScoreBreakdownSchema = z.object({
  workAuthFit: z.number().int(),
  remoteFit: z.number().int(),
  salaryFit: z.number().int(),
  skillMatch: z.number().int(),
  locationFit: z.number().int(),
})

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
  contentHash: z.string().nullable(),
  extractedRequirements: JobRequirementsSchema.nullable(),
  extractedAt: z.string().nullable(),
  score: z.number().int().min(0).max(100).nullable(),
  scoreBreakdown: ScoreBreakdownSchema.nullable(),
  scoredAt: z.string().nullable(),
})

export const PublicFeaturedJobSchema = z.object({
  _id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  sourceId: JobSourceIdSchema,
  postedAt: z.string().nullable(),
  discoveredAt: z.string(),
})

export const PublicSourceSummarySchema = z.object({
  sourceId: JobSourceIdSchema,
  count: z.number().int().nonnegative(),
})

export const PublicJobsSummarySchema = z.object({
  totalJobs: z.number().int().nonnegative(),
  bySource: z.array(PublicSourceSummarySchema),
  featuredJobs: z.array(PublicFeaturedJobSchema),
})

export type JobSourceId = z.infer<typeof JobSourceIdSchema>
export type JobStatus = z.infer<typeof JobStatusSchema>
export type JobRequirements = z.infer<typeof JobRequirementsSchema>
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>
export type Job = z.infer<typeof JobSchema>
export type PublicFeaturedJob = z.infer<typeof PublicFeaturedJobSchema>
export type PublicSourceSummary = z.infer<typeof PublicSourceSummarySchema>
export type PublicJobsSummary = z.infer<typeof PublicJobsSummarySchema>
