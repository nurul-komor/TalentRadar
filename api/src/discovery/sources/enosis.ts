import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

// Enosis Solutions recruits through the Pinpoint ATS, which exposes a public
// `postings.json` feed on the career subdomain — no auth. Each posting already
// carries the full description, location, and (when made visible) salary, so a
// single request is enough.
const POSTINGS_URL = 'https://careers.enosisbd.com/postings.json'
const COMPANY_NAME = 'Enosis Solutions'

interface PinpointLocation {
  city?: string | null
  province?: string | null
  name?: string | null
}

interface PinpointPosting {
  id?: string | number
  title?: string
  url?: string
  path?: string
  description?: string | null
  key_responsibilities?: string | null
  skills_knowledge_expertise?: string | null
  benefits?: string | null
  workplace_type_text?: string | null
  compensation_visible?: boolean
  compensation_minimum?: number | string | null
  compensation_maximum?: number | string | null
  location?: PinpointLocation | null
}

interface PinpointResponse {
  data?: PinpointPosting[]
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function buildLocation(posting: PinpointPosting): string | null {
  const loc = posting.location
  const place = [loc?.city, loc?.province, loc?.name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ')
  const workplace = posting.workplace_type_text?.trim()
  if (place && workplace) return `${place} (${workplace})`
  return place || workplace || null
}

function buildDescription(posting: PinpointPosting): string {
  return [
    posting.description,
    posting.key_responsibilities,
    posting.skills_knowledge_expertise,
    posting.benefits,
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n')
}

export const enosisSource: JobSource = {
  id: 'enosis',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(POSTINGS_URL)
    if (!res.ok) {
      throw new Error(`enosis: unexpected status ${res.status}`)
    }
    const body = (await res.json()) as PinpointResponse

    return (body.data ?? [])
      .filter((posting): posting is PinpointPosting & { id: string | number } => posting.id != null)
      .map((posting) => {
        const visible = posting.compensation_visible === true
        return {
          sourceId: 'enosis' as const,
          sourceJobId: String(posting.id),
          url: posting.url ?? `https://careers.enosisbd.com${posting.path ?? ''}`,
          title: posting.title ?? 'Unknown title',
          company: COMPANY_NAME,
          rawDescription: buildDescription(posting),
          location: buildLocation(posting),
          salaryMin: visible ? toNumber(posting.compensation_minimum) : null,
          salaryMax: visible ? toNumber(posting.compensation_maximum) : null,
          // Pinpoint's public feed exposes no publish date (only a deadline).
          postedAt: null,
        }
      })
  },
}
