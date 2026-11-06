import type { Job, Profile } from '@job-hunter/shared'

// The exact text embedded for a job: title, full description, and extracted required skills
// (when available). Kept as a pure function so the same text feeds both the embed call and
// the sha256 hash that decides whether a re-embed is needed.
export function jobEmbeddingText(job: Pick<Job, 'title' | 'rawDescription' | 'extractedRequirements'>): string {
  const parts = [job.title, job.rawDescription]
  const skills = job.extractedRequirements?.requiredSkills ?? []
  if (skills.length > 0) {
    parts.push(`Required skills: ${skills.join(', ')}`)
  }
  return parts.filter(Boolean).join('\n\n').trim()
}

// The text embedded for a profile: the structured resume's headline/summary and every skill,
// plus the parsed cvText. Falls back to cvText alone when the structured resume is empty.
export function profileEmbeddingText(profile: Pick<Profile, 'resume' | 'cvText'>): string {
  const parts: string[] = []
  const resume = profile.resume
  if (resume) {
    if (resume.headline) parts.push(resume.headline)
    if (resume.summary) parts.push(resume.summary)
    const skills = (resume.skillGroups ?? []).flatMap((g) => g.skills)
    if (skills.length > 0) parts.push(`Skills: ${skills.join(', ')}`)
  }
  if (profile.cvText) parts.push(profile.cvText)
  return parts.filter(Boolean).join('\n\n').trim()
}
