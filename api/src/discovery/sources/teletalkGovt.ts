import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'
import type { GovtJobDetails } from '@job-hunter/shared'

const ALLJOBS_BASE_URL = 'https://alljobs.teletalk.com.bd'
const ORG_LIST_URL = `${ALLJOBS_BASE_URL}/api/v1/govt-jobs/org-list`
const PUBLIC_DETAILS_URL = `${ALLJOBS_BASE_URL}/api/v1/govt-jobs/public-details`
const PAGE_LIMIT = 20

// Teletalk documents no code->meaning mapping for `gender` anywhere public.
// 3 is the only value ever observed (across clerical, cleaner, and security-guard
// postings — roles with no plausible single-gender restriction), so it is mapped
// as an inference, not a confirmed fact. Every other code, seen or not, falls
// back to 'unknown' rather than guessing further.
const GENDER_CODE_MAP: Record<number, GovtJobDetails['genderRequirement']> = {
  3: 'any',
}

interface OrgListJobStub {
  id: number
  job_title: string
}

interface OrgListOrg {
  id: number
  name: string
  govt_jobs: OrgListJobStub[]
}

interface OrgListResponse {
  count: number
  govtOrgJobs: OrgListOrg[]
}

interface PublicDetailsBody {
  job_id: string
  vacancy: string
  gender: number
  min_age: number | null
  max_age: number | null
  application_site: string | null
  advertisement_file: string | null
  published_date: string | null
  deadline_date: string | null
  advertisement_no: string | null
}

interface PublicDetailsResponse {
  details: PublicDetailsBody
}

interface JobStubWithOrg {
  jobId: number
  jobTitle: string
  orgId: number
  orgName: string
}

async function fetchOrgListPage(page: number): Promise<OrgListResponse> {
  const res = await fetchWithPolicy(`${ORG_LIST_URL}?page=${page}&limit=${PAGE_LIMIT}`)
  if (!res.ok) {
    throw new Error(`teletalk-govt: unexpected org-list status ${res.status}`)
  }
  return (await res.json()) as OrgListResponse
}

async function fetchAllJobStubs(): Promise<JobStubWithOrg[]> {
  const firstPage = await fetchOrgListPage(1)
  const stubs: JobStubWithOrg[] = []

  function collect(response: OrgListResponse) {
    for (const org of response.govtOrgJobs) {
      for (const job of org.govt_jobs) {
        stubs.push({ jobId: job.id, jobTitle: job.job_title, orgId: org.id, orgName: org.name })
      }
    }
  }
  collect(firstPage)

  // `count` is the org-list endpoint's own total-page count for this page size,
  // not a total-org count — confirmed against the live API's pagination fixtures.
  const totalPages = firstPage.count
  for (let page = 2; page <= totalPages; page++) {
    collect(await fetchOrgListPage(page))
  }

  return stubs
}

function mapGenderCode(code: number): GovtJobDetails['genderRequirement'] {
  return GENDER_CODE_MAP[code] ?? 'unknown'
}

function buildRawDescription(stub: JobStubWithOrg, details: PublicDetailsBody): string {
  const parts = [`${stub.jobTitle} at ${stub.orgName} — ${details.vacancy} vacancies.`]
  if (details.published_date || details.deadline_date) {
    parts.push(
      `Published ${details.published_date ?? 'unknown'}, deadline ${details.deadline_date ?? 'unknown'}.`
    )
  }
  return parts.join(' ')
}

async function fetchJobDetail(stub: JobStubWithOrg): Promise<RawJobPosting | null> {
  const res = await fetchWithPolicy(`${PUBLIC_DETAILS_URL}?id=${stub.jobId}`)
  if (!res.ok) return null

  const body = (await res.json()) as PublicDetailsResponse
  const details = body.details
  if (!details) return null

  const govtDetails: GovtJobDetails = {
    jobCode: details.job_id,
    vacancy: details.vacancy,
    minAge: details.min_age,
    maxAge: details.max_age,
    genderRequirement: mapGenderCode(details.gender),
    publishedDate: details.published_date,
    deadlineDate: details.deadline_date,
    advertisementNo: details.advertisement_no,
    advertisementPdfUrl: details.advertisement_file
      ? `${ALLJOBS_BASE_URL}/${details.advertisement_file}`
      : null,
    applicationPortalUrl: details.application_site,
  }

  return {
    sourceId: 'teletalk-govt',
    sourceJobId: String(stub.jobId),
    url: `${ALLJOBS_BASE_URL}/jobs/government/${stub.orgId}?jobId=${stub.jobId}`,
    title: stub.jobTitle,
    company: stub.orgName,
    rawDescription: buildRawDescription(stub, details),
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: details.published_date,
    govtDetails,
  }
}

export const teletalkGovtSource: JobSource = {
  id: 'teletalk-govt',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const stubs = await fetchAllJobStubs()
    const postings: RawJobPosting[] = []

    for (const stub of stubs) {
      const posting = await fetchJobDetail(stub)
      if (posting) postings.push(posting)
    }

    return postings
  },
}
