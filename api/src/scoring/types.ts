import type { JobRequirements } from '@job-hunter/shared'

export interface ExtractionResult {
  requirements: JobRequirements
  // The concrete model id that produced this result, so callers can price the usage
  // correctly regardless of which provider/model the config selected.
  model: string
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
