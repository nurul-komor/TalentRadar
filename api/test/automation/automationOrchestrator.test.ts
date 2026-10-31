import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { ensureApplicationIndexes } from '../../src/applications/applicationsService'
import { ensureAutomationRunIndexes } from '../../src/applications/automationRunsService'
import { approveRun } from '../../src/applications/automationRunsService'
import { runAutomation, submitApplication } from '../../src/automation/automationOrchestrator'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const MOCK_FORM_HTML = `
<form>
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />
  <label for="name-field">Full name</label>
  <input type="text" id="name-field" />
  <label for="cover-field">Cover Letter</label>
  <textarea id="cover-field"></textarea>
</form>
`

const MOCK_CAPTCHA_HTML = `<div class="g-recaptcha"></div><form></form>`

const MOCK_FORM_WITH_SUBMIT_HTML = `
<form id="application-form">
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />
  <button type="submit" onclick="event.preventDefault(); document.body.innerHTML = '<h1>Thank you! Your application has been received.</h1>'">Submit</button>
</form>
`

const MOCK_FORM_NO_CONFIRMATION_HTML = `
<form id="application-form">
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />
  <button type="submit" onclick="event.preventDefault(); document.body.innerHTML = '<p>An error occurred.</p>'">Submit</button>
</form>
`

function dataUrl(html: string): string {
  return 'data:text/html,' + encodeURIComponent(html)
}

async function insertJob(db: Db, normalizedUrl: string) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId: '1',
    normalizedUrl,
    title: 'Backend Engineer',
    company: 'Acme',
    rawDescription: 'desc',
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: null,
    status: 'verified',
    discoveredAt: now,
    updatedAt: now,
    verifiedAt: now,
    verificationEvidence: 'apply now',
    contentHash: null,
    extractedRequirements: null,
    extractedAt: null,
    score: null,
    scoreBreakdown: null,
    scoredAt: null,
  })
}

async function insertMaterials(db: Db) {
  await db.collection('materials').insertOne({
    jobId: 'remoteok:1',
    version: 1,
    unmetRequirements: [],
    tailoredCv: 'Tailored CV text.',
    coverLetter: 'This is my cover letter.',
    outreachMessage: 'Outreach text.',
    createdAt: new Date().toISOString(),
  })
}

async function insertProfile(db: Db): Promise<string> {
  const result = await db.collection('profiles').insertOne({
    email: 'candidate@example.com',
    eligibility: { workAuthorization: 'citizen', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: 'Experienced engineer.',
  })
  return result.insertedId.toString()
}

async function insertApplication(db: Db, profileId: string) {
  const now = new Date().toISOString()
  await db.collection('applications').insertOne({
    jobId: 'remoteok:1',
    profileId,
    company: 'Acme',
    title: 'Backend Engineer',
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: now,
    updatedAt: now,
  })
}

describe('runAutomation', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
  })

  afterAll(async () => {
    await mongod.stop()
  })

  beforeEach(async () => {
    const conn = await connectMongo(mongod.getUri(), uniqueDbName())
    client = conn.client
    db = conn.db
    await ensureApplicationIndexes(db)
    await ensureAutomationRunIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('fills the form, records a ready_for_approval run, and merges required answers onto the application', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_HTML))
    await insertMaterials(db)
    const profileId = await insertProfile(db)
    await insertApplication(db, profileId)

    const run = await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' }, profileId)

    expect(run.status).toBe('ready_for_approval')
    expect(run.filledFields?.['Email address']).toBe('candidate@example.com')

    const application = await db.collection('applications').findOne({ jobId: 'remoteok:1' })
    const questions = (application?.requiredAnswers as Array<{ question: string }>).map(
      (a) => a.question
    )
    expect(questions).toContain('Full name')
  })

  it('records a blocked run with a manual apply link when a captcha is detected', async () => {
    await insertJob(db, dataUrl(MOCK_CAPTCHA_HTML))
    await insertMaterials(db)
    const profileId = await insertProfile(db)
    await insertApplication(db, profileId)

    const run = await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' }, profileId)

    expect(run.status).toBe('blocked')
    expect(run.blockReason).toBe('captcha')
    expect(run.manualApplyUrl).toBe(dataUrl(MOCK_CAPTCHA_HTML))
  })

  it('preserves an existing non-null answer across a second run for the same question', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_HTML))
    await insertMaterials(db)
    const profileId = await insertProfile(db)
    await insertApplication(db, profileId)

    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' }, profileId)
    await db.collection('applications').updateOne(
      { jobId: 'remoteok:1', 'requiredAnswers.question': 'Full name' },
      { $set: { 'requiredAnswers.$.answer': 'Jane Doe' } }
    )

    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' }, profileId)

    const application = await db.collection('applications').findOne({ jobId: 'remoteok:1' })
    const nameAnswer = (
      application?.requiredAnswers as Array<{ question: string; answer: string | null }>
    ).find((a) => a.question === 'Full name')
    expect(nameAnswer?.answer).toBe('Jane Doe')
  })

  it('throws when no materials have been generated for the job', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_HTML))
    const profileId = await insertProfile(db)
    await insertApplication(db, profileId)

    await expect(
      runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' }, profileId)
    ).rejects.toThrow('no materials')
  })
})

describe('submitApplication', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
  })

  afterAll(async () => {
    await mongod.stop()
  })

  beforeEach(async () => {
    const conn = await connectMongo(mongod.getUri(), uniqueDbName())
    client = conn.client
    db = conn.db
    await ensureApplicationIndexes(db)
    await ensureAutomationRunIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('throws when the run has not been approved', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_WITH_SUBMIT_HTML))
    await insertMaterials(db)
    const profileId = await insertProfile(db)
    await insertApplication(db, profileId)
    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' }, profileId)

    await expect(
      submitApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 1, profileId)
    ).rejects.toThrow('not been approved')
  })

  it('reports submitted when the destination page shows a real confirmation', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_WITH_SUBMIT_HTML))
    await insertMaterials(db)
    const profileId = await insertProfile(db)
    await insertApplication(db, profileId)
    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' }, profileId)
    await approveRun(db, 'remoteok:1', 1, profileId)

    const run = await submitApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 1, profileId)

    expect(run.status).toBe('submitted')
  })

  it('reports failed when the destination page shows no confirmation language', async () => {
    await insertJob(db, dataUrl(MOCK_FORM_NO_CONFIRMATION_HTML))
    await insertMaterials(db)
    const profileId = await insertProfile(db)
    await insertApplication(db, profileId)
    await runAutomation(db, { sourceId: 'remoteok', sourceJobId: '1' }, profileId)
    await approveRun(db, 'remoteok:1', 1, profileId)

    const run = await submitApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 1, profileId)

    expect(run.status).toBe('failed')
  })

  it('throws when the job, run, or application cannot all be found', async () => {
    await expect(
      submitApplication(db, { sourceId: 'remoteok', sourceJobId: 'missing' }, 1, 'profile-1')
    ).rejects.toThrow()
  })
})
