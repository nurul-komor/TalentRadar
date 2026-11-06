import type { Db } from 'mongodb'
import type { Job } from '@job-hunter/shared'
import type { Embedder } from '../embeddings/embeddingProvider.js'
import { embedJobs, embedProfile } from './embeddingService.js'
import { searchSimilarJobs } from './vectorSearch.js'

// Blend weights for the hybrid rank: semantic similarity vs. the existing rule-based score.
// Semantic leads (the feature's point) but the rule score still shapes ties and filters out
// poor work-auth/remote/salary fit. Jobs without a rule score fall back to semantic alone.
const SEMANTIC_WEIGHT = 0.6
const RULE_WEIGHT = 0.4

// Cap on how many not-yet-embedded jobs a single GET /suggestions will embed inline, so the
// first requests after new jobs arrive make steady progress without an unbounded latency hit.
// Bulk backfill is the reindex endpoint's job.
const LAZY_EMBED_LIMIT = 50

export interface Suggestion {
  job: Job
  semanticScore: number // 0..100
  ruleScore: number | null // 0..100 (existing computeScore), or null if not yet scored
  finalScore: number // 0..100 blended rank
}

export interface SuggestionsResult {
  suggestions: Suggestion[]
  // True when semantic ranking was unavailable (no resume/cvText to embed, or budget
  // exhausted) — the caller got an empty list, not an error.
  semanticUnavailable: boolean
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

export async function getSuggestions(
  db: Db,
  embedder: Embedder,
  profileId: string,
  limit = 20
): Promise<SuggestionsResult> {
  // Keep job embeddings fresh for a bounded number of jobs, then ensure the profile vector.
  await embedJobs(db, embedder, { limit: LAZY_EMBED_LIMIT })
  const queryVector = await embedProfile(db, profileId, embedder)
  if (!queryVector) {
    return { suggestions: [], semanticUnavailable: true }
  }

  const matches = await searchSimilarJobs(db, queryVector, { limit })

  const suggestions: Suggestion[] = matches.map(({ job, similarity }) => {
    const semanticScore = Math.max(0, Math.min(100, similarity * 100))
    const ruleScore = typeof job.score === 'number' ? job.score : null
    const finalScore =
      ruleScore === null
        ? semanticScore
        : SEMANTIC_WEIGHT * semanticScore + RULE_WEIGHT * ruleScore
    return {
      job,
      semanticScore: round(semanticScore),
      ruleScore,
      finalScore: round(finalScore),
    }
  })

  suggestions.sort((a, b) => b.finalScore - a.finalScore)
  return { suggestions, semanticUnavailable: false }
}
