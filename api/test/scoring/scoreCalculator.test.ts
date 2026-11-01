import { describe, it, expect } from 'vitest'
import { computeScore } from '../../src/scoring/scoreCalculator'
import type { JobRequirements, Profile } from '@job-hunter/shared'
import { emptyResume } from '@job-hunter/shared'

const BASE_REQUIREMENTS: JobRequirements = {
  requiredSkills: [],
  niceToHaveSkills: [],
  minExperienceYears: null,
  workAuthRequirement: 'any',
  remoteType: 'fully_remote',
}

const BASE_JOB = { salaryMin: null, salaryMax: null, location: null }

function baseProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    email: 'user@example.com',
    eligibility: { workAuthorization: 'citizen', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: null,
    resume: emptyResume(),
    ...overrides,
  }
}

describe('computeScore — workAuthFit', () => {
  it('gives full work-auth credit to a citizen regardless of the job requirement', () => {
    const { breakdown } = computeScore(
      { ...BASE_REQUIREMENTS, workAuthRequirement: 'citizen_only' },
      BASE_JOB,
      baseProfile({ eligibility: { workAuthorization: 'citizen', countries: [] } })
    )
    expect(breakdown.workAuthFit).toBe(30)
  })

  it('gives zero work-auth credit when the candidate needs a visa and the job is citizen-only', () => {
    const { breakdown } = computeScore(
      { ...BASE_REQUIREMENTS, workAuthRequirement: 'citizen_only' },
      BASE_JOB,
      baseProfile({ eligibility: { workAuthorization: 'visa_required', countries: [] } })
    )
    expect(breakdown.workAuthFit).toBe(0)
  })

  it('pulls the work-auth score down when the candidate eligibility itself is unknown', () => {
    const { breakdown } = computeScore(
      BASE_REQUIREMENTS,
      BASE_JOB,
      baseProfile({ eligibility: { workAuthorization: 'unknown', countries: [] } })
    )
    expect(breakdown.workAuthFit).toBe(10)
  })
})

describe('computeScore — remoteFit', () => {
  it('gives full remote credit when remoteOnly is false, regardless of job remoteType', () => {
    const { breakdown } = computeScore(
      { ...BASE_REQUIREMENTS, remoteType: 'onsite' },
      BASE_JOB,
      baseProfile({ preferences: { targetRoles: [], remoteOnly: false, minSalaryUsd: null, locations: [] } })
    )
    expect(breakdown.remoteFit).toBe(20)
  })

  it('gives zero remote credit for an onsite job when the candidate wants remote only', () => {
    const { breakdown } = computeScore(
      { ...BASE_REQUIREMENTS, remoteType: 'onsite' },
      BASE_JOB,
      baseProfile()
    )
    expect(breakdown.remoteFit).toBe(0)
  })
})

describe('computeScore — salaryFit', () => {
  it('gives full salary credit when the candidate has no minimum salary preference', () => {
    const { breakdown } = computeScore(BASE_REQUIREMENTS, BASE_JOB, baseProfile())
    expect(breakdown.salaryFit).toBe(20)
  })

  it('pulls the salary score down when the job salary is undisclosed but the candidate has a minimum', () => {
    const { breakdown } = computeScore(
      BASE_REQUIREMENTS,
      BASE_JOB,
      baseProfile({ preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: 100000, locations: [] } })
    )
    expect(breakdown.salaryFit).toBe(5)
  })

  it('gives full salary credit when the job salary meets the minimum', () => {
    const { breakdown } = computeScore(
      BASE_REQUIREMENTS,
      { ...BASE_JOB, salaryMax: 120000 },
      baseProfile({ preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: 100000, locations: [] } })
    )
    expect(breakdown.salaryFit).toBe(20)
  })

  it('gives zero salary credit when the job salary is below the minimum', () => {
    const { breakdown } = computeScore(
      BASE_REQUIREMENTS,
      { ...BASE_JOB, salaryMax: 80000 },
      baseProfile({ preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: 100000, locations: [] } })
    )
    expect(breakdown.salaryFit).toBe(0)
  })
})

describe('computeScore — skillMatch', () => {
  it('gives a neutral skill score when the job lists no required skills', () => {
    const { breakdown } = computeScore(BASE_REQUIREMENTS, BASE_JOB, baseProfile())
    expect(breakdown.skillMatch).toBe(10)
  })

  it('gives zero skill credit when the candidate has no CV text to match against', () => {
    const { breakdown } = computeScore(
      { ...BASE_REQUIREMENTS, requiredSkills: ['typescript'] },
      BASE_JOB,
      baseProfile({ cvText: null })
    )
    expect(breakdown.skillMatch).toBe(0)
  })

  it('awards partial credit proportional to the fraction of required skills found in the CV', () => {
    const { breakdown } = computeScore(
      { ...BASE_REQUIREMENTS, requiredSkills: ['typescript', 'react', 'graphql', 'kubernetes'] },
      BASE_JOB,
      baseProfile({ cvText: 'Experienced with TypeScript and React in production.' })
    )
    expect(breakdown.skillMatch).toBe(10) // 2 of 4 matched = 50% of 20
  })

  it('awards full skill credit when every required skill is found in the CV', () => {
    const { breakdown } = computeScore(
      { ...BASE_REQUIREMENTS, requiredSkills: ['typescript', 'react'] },
      BASE_JOB,
      baseProfile({ cvText: 'Expert in TypeScript and React.' })
    )
    expect(breakdown.skillMatch).toBe(20)
  })
})

describe('computeScore — locationFit', () => {
  it('gives full location credit when the candidate has no location preference', () => {
    const { breakdown } = computeScore(BASE_REQUIREMENTS, BASE_JOB, baseProfile())
    expect(breakdown.locationFit).toBe(10)
  })

  it('gives partial location credit when the job location is unknown', () => {
    const { breakdown } = computeScore(
      BASE_REQUIREMENTS,
      BASE_JOB,
      baseProfile({ preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: ['Germany'] } })
    )
    expect(breakdown.locationFit).toBe(5)
  })

  it('gives full location credit when the job location matches a preferred location', () => {
    const { breakdown } = computeScore(
      BASE_REQUIREMENTS,
      { ...BASE_JOB, location: 'Remote - Germany' },
      baseProfile({ preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: ['Germany'] } })
    )
    expect(breakdown.locationFit).toBe(10)
  })

  it('gives zero location credit when the job location does not match any preferred location', () => {
    const { breakdown } = computeScore(
      BASE_REQUIREMENTS,
      { ...BASE_JOB, location: 'Remote - France' },
      baseProfile({ preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: ['Germany'] } })
    )
    expect(breakdown.locationFit).toBe(0)
  })
})

describe('computeScore — total', () => {
  it('sums all five sub-scores into the total score', () => {
    const { score, breakdown } = computeScore(BASE_REQUIREMENTS, BASE_JOB, baseProfile())
    const expectedTotal =
      breakdown.workAuthFit +
      breakdown.remoteFit +
      breakdown.salaryFit +
      breakdown.skillMatch +
      breakdown.locationFit
    expect(score).toBe(expectedTotal)
  })
})
