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

export const ResumeSchema = z.object({
  fullName: z.string().nullable().default(null),
  headline: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
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
    links: [],
    summary: null,
    experience: [],
    projects: [],
    skillGroups: [],
    education: [],
  }
}

export const ProfileSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  eligibility: EligibilitySchema,
  preferences: ProfilePreferencesSchema,
  cvText: z.string().nullable().default(null),
  resume: ResumeSchema.default(emptyResume),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const ProfileUpdateSchema = z
  .object({
    eligibility: EligibilitySchema,
    preferences: ProfilePreferencesSchema,
    resume: ResumeSchema,
  })
  .partial()

export type Eligibility = z.infer<typeof EligibilitySchema>
export type ProfilePreferences = z.infer<typeof ProfilePreferencesSchema>
export type ResumeExperience = z.infer<typeof ResumeExperienceSchema>
export type ResumeProject = z.infer<typeof ResumeProjectSchema>
export type ResumeSkillGroup = z.infer<typeof ResumeSkillGroupSchema>
export type ResumeEducation = z.infer<typeof ResumeEducationSchema>
export type Resume = z.infer<typeof ResumeSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>
