import { fetchWithPolicy } from '../fetchWithPolicy'
import type { JobSource, RawJobPosting } from '../types'

const REMOTEOK_API_URL = 'https://remoteok.com/api'

interface RemoteOkJob {
  id?: string
  company?: string
  position?: string
  description?: string
  location?: string
  url?: string
  date?: string
  salary_min?: number
  salary_max?: number
}

export const remoteOkSource: JobSource = {
  id: 'remoteok',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(REMOTEOK_API_URL)
    if (!res.ok) {
      throw new Error(`remoteok: unexpected status ${res.status}`)
    }
    const body = await res.json()
    if (!Array.isArray(body)) {
      throw new Error(`remoteok: expected an array response, got ${typeof body}`)
    }

    return (body as RemoteOkJob[])
      .filter((item): item is RemoteOkJob & { id: string; url: string } =>
        typeof item.id === 'string' && typeof item.url === 'string'
      )
      .map((item) => ({
        sourceId: 'remoteok' as const,
        sourceJobId: item.id,
        url: item.url,
        title: item.position ?? 'Unknown title',
        company: item.company ?? 'Unknown company',
        rawDescription: item.description ?? '',
        location: item.location ?? null,
        salaryMin: item.salary_min ?? null,
        salaryMax: item.salary_max ?? null,
        postedAt: item.date ?? null,
      }))
  },
}
