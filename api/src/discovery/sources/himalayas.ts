import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

const HIMALAYAS_API_URL = 'https://himalayas.app/jobs/api?limit=50'

interface HimalayasJob {
  title?: string
  companyName?: string
  description?: string
  locationRestrictions?: string[]
  minSalary?: number | null
  maxSalary?: number | null
  pubDate?: number
  guid?: string
}

interface HimalayasResponse {
  jobs?: HimalayasJob[]
}

function unixSecondsToIso(seconds: number | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null
}

export const himalayasSource: JobSource = {
  id: 'himalayas',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(HIMALAYAS_API_URL)
    if (!res.ok) {
      throw new Error(`himalayas: unexpected status ${res.status}`)
    }
    const body = (await res.json()) as HimalayasResponse

    return (body.jobs ?? [])
      .filter((item): item is HimalayasJob & { guid: string } => typeof item.guid === 'string')
      .map((item) => ({
        sourceId: 'himalayas' as const,
        sourceJobId: item.guid,
        url: item.guid,
        title: item.title ?? 'Unknown title',
        company: item.companyName ?? 'Unknown company',
        rawDescription: item.description ?? '',
        location: item.locationRestrictions?.length
          ? item.locationRestrictions.join(', ')
          : null,
        salaryMin: item.minSalary ?? null,
        salaryMax: item.maxSalary ?? null,
        postedAt: unixSecondsToIso(item.pubDate),
      }))
  },
}
