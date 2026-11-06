import type { Db } from 'mongodb'

interface ModelPricing {
  inputPerMillionUsd: number
  outputPerMillionUsd: number
}

// Keyed by both the legacy tier aliases ("haiku"/"opus") and the concrete model ids the
// providers report, so callers can price usage by whatever identifier they have on hand.
// USD per 1M tokens.
export const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  haiku: { inputPerMillionUsd: 1.0, outputPerMillionUsd: 5.0 },
  opus: { inputPerMillionUsd: 5.0, outputPerMillionUsd: 25.0 },
  'claude-haiku-4-5': { inputPerMillionUsd: 1.0, outputPerMillionUsd: 5.0 },
  'claude-opus-4-8': { inputPerMillionUsd: 5.0, outputPerMillionUsd: 25.0 },
  // OpenAI
  'gpt-4o-mini': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  'gpt-4o': { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10.0 },
  // OpenAI embeddings (input-only; no output tokens).
  'text-embedding-3-small': { inputPerMillionUsd: 0.02, outputPerMillionUsd: 0 },
  'text-embedding-3-large': { inputPerMillionUsd: 0.13, outputPerMillionUsd: 0 },
  // Google Gemini
  'gemini-2.0-flash': { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  'gemini-2.5-flash': { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  'gemini-2.5-pro': { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
}

// Alias kept for existing imports; a model identifier is now any string (concrete id or tier).
export type ClaudeModel = string

export interface ClaudeUsage {
  inputTokens: number
  outputTokens: number
}

export function computeCostUsd(usage: ClaudeUsage, model: string = 'haiku'): number {
  const pricing = PRICING[model]
  if (!pricing) {
    // An unknown model shouldn't crash billing or silently count as free — warn and treat
    // as zero cost so a model without a price entry can't accidentally throttle the budget.
    console.warn(`No pricing entry for model "${model}"; recording usage at zero cost.`)
    return 0
  }
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillionUsd +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd
  )
}

function todayKey(): string {
  return `daily:${new Date().toISOString().slice(0, 10)}`
}

function thisMonthKey(): string {
  return `monthly:${new Date().toISOString().slice(0, 7)}`
}

export async function isWithinBudget(db: Db): Promise<boolean> {
  // Provider-neutral LLM_* caps take precedence; the ANTHROPIC_* names are still honored
  // for backward compatibility with existing deployments and .env files.
  const dailyCap = Number.parseFloat(
    process.env.LLM_DAILY_BUDGET_USD ?? process.env.ANTHROPIC_DAILY_BUDGET_USD ?? '1'
  )
  const monthlyCap = Number.parseFloat(
    process.env.LLM_MONTHLY_BUDGET_USD ?? process.env.ANTHROPIC_MONTHLY_BUDGET_USD ?? '20'
  )

  const usage = db.collection('aiUsage')
  const daily = await usage.findOne({ _id: todayKey() as unknown as never })
  const monthly = await usage.findOne({ _id: thisMonthKey() as unknown as never })

  const dailySpent = (daily?.costUsd as number | undefined) ?? 0
  const monthlySpent = (monthly?.costUsd as number | undefined) ?? 0

  return dailySpent < dailyCap && monthlySpent < monthlyCap
}

export async function recordUsage(
  db: Db,
  usage: ClaudeUsage,
  model: string = 'haiku'
): Promise<void> {
  const cost = computeCostUsd(usage, model)
  const aiUsage = db.collection('aiUsage')

  await aiUsage.updateOne(
    { _id: todayKey() as unknown as never },
    { $inc: { costUsd: cost, calls: 1 } },
    { upsert: true }
  )
  await aiUsage.updateOne(
    { _id: thisMonthKey() as unknown as never },
    { $inc: { costUsd: cost, calls: 1 } },
    { upsert: true }
  )
}
