import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { writeAuditLog } from '../../src/applications/auditLog'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

describe('writeAuditLog', () => {
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
  })

  afterEach(async () => {
    await client.close()
  })

  it('writes an entry with a timestamp to the auditLog collection', async () => {
    await writeAuditLog(db, {
      action: 'application_created',
      jobId: 'remoteok:1',
      runNumber: null,
      actorProfileId: 'profile-1',
      details: { company: 'Acme' },
    })

    const stored = await db.collection('auditLog').findOne({ action: 'application_created' })
    expect(stored?.jobId).toBe('remoteok:1')
    expect(stored?.actorProfileId).toBe('profile-1')
    expect(stored?.details).toEqual({ company: 'Acme' })
    expect(typeof stored?.at).toBe('string')
  })

  it('allows a null jobId, runNumber, and actorProfileId for system-initiated entries', async () => {
    await writeAuditLog(db, {
      action: 'automation_run_recorded',
      jobId: null,
      runNumber: null,
      actorProfileId: null,
      details: {},
    })

    const stored = await db.collection('auditLog').findOne({ action: 'automation_run_recorded' })
    expect(stored?.jobId).toBeNull()
    expect(stored?.actorProfileId).toBeNull()
  })
})
