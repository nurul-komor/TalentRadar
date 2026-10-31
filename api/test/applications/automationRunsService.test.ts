import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import {
  approveRun,
  canSubmit,
  ensureAutomationRunIndexes,
  recordRunResult,
} from '../../src/applications/automationRunsService'
import { ensureApplicationIndexes } from '../../src/applications/applicationsService'
import type { Application, AutomationRun, Approval } from '@job-hunter/shared'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function baseApplication(overrides: Partial<Application> = {}): Application {
  const now = new Date().toISOString()
  return {
    jobId: 'remoteok:1',
    profileId: 'profile-1',
    company: 'Acme',
    title: 'Backend Engineer',
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function baseRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  const now = new Date().toISOString()
  return {
    jobId: 'remoteok:1',
    runNumber: 1,
    status: 'ready_for_approval',
    filledFields: { name: 'Jane Doe' },
    blockReason: null,
    manualApplyUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('recordRunResult', () => {
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
    await ensureAutomationRunIndexes(db)
    await ensureApplicationIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('creates run number 1 as ready_for_approval when the fields were filled', async () => {
    const run = await recordRunResult(db, 'remoteok:1', {
      status: 'filled',
      filledFields: { name: 'Jane Doe' },
      blockReason: null,
      manualApplyUrl: null,
    })

    expect(run.runNumber).toBe(1)
    expect(run.status).toBe('ready_for_approval')
  })

  it('creates a run as blocked with a reason when the fill was blocked', async () => {
    const run = await recordRunResult(db, 'remoteok:1', {
      status: 'blocked',
      filledFields: null,
      blockReason: 'captcha',
      manualApplyUrl: 'https://remoteok.com/remote-jobs/1',
    })

    expect(run.status).toBe('blocked')
    expect(run.blockReason).toBe('captcha')
    expect(run.manualApplyUrl).toBe('https://remoteok.com/remote-jobs/1')
  })

  it('increments the run number on a second call for the same job', async () => {
    await recordRunResult(db, 'remoteok:1', {
      status: 'blocked',
      filledFields: null,
      blockReason: 'captcha',
      manualApplyUrl: null,
    })
    const second = await recordRunResult(db, 'remoteok:1', {
      status: 'filled',
      filledFields: { name: 'Jane Doe' },
      blockReason: null,
      manualApplyUrl: null,
    })

    expect(second.runNumber).toBe(2)
  })
})

describe('canSubmit', () => {
  it('returns false with no approval', () => {
    expect(canSubmit(baseApplication(), baseRun(), null)).toBe(false)
  })

  it('returns false when the approval is for a different run', () => {
    const approval: Approval = {
      jobId: 'remoteok:1',
      runNumber: 2,
      approvedBy: 'profile-1',
      approvedAt: new Date().toISOString(),
    }
    expect(canSubmit(baseApplication(), baseRun({ runNumber: 1 }), approval)).toBe(false)
  })

  it('returns false when the application has an unresolved required answer', () => {
    const approval: Approval = {
      jobId: 'remoteok:1',
      runNumber: 1,
      approvedBy: 'profile-1',
      approvedAt: new Date().toISOString(),
    }
    const application = baseApplication({
      requiredAnswers: [{ question: 'Why this role?', answer: null }],
    })
    expect(canSubmit(application, baseRun(), approval)).toBe(false)
  })

  it('returns true when the approval matches the run and every required answer is resolved', () => {
    const approval: Approval = {
      jobId: 'remoteok:1',
      runNumber: 1,
      approvedBy: 'profile-1',
      approvedAt: new Date().toISOString(),
    }
    const application = baseApplication({
      requiredAnswers: [{ question: 'Why this role?', answer: 'Because I love the mission.' }],
    })
    expect(canSubmit(application, baseRun(), approval)).toBe(true)
  })
})

describe('approveRun', () => {
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
    await ensureAutomationRunIndexes(db)
    await ensureApplicationIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('creates an approval and flips the run to approved when every answer is resolved', async () => {
    await db.collection<Application>('applications').insertOne(baseApplication())
    await db.collection<AutomationRun>('automationRuns').insertOne(baseRun())

    const result = await approveRun(db, 'remoteok:1', 1, 'profile-1')

    expect(result).toEqual({ approved: true, reason: null })
    const run = await db.collection('automationRuns').findOne({ jobId: 'remoteok:1', runNumber: 1 })
    expect(run?.status).toBe('approved')
    const approval = await db.collection('approvals').findOne({ jobId: 'remoteok:1', runNumber: 1 })
    expect(approval?.approvedBy).toBe('profile-1')
  })

  it('records the approval but does not flip the run when a required answer is unresolved', async () => {
    await db.collection<Application>('applications').insertOne(
      baseApplication({ requiredAnswers: [{ question: 'Why this role?', answer: null }] })
    )
    await db.collection<AutomationRun>('automationRuns').insertOne(baseRun())

    const result = await approveRun(db, 'remoteok:1', 1, 'profile-1')

    expect(result.approved).toBe(false)
    const run = await db.collection('automationRuns').findOne({ jobId: 'remoteok:1', runNumber: 1 })
    expect(run?.status).toBe('ready_for_approval')
  })

  it('throws when there is no application or run for the given job and run number', async () => {
    await expect(approveRun(db, 'remoteok:missing', 1, 'profile-1')).rejects.toThrow()
  })
})
