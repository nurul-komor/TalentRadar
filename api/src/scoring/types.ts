import type { JobRequirements } from '@job-hunter/shared'

export interface ExtractionResult {
  requirements: JobRequirements
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export type JobRequirementsExtractor = (input: {
  title: string
  company: string
  rawDescription: string
}) => Promise<ExtractionResult>
