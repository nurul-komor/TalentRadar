import type { Resume } from '@job-hunter/shared'

export interface ResumeExtractionResult {
  resume: Resume
  // The concrete model id that produced this result, so callers can price the usage
  // correctly regardless of which provider/model the config selected.
  model: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export type ResumeExtractor = (cvText: string) => Promise<ResumeExtractionResult>
