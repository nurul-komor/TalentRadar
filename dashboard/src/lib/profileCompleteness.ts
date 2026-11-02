import type { Profile } from '@job-hunter/shared'

// The Profile schema has 7 user-editable fields, but preferences.remoteOnly is a boolean
// with a default — it always holds a meaningful value, so it can never be "incomplete"
// and isn't counted toward the completeness score. That leaves 6 fields that can be empty.
const PROFILE_COMPLETENESS_FIELD_COUNT = 6

function countFilledProfileFields(profile: Profile): number {
  const checks = [
    profile.eligibility.workAuthorization !== 'unknown',
    profile.eligibility.countries.length > 0,
    profile.preferences.targetRoles.length > 0,
    profile.preferences.minSalaryUsd != null,
    profile.preferences.locations.length > 0,
    Boolean(profile.cvText?.trim()),
  ]
  return checks.filter(Boolean).length
}

export function profileCompletenessPercent(profile: Profile): number {
  return Math.round((countFilledProfileFields(profile) / PROFILE_COMPLETENESS_FIELD_COUNT) * 100)
}
