import type { TrackedJobStatus, TrackedJobLocationType } from '@job-hunter/shared'

// Pill color groups mirror the source spreadsheet: neutral for pre-apply, blue
// for in-motion, green for interview progress, amber for pending-on-you,
// teal/green for offers, red for terminal rejections. Each maps to a `.jt-pill`
// modifier defined in index.css.
type PillTone = 'gray' | 'blue' | 'green' | 'amber' | 'teal' | 'success' | 'red'

interface StatusMeta {
  status: TrackedJobStatus
  label: string
  tone: PillTone
}

// Ordered first-touch → terminal. This order defines the Kanban columns and the
// status dropdown.
export const STATUS_META: StatusMeta[] = [
  { status: 'not_applied', label: 'Not Applied', tone: 'gray' },
  { status: 'applied', label: 'Applied', tone: 'blue' },
  { status: 'recruiter_contacted', label: 'Recruiter Contacted', tone: 'green' },
  { status: 'follow_up_1', label: 'Follow-up 1', tone: 'amber' },
  { status: 'follow_up_2', label: 'Follow-up 2', tone: 'amber' },
  { status: 'response_received', label: 'Response Received', tone: 'blue' },
  { status: 'interview_scheduled', label: 'Interview Scheduled', tone: 'green' },
  { status: 'interview_completed', label: 'Interview Completed', tone: 'green' },
  { status: 'assessment_received', label: 'Assessment Received', tone: 'amber' },
  { status: 'assessment_submitted', label: 'Assessment Submitted', tone: 'amber' },
  { status: 'offer_received', label: 'Offer Received', tone: 'teal' },
  { status: 'offer_accepted', label: 'Offer Accepted', tone: 'success' },
  { status: 'offer_rejected', label: 'Offer Rejected', tone: 'red' },
  { status: 'rejected', label: 'Rejected', tone: 'red' },
]

const STATUS_BY_KEY = new Map(STATUS_META.map((meta) => [meta.status, meta]))

export function statusLabel(status: TrackedJobStatus): string {
  return STATUS_BY_KEY.get(status)?.label ?? status
}

export function statusPillClass(status: TrackedJobStatus): string {
  return `jt-pill ${STATUS_BY_KEY.get(status)?.tone ?? 'gray'}`
}

export const LOCATION_TYPE_LABELS: Record<TrackedJobLocationType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
}

export const LOCATION_TYPE_OPTIONS: TrackedJobLocationType[] = ['remote', 'hybrid', 'onsite']

// Renders a stored date string as a short date, passing through anything that
// isn't a parseable date (the field is free-form, like the spreadsheet).
export function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// A follow-up is overdue when its date is strictly before today and the job is
// still active (not a terminal outcome).
const TERMINAL: TrackedJobStatus[] = ['offer_accepted', 'offer_rejected', 'rejected']

export function isFollowUpOverdue(followUpDate: string | null, status: TrackedJobStatus): boolean {
  if (!followUpDate || TERMINAL.includes(status)) return false
  const date = new Date(followUpDate)
  if (Number.isNaN(date.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}
