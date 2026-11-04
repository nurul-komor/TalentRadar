import { ObjectId, type Db } from 'mongodb'
import type { Application, Approval, AutomationRun, Job, Materials, Profile } from '@job-hunter/shared'
import { recordRunResult, canSubmit } from '../applications/automationRunsService.js'
import { writeAuditLog } from '../applications/auditLog.js'
import { ForbiddenError, NotFoundError } from '../lib/errors.js'
import { launchBrowser } from './browser.js'
import { discoverForm } from './formDiscovery.js'
import { detectBlocker } from './blockerDetection.js'
import { fillForm } from './fillStrategy.js'

async function loadJobMaterialsAndProfile(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string },
  callerProfileId: string
): Promise<{ job: Job; materials: Materials; profile: Profile; jobId: string; application: Application }> {
  const jobId = `${jobKey.sourceId}:${jobKey.sourceJobId}`
  // Queried through the untyped collection (not db.collection<Job>) because
  // jobKey.sourceId is a plain string here, narrower than Job's sourceId
  // enum — same pattern applicationsService.createApplication already uses
  // for this exact lookup.
  const job = (await db.collection('jobs').findOne(jobKey)) as Job | null
  if (!job) {
    throw new NotFoundError(`job not found: ${jobId}`)
  }

  // Ownership lives on the Application, not the (shared, scraped) Job —
  // automation can only ever act on behalf of the profile that owns the
  // application for this job, never an arbitrary caller or "the" one
  // profile in the database (see architect review finding 1).
  const application = await db.collection<Application>('applications').findOne({ jobId })
  if (!application) {
    throw new NotFoundError(`no application exists for job ${jobId}`)
  }
  if (application.profileId !== callerProfileId) {
    throw new ForbiddenError(`caller does not own application ${jobId}`)
  }

  const latestMaterials = await db
    .collection<Materials>('materials')
    .find({ jobId })
    .sort({ version: -1 })
    .limit(1)
    .toArray()
  const materials = latestMaterials[0]
  if (!materials) {
    throw new NotFoundError(`no materials have been generated for job ${jobId}`)
  }

  const profile = (await db
    .collection('profiles')
    .findOne({ _id: new ObjectId(application.profileId) })) as Profile | null
  if (!profile) {
    throw new NotFoundError(`no profile exists for application owner ${application.profileId}`)
  }

  return { job, materials, profile, jobId, application }
}

export async function runAutomation(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string },
  callerProfileId: string
): Promise<AutomationRun> {
  const { job, materials, profile, jobId, application } = await loadJobMaterialsAndProfile(
    db,
    jobKey,
    callerProfileId
  )

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.goto(job.normalizedUrl, { waitUntil: 'domcontentloaded' })

    const blocker = await detectBlocker(page)
    if (blocker) {
      return await recordRunResult(db, jobId, {
        status: 'blocked',
        filledFields: null,
        blockReason: blocker,
        manualApplyUrl: job.normalizedUrl,
      })
    }

    const form = await discoverForm(page)
    const { filledFields, requiredAnswers } = await fillForm(page, form, profile, materials)

    const existingAnswers = new Map(
      application.requiredAnswers.map((a) => [a.question, a.answer])
    )
    const mergedAnswers = requiredAnswers.map((a) => ({
      question: a.question,
      answer: existingAnswers.get(a.question) ?? a.answer,
    }))

    await db.collection('applications').updateOne(
      { jobId },
      { $set: { requiredAnswers: mergedAnswers, updatedAt: new Date().toISOString() } }
    )

    return await recordRunResult(db, jobId, {
      status: 'filled',
      filledFields,
      blockReason: null,
      manualApplyUrl: null,
    })
  } finally {
    await browser.close()
  }
}

// The only place in the codebase a run (and its owning application) ever
// reaches 'submitted'/'failed' — both collections are updated together so
// the application's status is never left stranded at 'draft' once a real
// submission attempt has happened (architect review finding 3), and every
// outcome is recorded in the append-only audit log (finding 4), since this
// is the one function capable of an irreversible real-world action.
async function finalizeSubmission(
  db: Db,
  jobId: string,
  runNumber: number,
  status: 'submitted' | 'failed',
  actorProfileId: string
): Promise<AutomationRun> {
  const now = new Date().toISOString()
  await db.collection('automationRuns').updateOne(
    { jobId, runNumber },
    { $set: { status, updatedAt: now } }
  )
  await db.collection('applications').updateOne(
    { jobId },
    { $set: { status, updatedAt: now } }
  )
  await writeAuditLog(db, {
    action: status === 'submitted' ? 'application_submitted' : 'application_submission_failed',
    jobId,
    runNumber,
    actorProfileId,
    details: {},
  })

  const updated = await db.collection<AutomationRun>('automationRuns').findOne({ jobId, runNumber })
  if (!updated) {
    throw new NotFoundError(`run disappeared while updating status: ${jobId} run ${runNumber}`)
  }
  return updated
}

export async function submitApplication(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string },
  runNumber: number,
  callerProfileId: string
): Promise<AutomationRun> {
  const { job, materials, profile, jobId, application } = await loadJobMaterialsAndProfile(
    db,
    jobKey,
    callerProfileId
  )

  const run = await db.collection<AutomationRun>('automationRuns').findOne({ jobId, runNumber })
  const approval = await db.collection<Approval>('approvals').findOne({ jobId, runNumber })
  if (!run) {
    throw new NotFoundError(`no application or run found for ${jobId} run ${runNumber}`)
  }
  // Re-checks the M5a gate itself, independent of whatever the route layer
  // already verified — this is the one function capable of an irreversible
  // real-world action, so it must refuse on its own, from first principles,
  // every time it runs (defense in depth, still holds after finding 5's fix
  // to how/when approveRun persists its Approval record).
  if (!canSubmit(application, run, approval)) {
    throw new ForbiddenError(`run ${runNumber} for ${jobId} has not been approved for submission`)
  }

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.goto(job.normalizedUrl, { waitUntil: 'domcontentloaded' })

    const blocker = await detectBlocker(page)
    if (blocker) {
      return await finalizeSubmission(db, jobId, runNumber, 'failed', callerProfileId)
    }

    const form = await discoverForm(page)
    await fillForm(page, form, profile, materials)

    await page.locator('button[type=submit], input[type=submit]').first().click()
    await page.waitForLoadState('domcontentloaded')

    const confirmed = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase()
      return /thank you|application (received|submitted)|successfully applied/.test(text)
    })

    return await finalizeSubmission(
      db,
      jobId,
      runNumber,
      confirmed ? 'submitted' : 'failed',
      callerProfileId
    )
  } finally {
    await browser.close()
  }
}
