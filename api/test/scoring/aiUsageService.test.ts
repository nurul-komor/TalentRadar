import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { computeCostUsd, isWithinBudget, recordUsage } from '../../src/scoring/aiUsageService'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

describe('computeCostUsd', () => {
  it('computes cost from input and output token counts at Haiku 4.5 rates', () => {
    const cost = computeCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(cost).toBeCloseTo(1.0 + 5.0, 5)
  })

  it('computes cost for a small realistic call', () => {
    const cost = computeCostUsd({ inputTokens: 2000, outputTokens: 300 })
    expect(cost).toBeCloseTo((2000 / 1_000_000) * 1.0 + (300 / 1_000_000) * 5.0, 10)
  })
})

describe('isWithinBudget / recordUsage', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let originalDaily: string | undefined
  let originalMonthly: string | undefined

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
    originalDaily = process.env.ANTHROPIC_DAILY_BUDGET_USD
    originalMonthly = process.env.ANTHROPIC_MONTHLY_BUDGET_USD
    process.env.ANTHROPIC_DAILY_BUDGET_USD = '0.01'
    process.env.ANTHROPIC_MONTHLY_BUDGET_USD = '1'
  })

  afterEach(async () => {
    await client.close()
    process.env.ANTHROPIC_DAILY_BUDGET_USD = originalDaily
    process.env.ANTHROPIC_MONTHLY_BUDGET_USD = originalMonthly
  })

  it('is within budget when no usage has been recorded', async () => {
    expect(await isWithinBudget(db)).toBe(true)
  })

  it('accumulates recorded usage into the daily and monthly totals', async () => {
    await recordUsage(db, { inputTokens: 1000, outputTokens: 500 })
    await recordUsage(db, { inputTokens: 1000, outputTokens: 500 })

    const today = new Date().toISOString().slice(0, 10)
    const daily = await db.collection('aiUsage').findOne({ _id: `daily:${today}` as unknown as never })
    expect(daily?.calls).toBe(2)
  })

  it('reports over daily budget once accumulated cost exceeds the daily cap', async () => {
    // (2000/1e6)*1.0 + (500/1e6)*5.0 = 0.002 + 0.0025 = 0.0045 > the 0.01 daily cap after 3 calls
    await recordUsage(db, { inputTokens: 2000, outputTokens: 500 })
    await recordUsage(db, { inputTokens: 2000, outputTokens: 500 })
    await recordUsage(db, { inputTokens: 2000, outputTokens: 500 })

    expect(await isWithinBudget(db)).toBe(false)
  })
})
