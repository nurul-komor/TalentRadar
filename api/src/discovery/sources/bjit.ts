import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

// BJIT's Next.js career page fetches jobs client-side from its own API host. The
// list already includes the full requirements HTML, so one request is enough.
// `country` is required; Bangladesh is the only populated market.
const JOBS_API_URL =
  'https://api.bjitgroup.com/job/get-all-by-country?itemPerPage=99&page=1&country=Bangladesh'
// BJIT has no per-job public page (the career page opens a modal), so we build a
// stable, unique path-based URL per job — the jobs collection's normalizedUrl
// index strips query/hash, so the id must live in the path.
const CAREER_BASE = 'https://bjitgroup.com/career'
const COMPANY_NAME = 'BJIT Limited'

interface BjitJob {
  _id?: string
  position?: string
  country?: string | null
  shortDescription?: string | null
  requirements?: string | null
  createdAt?: string | null
}

interface BjitResponse {
  success?: boolean
  results?: { jobs?: BjitJob[] }
}

function buildDescription(job: BjitJob): string {
  return [job.shortDescription, job.requirements]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n')
}

export const bjitSource: JobSource = {
  id: 'bjit',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(JOBS_API_URL)
    if (!res.ok) {
      throw new Error(`bjit: unexpected status ${res.status}`)
    }
    const body = (await res.json()) as BjitResponse

    return (body.results?.jobs ?? [])
      .filter((job): job is BjitJob & { _id: string } => typeof job._id === 'string')
      .map((job) => ({
        sourceId: 'bjit' as const,
        sourceJobId: job._id,
        url: `${CAREER_BASE}/${encodeURIComponent(job._id)}`,
        title: job.position ?? 'Unknown title',
        company: COMPANY_NAME,
        rawDescription: buildDescription(job),
        location: job.country ?? null,
        // BJIT exposes no salary; createdAt is a proper ISO timestamp.
        salaryMin: null,
        salaryMax: null,
        postedAt: job.createdAt ?? null,
      }))
  },
}
