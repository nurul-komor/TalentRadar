import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

// Cefalo runs its own ATS backend. The `public/`-prefixed endpoints need no auth
// (the bare /jobs path is auth-gated). The list carries only a summary, so we
// fetch each job's detail for the full description and posting date. Cefalo's
// own careers page shows every job the public list returns — including ones the
// API flags `isExpired` (their deadlines have passed but the roles are still
// advertised) — so we surface all of them rather than filtering on isExpired.
const API_BASE = 'https://ats.cefalo.com/api/v1/public'
const PUBLIC_JOB_BASE = 'https://career.cefalo.com/job'
const COMPANY_NAME = 'Cefalo Bangladesh'

interface CefaloListJob {
  id?: number
  title?: string
  summary?: string | null
  slug?: string
}

interface CefaloDetailJob {
  description?: string | null
  summary?: string | null
  created_at?: string | null
}

function buildDescription(summary: string | null | undefined, description: string | null | undefined): string {
  return [description, summary]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n')
}

async function toPosting(job: CefaloListJob & { slug: string }): Promise<RawJobPosting> {
  let description: string | null = null
  let postedAt: string | null = null
  try {
    const res = await fetchWithPolicy(`${API_BASE}/job/${encodeURIComponent(job.slug)}`)
    if (res.ok) {
      const detail = (await res.json()) as CefaloDetailJob
      description = detail.description ?? null
      postedAt = detail.created_at ?? null
    }
  } catch {
    // Fall back to the list summary.
  }

  return {
    sourceId: 'cefalo' as const,
    sourceJobId: job.slug,
    url: `${PUBLIC_JOB_BASE}/${job.slug}`,
    title: job.title ?? 'Unknown title',
    company: COMPANY_NAME,
    rawDescription: buildDescription(job.summary, description),
    // Cefalo exposes neither a structured location nor salary.
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt,
  }
}

export const cefaloSource: JobSource = {
  id: 'cefalo',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(`${API_BASE}/jobs`)
    if (!res.ok) {
      throw new Error(`cefalo: unexpected status ${res.status}`)
    }
    const body = (await res.json()) as CefaloListJob[]

    const listed = (body ?? []).filter(
      (job): job is CefaloListJob & { slug: string } => typeof job.slug === 'string'
    )

    const postings: RawJobPosting[] = []
    for (const job of listed) {
      postings.push(await toPosting(job))
    }
    return postings
  },
}
