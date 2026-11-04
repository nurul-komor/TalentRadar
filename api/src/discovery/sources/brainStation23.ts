import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

// Brain Station 23 publishes on the easy.jobs ATS (not Greenhouse/Lever), whose
// SPA career page is backed by a public JSON API:
//   GET /api/career/home        -> list of open jobs (no description or salary)
//   GET /api/career/job/{slug}  -> full detail for one job
// The list alone has no description, which the scoring pipeline needs, so we list
// first and then fetch each job's detail. fetchWithPolicy throttles to one
// request per second per host, which keeps this detail fan-out polite.
const CAREER_ORIGIN = 'https://brainstation-23.easy.jobs'
const HOME_URL = `${CAREER_ORIGIN}/api/career/home`
const COMPANY_NAME = 'Brain Station 23'

interface EasyJobsAddress {
  city?: string | null
  state?: { name?: string | null } | null
  country?: { name?: string | null } | null
}

interface EasyJobsListItem {
  slug?: string
  title?: string
  job_type?: string | null
  meta?: { is_remote?: number } | null
  address?: EasyJobsAddress | null
}

interface EasyJobsHomeResponse {
  status?: string
  data?: { jobs?: EasyJobsListItem[] }
}

interface EasyJobsDetailPost {
  requirements?: string | null
  // [sic] — the field really is misspelled this way in the easy.jobs API.
  responsibilies?: string | null
  benefits?: string | null
  salary?: number | null
}

interface EasyJobsDetailResponse {
  status?: string
  data?: {
    post?: EasyJobsDetailPost
    address?: EasyJobsAddress | null
  }
}

function formatLocation(
  address: EasyJobsAddress | null | undefined,
  isRemote: boolean
): string | null {
  const place = [address?.city, address?.state?.name, address?.country?.name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(', ')
  if (isRemote) return place ? `Remote — ${place}` : 'Remote'
  return place || null
}

function buildDescription(post: EasyJobsDetailPost | undefined): string {
  if (!post) return ''
  return [post.responsibilies, post.requirements, post.benefits]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n')
}

async function toPosting(item: EasyJobsListItem & { slug: string }): Promise<RawJobPosting> {
  const { slug } = item
  const isRemote = item.meta?.is_remote === 1 || item.job_type === 'remote'

  // Detail enriches the posting with its description/salary; if that one request
  // fails we still record the posting from the list data rather than dropping it.
  let rawDescription = ''
  let salaryMin: number | null = null
  let address = item.address
  try {
    const res = await fetchWithPolicy(`${CAREER_ORIGIN}/api/career/job/${encodeURIComponent(slug)}`)
    if (res.ok) {
      const body = (await res.json()) as EasyJobsDetailResponse
      rawDescription = buildDescription(body.data?.post)
      salaryMin = typeof body.data?.post?.salary === 'number' ? body.data.post.salary : null
      address = body.data?.address ?? item.address
    }
  } catch {
    // Keep the list-only posting; discovery can still surface it.
  }

  return {
    sourceId: 'brainstation-23' as const,
    sourceJobId: slug,
    url: `${CAREER_ORIGIN}/${slug}`,
    title: item.title ?? 'Unknown title',
    company: COMPANY_NAME,
    rawDescription,
    location: formatLocation(address, isRemote),
    salaryMin,
    salaryMax: null,
    // easy.jobs exposes an expiry date but not a publication date for its postings.
    postedAt: null,
  }
}

export const brainStation23Source: JobSource = {
  id: 'brainstation-23',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(HOME_URL)
    if (!res.ok) {
      throw new Error(`brainstation-23: unexpected status ${res.status}`)
    }
    const body = (await res.json()) as EasyJobsHomeResponse

    const items = (body.data?.jobs ?? []).filter(
      (item): item is EasyJobsListItem & { slug: string } => typeof item.slug === 'string'
    )

    const postings: RawJobPosting[] = []
    for (const item of items) {
      postings.push(await toPosting(item))
    }
    return postings
  },
}
