import { z } from 'zod'

// A manually-managed job application tracker — a lightweight CRM a user keeps as
// they move an application from first contact through to an offer or rejection.
// Deliberately separate from the `applications` collection (which drives AI
// material generation + automated apply): a tracked job is free-form, owned by
// one profile, and its stage is whatever the user sets by hand.

// The application pipeline, ordered from first touch to a terminal outcome. These
// double as the Kanban columns, in this order.
export const TrackedJobStatusSchema = z.enum([
  'not_applied',
  'applied',
  'recruiter_contacted',
  'follow_up_1',
  'follow_up_2',
  'response_received',
  'interview_scheduled',
  'interview_completed',
  'assessment_received',
  'assessment_submitted',
  'offer_received',
  'offer_accepted',
  'offer_rejected',
  'rejected',
])

export const TrackedJobLocationTypeSchema = z.enum(['remote', 'hybrid', 'onsite'])

// Where an imported tracked job originated, so edits can trace back to the source
// record. Set only when created via import; manual entries leave it null.
export const TrackedJobSourceRefSchema = z.object({
  kind: z.enum(['job', 'userJob', 'application']),
  id: z.string(),
})

export const TrackedJobSchema = z.object({
  _id: z.string().optional(),
  profileId: z.string(),
  company: z.string(),
  position: z.string(),
  jobUrl: z.string().nullable(),
  // Dates are stored as free-form strings (ISO or whatever the user types) so the
  // tracker stays as forgiving as the spreadsheet it replaces.
  appliedDate: z.string().nullable(),
  salary: z.string().nullable(),
  contactPerson: z.string().nullable(),
  contactUrl: z.string().nullable(),
  location: z.string().nullable(),
  locationType: TrackedJobLocationTypeSchema.nullable(),
  status: TrackedJobStatusSchema,
  followUpDate: z.string().nullable(),
  notes: z.string().nullable(),
  sourceRef: TrackedJobSourceRefSchema.nullable(),
  // When set, the jobId (`sourceId:sourceJobId`) whose generated materials —
  // tailored CV + cover letter — belong to this application. Populated when the
  // row is auto-created from a résumé generation, or imported from a job/
  // application that has materials. The edit drawer reads it to show the docs.
  materialsJobId: z.string().nullable(),
  // Ordering within a status column on the board (lower sorts first).
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// Create payload. Only company + position are required; everything else is
// optional and defaults to empty/null so a row can be jotted down fast.
export const TrackedJobInputSchema = z.object({
  company: z.string().trim().min(1, 'Company is required.'),
  position: z.string().trim().min(1, 'Position is required.'),
  jobUrl: z.string().trim().url('Enter a valid URL.').nullable().optional(),
  appliedDate: z.string().nullable().optional(),
  salary: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  contactUrl: z.string().trim().url('Enter a valid URL.').nullable().optional(),
  location: z.string().nullable().optional(),
  locationType: TrackedJobLocationTypeSchema.nullable().optional(),
  status: TrackedJobStatusSchema.default('not_applied'),
  followUpDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

// Partial update — any subset of the editable fields. `.refine` rejects an empty
// body so a no-op PATCH is a 400 rather than a silent write.
export const TrackedJobUpdateSchema = TrackedJobInputSchema.partial()
  .extend({ order: z.number().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' })

// Import payload — pull an existing discovered job, user-added job, or application
// into the tracker by reference. The server resolves the record and pre-fills.
export const TrackedJobImportSchema = z.object({
  kind: z.enum(['job', 'userJob', 'application']),
  id: z.string().trim().min(1, 'An id is required.'),
})

export type TrackedJobStatus = z.infer<typeof TrackedJobStatusSchema>
export type TrackedJobLocationType = z.infer<typeof TrackedJobLocationTypeSchema>
export type TrackedJobSourceRef = z.infer<typeof TrackedJobSourceRefSchema>
export type TrackedJob = z.infer<typeof TrackedJobSchema>
export type TrackedJobInput = z.infer<typeof TrackedJobInputSchema>
export type TrackedJobUpdate = z.infer<typeof TrackedJobUpdateSchema>
export type TrackedJobImport = z.infer<typeof TrackedJobImportSchema>
