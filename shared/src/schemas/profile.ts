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

export const ProfileSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  eligibility: EligibilitySchema,
  preferences: ProfilePreferencesSchema,
  cvText: z.string().nullable().default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const ProfileUpdateSchema = z
  .object({
    eligibility: EligibilitySchema,
    preferences: ProfilePreferencesSchema,
  })
  .partial()

export type Eligibility = z.infer<typeof EligibilitySchema>
export type ProfilePreferences = z.infer<typeof ProfilePreferencesSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>
