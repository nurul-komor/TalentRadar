export interface RawJobPosting {
  sourceId: 'remoteok' | 'weworkremotely' | 'himalayas'
  sourceJobId: string
  url: string
  title: string
  company: string
  rawDescription: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  postedAt: string | null
}

export interface JobSource {
  id: RawJobPosting['sourceId']
  fetchJobs(): Promise<RawJobPosting[]>
}
