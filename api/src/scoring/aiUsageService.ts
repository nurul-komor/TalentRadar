import type { Db } from 'mongodb'

export const HAIKU_PRICING = {
  inputPerMillionUsd: 1.0,
  outputPerMillionUsd: 5.0,
}

export interface ClaudeUsage {
  inputTokens: number
  outputTokens: number
}

interface AiUsageDoc {
  _id: string
  costUsd: number
  calls: number
}

export function computeCostUsd(usage: ClaudeUsage): number {
  return (
    (usage.inputTokens / 1_000_000) * HAIKU_PRICING.inputPerMillionUsd +
    (usage.outputTokens / 1_000_000) * HAIKU_PRICING.outputPerMillionUsd
  )
}

function todayKey(): string {
  return `daily:${new Date().toISOString().slice(0, 10)}`
}

function thisMonthKey(): string {
  return `monthly:${new Date().toISOString().slice(0, 7)}`
}

export async function isWithinBudget(db: Db): Promise<boolean> {
  const dailyCap = Number.parseFloat(process.env.ANTHROPIC_DAILY_BUDGET_USD ?? '1')
  const monthlyCap = Number.parseFloat(process.env.ANTHROPIC_MONTHLY_BUDGET_USD ?? '20')

  const usage = db.collection<AiUsageDoc>('aiUsage')
  const daily = await usage.findOne({ _id: todayKey() })
  const monthly = await usage.findOne({ _id: thisMonthKey() })

  const dailySpent = daily?.costUsd ?? 0
  const monthlySpent = monthly?.costUsd ?? 0

  return dailySpent < dailyCap && monthlySpent < monthlyCap
}

export async function recordUsage(db: Db, usage: ClaudeUsage): Promise<void> {
  const cost = computeCostUsd(usage)
  const aiUsage = db.collection<AiUsageDoc>('aiUsage')

  await aiUsage.updateOne(
    { _id: todayKey() },
    { $inc: { costUsd: cost, calls: 1 } },
    { upsert: true }
  )
  await aiUsage.updateOne(
    { _id: thisMonthKey() },
    { $inc: { costUsd: cost, calls: 1 } },
    { upsert: true }
  )
}
