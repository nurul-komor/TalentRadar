import { z } from 'zod'

export const EligibilitySchema = z.object({
  workAuthorization: z.enum(['citizen', 'permanent_resident', 'visa_required', 'unknown']),
  countries: z.array(z.string()).default([]),
})

export const ProfilePreferencesSchema = z.object({
  targetRoles: z.array(z.string()).default([]),
  remoteOnly: z.boolean().default(true),
  minSalaryUsd: z.number().int().nonnegative().nullable().default(null),
  locations: z.array(z.string()).default([]),
})

export const ResumeExperienceSchema = z.object({
  company: z.string(),
  role: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  bullets: z.array(z.string()).default([]),
})

export const ResumeProjectSchema = z.object({
  name: z.string(),
  url: z.string().nullable(),
  role: z.string(),
  technologies: z.array(z.string()).default([]),
  bullets: z.array(z.string()).default([]),
})

export const ResumeSkillGroupSchema = z.object({
  category: z.string(),
  skills: z.array(z.string()).default([]),
})

export const ResumeEducationSchema = z.object({
  institution: z.string(),
  credential: z.string(),
})

export const ResumeLocationSchema = z.object({
  country: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
})

export function emptyLocation(): ResumeLocation {
  return { country: null, city: null }
}

export const ResumeSchema = z.object({
  fullName: z.string().nullable().default(null),
  headline: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  location: ResumeLocationSchema.default(emptyLocation),
  linkedin: z.string().nullable().default(null),
  github: z.string().nullable().default(null),
  links: z.array(z.string()).default([]),
  summary: z.string().nullable().default(null),
  experience: z.array(ResumeExperienceSchema).default([]),
  projects: z.array(ResumeProjectSchema).default([]),
  skillGroups: z.array(ResumeSkillGroupSchema).default([]),
  education: z.array(ResumeEducationSchema).default([]),
})

export function emptyResume(): Resume {
  return {
    fullName: null,
    headline: null,
    phone: null,
    location: emptyLocation(),
    linkedin: null,
    github: null,
    links: [],
    summary: null,
    experience: [],
    projects: [],
    skillGroups: [],
    education: [],
  }
}

export function isResumeEmpty(resume: Resume): boolean {
  return (
    resume.fullName === null &&
    resume.headline === null &&
    resume.phone === null &&
    resume.location.country === null &&
    resume.location.city === null &&
    resume.linkedin === null &&
    resume.github === null &&
    resume.links.length === 0 &&
    resume.summary === null &&
    resume.experience.length === 0 &&
    resume.projects.length === 0 &&
    resume.skillGroups.length === 0 &&
    resume.education.length === 0
  )
}

export const ProfileSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  eligibility: EligibilitySchema,
  preferences: ProfilePreferencesSchema,
  cvText: z.string().nullable().default(null),
  // The original uploaded CV binary, stored in Cloudinary. cvText is still the
  // parsed text used for scoring; these point at the source file for download.
  // Optional (not defaulted) because profiles created before this existed, and
  // profiles uploaded while Cloudinary is unconfigured, simply won't have them.
  cvFileUrl: z.string().nullable().optional(),
  cvFilePublicId: z.string().nullable().optional(),
  resume: ResumeSchema.default(emptyResume),
  onboardingCompletedAt: z.string().nullable().default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const ProfileUpdateSchema = z
  .object({
    eligibility: EligibilitySchema,
    preferences: ProfilePreferencesSchema,
    resume: ResumeSchema,
    onboardingCompletedAt: z.string().nullable(),
  })
  .partial()

export type Eligibility = z.infer<typeof EligibilitySchema>
export type ProfilePreferences = z.infer<typeof ProfilePreferencesSchema>
export type ResumeExperience = z.infer<typeof ResumeExperienceSchema>
export type ResumeProject = z.infer<typeof ResumeProjectSchema>
export type ResumeSkillGroup = z.infer<typeof ResumeSkillGroupSchema>
export type ResumeEducation = z.infer<typeof ResumeEducationSchema>
export type ResumeLocation = z.infer<typeof ResumeLocationSchema>
export type Resume = z.infer<typeof ResumeSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>
