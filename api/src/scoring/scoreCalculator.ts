import type { Job, JobRequirements, Profile, ScoreBreakdown } from '@job-hunter/shared'

type ScoredJob = Pick<Job, 'salaryMin' | 'salaryMax' | 'location'>

function computeWorkAuthFit(requirements: JobRequirements, profile: Profile): number {
  const { workAuthorization } = profile.eligibility

  if (workAuthorization === 'unknown') return 10
  if (workAuthorization === 'citizen' || workAuthorization === 'permanent_resident') return 30

  // workAuthorization === 'visa_required'
  switch (requirements.workAuthRequirement) {
    case 'visa_sponsorship_available':
      return 30
    case 'any':
      return 20
    case 'citizen_only':
      return 0
    case 'unknown':
      return 10
  }
}

function computeRemoteFit(requirements: JobRequirements, profile: Profile): number {
  if (!profile.preferences.remoteOnly) return 20

  switch (requirements.remoteType) {
    case 'fully_remote':
      return 20
    case 'hybrid':
      return 5
    case 'onsite':
      return 0
    case 'unknown':
      return 10
  }
}

function computeSalaryFit(job: ScoredJob, profile: Profile): number {
  const minSalaryUsd = profile.preferences.minSalaryUsd
  if (minSalaryUsd === null) return 20

  const effectiveMax = job.salaryMax ?? job.salaryMin
  if (effectiveMax === null) return 5

  return effectiveMax >= minSalaryUsd ? 20 : 0
}

function computeSkillMatch(requirements: JobRequirements, profile: Profile): number {
  if (requirements.requiredSkills.length === 0) return 10
  if (profile.cvText === null) return 0

  const cvTextLower = profile.cvText.toLowerCase()
  const matchedCount = requirements.requiredSkills.filter((skill) =>
    cvTextLower.includes(skill.toLowerCase())
  ).length

  return Math.round((matchedCount / requirements.requiredSkills.length) * 20)
}

function computeLocationFit(job: ScoredJob, profile: Profile): number {
  const { locations } = profile.preferences
  if (locations.length === 0) return 10
  if (job.location === null) return 5

  const jobLocationLower = job.location.toLowerCase()
  const matches = locations.some((loc) => jobLocationLower.includes(loc.toLowerCase()))
  return matches ? 10 : 0
}

export function computeScore(
  requirements: JobRequirements,
  job: ScoredJob,
  profile: Profile
): { score: number; breakdown: ScoreBreakdown } {
  const breakdown: ScoreBreakdown = {
    workAuthFit: computeWorkAuthFit(requirements, profile),
    remoteFit: computeRemoteFit(requirements, profile),
    salaryFit: computeSalaryFit(job, profile),
    skillMatch: computeSkillMatch(requirements, profile),
    locationFit: computeLocationFit(job, profile),
  }

  const score =
    breakdown.workAuthFit +
    breakdown.remoteFit +
    breakdown.salaryFit +
    breakdown.skillMatch +
    breakdown.locationFit

  return { score, breakdown }
}
