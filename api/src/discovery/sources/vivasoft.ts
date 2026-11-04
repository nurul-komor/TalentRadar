import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

// Vivasoft's WordPress career page just links out to the Novara ATS, which has a
// public JSON API. The list carries a plain-text description; the per-job detail
// endpoint carries the full HTML description and the posted date, so we enrich
// each job with a detail fetch.
const API_BASE = 'https://api.app.novara.com.my/api/job-builder/v1/public'
const LIST_URL = `${API_BASE}/career-page?company_slug=vivasoftltd&size=100`
const PUBLIC_JOB_BASE = 'https://app.novara.com.my/jobs'
const COMPANY_NAME = 'Vivasoft Limited'

interface NovaraJob {
  id?: string
  slug?: string
  title?: string
  description?: string | null
  city?: string | null
  country?: string | null
  salary_min?: number | null
  salary_max?: number | null
}

interface NovaraListResponse {
  data?: { items?: NovaraJob[] }
}

interface NovaraDetailResponse {
  data?: {
    description?: string | null
    posted_at?: string | null
  }
}

function buildLocation(job: NovaraJob): string | null {
  const place = [job.city, job.country]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(', ')
  return place || null
}

async function toPosting(job: NovaraJob & { slug: string }): Promise<RawJobPosting> {
  let description = job.description ?? ''
  let postedAt: string | null = null
  try {
    const res = await fetchWithPolicy(`${API_BASE}/jobs/slug/${encodeURIComponent(job.slug)}`)
    if (res.ok) {
      const detail = (await res.json()) as NovaraDetailResponse
      if (detail.data?.description) description = detail.data.description
      postedAt = detail.data?.posted_at ?? null
    }
  } catch {
    // Fall back to the list's plain-text description.
  }

  return {
    sourceId: 'vivasoft' as const,
    sourceJobId: job.slug,
    url: `${PUBLIC_JOB_BASE}/${job.slug}`,
    title: job.title ?? 'Unknown title',
    company: COMPANY_NAME,
    rawDescription: description,
    location: buildLocation(job),
    salaryMin: typeof job.salary_min === 'number' ? job.salary_min : null,
    salaryMax: typeof job.salary_max === 'number' ? job.salary_max : null,
    postedAt,
  }
}

export const vivasoftSource: JobSource = {
  id: 'vivasoft',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(LIST_URL)
    if (!res.ok) {
      throw new Error(`vivasoft: unexpected status ${res.status}`)
    }
    const body = (await res.json()) as NovaraListResponse

    const items = (body.data?.items ?? []).filter(
      (job): job is NovaraJob & { slug: string } => typeof job.slug === 'string'
    )

    const postings: RawJobPosting[] = []
    for (const job of items) {
      postings.push(await toPosting(job))
    }
    return postings
  },
}
