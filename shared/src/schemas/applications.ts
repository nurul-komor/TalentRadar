import { z } from 'zod'

export const RequiredAnswerSchema = z.object({
  question: z.string(),
  answer: z.string().nullable(),
})

export const ApplicationStatusSchema = z.enum(['draft', 'ready', 'submitted', 'failed'])

export const ApplicationSchema = z.object({
  _id: z.string().optional(),
  jobId: z.string(),
  profileId: z.string(),
  company: z.string(),
  title: z.string(),
  status: ApplicationStatusSchema,
  materialsVersion: z.number().int().positive().nullable(),
  requiredAnswers: z.array(RequiredAnswerSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const AutomationRunStatusSchema = z.enum([
  'claimed',
  'filled',
  'blocked',
  'ready_for_approval',
  'approved',
  'submitted',
  'failed',
])

export const AutomationRunSchema = z.object({
  _id: z.string().optional(),
  jobId: z.string(),
  runNumber: z.number().int().positive(),
  status: AutomationRunStatusSchema,
  filledFields: z.record(z.string(), z.string()).nullable(),
  blockReason: z.string().nullable(),
  manualApplyUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ApprovalSchema = z.object({
  _id: z.string().optional(),
  jobId: z.string(),
  runNumber: z.number().int().positive(),
  approvedBy: z.string(),
  approvedAt: z.string(),
})

export type RequiredAnswer = z.infer<typeof RequiredAnswerSchema>
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>
export type Application = z.infer<typeof ApplicationSchema>
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>
export type AutomationRun = z.infer<typeof AutomationRunSchema>
export type Approval = z.infer<typeof ApprovalSchema>
