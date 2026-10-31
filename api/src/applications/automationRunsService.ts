import type { Db } from 'mongodb'
import type { Application, Approval, AutomationRun } from '@job-hunter/shared'
import { writeAuditLog } from './auditLog.js'
import { ForbiddenError, NotFoundError } from '../lib/errors.js'

export async function ensureAutomationRunIndexes(db: Db): Promise<void> {
  await db.collection('automationRuns').createIndex({ jobId: 1, runNumber: 1 }, { unique: true })
  await db.collection('approvals').createIndex({ jobId: 1, runNumber: 1 }, { unique: true })
}

export interface RunResultInput {
  status: 'filled' | 'blocked'
  filledFields: Record<string, string> | null
  blockReason: string | null
  manualApplyUrl: string | null
}

export async function recordRunResult(
  db: Db,
  jobId: string,
  result: RunResultInput
): Promise<AutomationRun> {
  const runs = db.collection<AutomationRun>('automationRuns')
  const latest = await runs.find({ jobId }).sort({ runNumber: -1 }).limit(1).toArray()
  const runNumber = (latest[0]?.runNumber ?? 0) + 1

  const now = new Date().toISOString()
  const resolvedStatus = result.status === 'filled' ? 'ready_for_approval' : 'blocked'
  const run: AutomationRun = {
    jobId,
    runNumber,
    status: resolvedStatus,
    filledFields: result.filledFields,
    blockReason: result.blockReason,
    manualApplyUrl: result.manualApplyUrl,
    createdAt: now,
    updatedAt: now,
  }
  await runs.insertOne(run)
  await writeAuditLog(db, {
    action: 'automation_run_recorded',
    jobId,
    runNumber,
    actorProfileId: null,
    details: { status: resolvedStatus },
  })

  return run
}

export function canSubmit(
  application: Application,
  run: AutomationRun,
  approval: Approval | null
): boolean {
  if (!approval) return false
  if (approval.jobId !== run.jobId || approval.runNumber !== run.runNumber) return false
  if (run.status !== 'ready_for_approval' && run.status !== 'approved') return false
  if (application.requiredAnswers.some((answer) => answer.answer === null)) return false
  return true
}

export async function approveRun(
  db: Db,
  jobId: string,
  runNumber: number,
  actorProfileId: string
): Promise<{ approved: boolean; reason: string | null }> {
  const applications = db.collection<Application>('applications')
  const runs = db.collection<AutomationRun>('automationRuns')
  const approvals = db.collection<Approval>('approvals')

  const application = await applications.findOne({ jobId })
  const run = await runs.findOne({ jobId, runNumber })
  if (!application || !run) {
    throw new NotFoundError(`no application or run found for ${jobId} run ${runNumber}`)
  }
  if (application.profileId !== actorProfileId) {
    throw new ForbiddenError(`caller does not own application ${jobId}`)
  }

  const existingApproval = await approvals.findOne({ jobId, runNumber })
  const candidateApproval: Approval =
    existingApproval ?? {
      jobId,
      runNumber,
      approvedBy: actorProfileId,
      approvedAt: new Date().toISOString(),
    }

  // Gate the Approval record's persistence on the exact same check that
  // gates the run's status flip below — a premature approve click that
  // fails this check must not leave a durable Approval record lying
  // around that a later, unrelated change to requiredAnswers could then
  // silently satisfy without the user re-confirming the current state.
  const ready = canSubmit(application, run, candidateApproval)
  if (!ready) {
    return { approved: false, reason: 'required answers are unresolved or the run is not ready' }
  }

  if (!existingApproval) {
    await approvals.insertOne(candidateApproval)
  }

  await runs.updateOne(
    { jobId, runNumber },
    { $set: { status: 'approved', updatedAt: new Date().toISOString() } }
  )
  await writeAuditLog(db, {
    action: 'run_approved',
    jobId,
    runNumber,
    actorProfileId,
    details: {},
  })

  return { approved: true, reason: null }
}
