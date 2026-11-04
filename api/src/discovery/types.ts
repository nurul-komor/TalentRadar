import type { GovtJobDetails } from '@job-hunter/shared'

export interface RawJobPosting {
  sourceId:
    | 'remoteok'
    | 'weworkremotely'
    | 'himalayas'
    | 'teletalk-govt'
    | 'brainstation-23'
    | 'riseup-labs'
    | 'enosis'
    | 'bdtask'
    | 'selise'
    | 'bjit'
    | 'cefalo'
    | 'vivasoft'
    | 'dsinnovators'
  sourceJobId: string
  url: string
  title: string
  company: string
  rawDescription: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  postedAt: string | null
  govtDetails?: GovtJobDetails
}

export interface JobSource {
  id: RawJobPosting['sourceId']
  fetchJobs(): Promise<RawJobPosting[]>
}
