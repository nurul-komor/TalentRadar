import type { GeneratedContent, Job, JobRequirements, Profile } from '@job-hunter/shared'

export interface GenerationResult {
  content: GeneratedContent
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
