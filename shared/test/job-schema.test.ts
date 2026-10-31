import { describe, it, expect } from 'vitest'
import { JobSchema } from '../src/index'

const VALID_JOB = {
  sourceId: 'remoteok',
  sourceJobId: '12345',
  normalizedUrl: 'https://remoteok.com/remote-jobs/12345',
  title: 'Senior Backend Engineer',
  company: 'Acme Corp',
  rawDescription: '<p>We are hiring...</p>',
  location: null,
  salaryMin: 90000,
  salaryMax: 130000,
  postedAt: '2026-10-01T00:00:00.000Z',
  status: 'discovered',
  discoveredAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
  verifiedAt: null,
  verificationEvidence: null,
  contentHash: null,
  extractedRequirements: null,
  extractedAt: null,
  score: null,
  scoreBreakdown: null,
  scoredAt: null,
}

describe('JobSchema', () => {
  it('accepts a valid discovered job', () => {
    const result = JobSchema.safeParse(VALID_JOB)
    expect(result.success).toBe(true)
  })

  it('rejects an unknown sourceId', () => {
    const result = JobSchema.safeParse({ ...VALID_JOB, sourceId: 'linkedin' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing required field', () => {
    const { normalizedUrl, ...withoutUrl } = VALID_JOB
    const result = JobSchema.safeParse(withoutUrl)
    expect(result.success).toBe(false)
  })

  it('accepts a verified job with verification evidence', () => {
    const result = JobSchema.safeParse({
      ...VALID_JOB,
      status: 'verified',
      verifiedAt: '2026-10-22T00:00:00.000Z',
      verificationEvidence: 'apply now',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a rejected job with verification evidence', () => {
    const result = JobSchema.safeParse({
      ...VALID_JOB,
      status: 'rejected',
      verifiedAt: '2026-10-22T00:00:00.000Z',
      verificationEvidence: 'position has been filled',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown status value', () => {
    const result = JobSchema.safeParse({ ...VALID_JOB, status: 'pending' })
    expect(result.success).toBe(false)
  })

  it('accepts a job with extracted requirements and a score', () => {
    const result = JobSchema.safeParse({
      ...VALID_JOB,
      status: 'verified',
      contentHash: 'abc123',
      extractedRequirements: {
        requiredSkills: ['typescript', 'node.js'],
        niceToHaveSkills: ['kubernetes'],
        minExperienceYears: 3,
        workAuthRequirement: 'any',
        remoteType: 'fully_remote',
      },
      extractedAt: '2026-10-24T00:00:00.000Z',
      score: 85,
      scoreBreakdown: {
        workAuthFit: 30,
        remoteFit: 20,
        salaryFit: 20,
        skillMatch: 15,
        locationFit: 0,
      },
      scoredAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects extracted requirements with an unknown workAuthRequirement value', () => {
    const result = JobSchema.safeParse({
      ...VALID_JOB,
      extractedRequirements: {
        requiredSkills: [],
        niceToHaveSkills: [],
        minExperienceYears: null,
        workAuthRequirement: 'sponsored', // not a valid enum value
        remoteType: 'fully_remote',
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a score outside the 0-100 range', () => {
    const result = JobSchema.safeParse({ ...VALID_JOB, score: 150 })
    expect(result.success).toBe(false)
  })
})
