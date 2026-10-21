import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { connectMongo } from '../src/db'
import type { MongoClient } from 'mongodb'

describe('connectMongo', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
  })

  afterAll(async () => {
    await client?.close()
    await mongod.stop()
  })

  it('connects and returns a usable Db handle', async () => {
    const conn = await connectMongo(mongod.getUri(), 'test')
    client = conn.client
    await conn.db.collection('ping').insertOne({ ok: 1 })
    const count = await conn.db.collection('ping').countDocuments()
    expect(count).toBe(1)
  })
})
