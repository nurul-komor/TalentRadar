import type { Profile, Resume } from '@job-hunter/shared'

// Canonical required-field set for a complete profile. This is the single
// source of truth shared by the Profile page checklist and the Dashboard /
// sidebar completeness ring, so all three always report the same number.
// It mirrors the required fields the onboarding wizard enforces (and that flip
// onboardingCompletedAt once satisfied) — résumé personal/links/experience/
// education/skills plus an uploaded CV.
export type ProfileCheckKey =
  | 'fullName'
  | 'phone'
  | 'country'
  | 'city'
  | 'linkedin'
  | 'github'
  | 'cv'
  | 'experience'
  | 'education'
  | 'skills'

export interface ProfileCheck {
  key: ProfileCheckKey
  done: boolean
}

export function profileRequiredChecks(resume: Resume, cvText: string | null): ProfileCheck[] {
  return [
    { key: 'fullName', done: !!resume.fullName?.trim() },
    { key: 'phone', done: !!resume.phone?.trim() },
    { key: 'country', done: !!resume.location.country?.trim() },
    { key: 'city', done: !!resume.location.city?.trim() },
    { key: 'linkedin', done: !!resume.linkedin?.trim() },
    { key: 'github', done: !!resume.github?.trim() },
    { key: 'cv', done: cvText != null },
    { key: 'experience', done: resume.experience.length > 0 },
    { key: 'education', done: resume.education.length > 0 },
    { key: 'skills', done: resume.skillGroups.some((g) => g.skills.length > 0) },
  ]
}

export function profileCompletenessPercent(profile: Profile): number {
  const checks = profileRequiredChecks(profile.resume, profile.cvText ?? null)
  const doneCount = checks.filter((c) => c.done).length
  return Math.round((doneCount / checks.length) * 100)
}
