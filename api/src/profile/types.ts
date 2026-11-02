import type { Resume } from '@job-hunter/shared'

export interface ResumeExtractionResult {
  resume: Resume
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export type ResumeExtractor = (cvText: string) => Promise<ResumeExtractionResult>
