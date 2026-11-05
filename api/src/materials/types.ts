import type { GeneratedContent, Job, JobRequirements, Profile } from '@job-hunter/shared'

export interface GenerationResult {
  content: GeneratedContent
  // The concrete model id that produced this result, so callers can price the usage
  // correctly regardless of which provider/model the config selected.
  model: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export type MaterialsGenerator = (input: {
  job: Pick<Job, 'title' | 'company' | 'rawDescription'>
  profile: Profile
  requirements: JobRequirements | null
}) => Promise<GenerationResult>
