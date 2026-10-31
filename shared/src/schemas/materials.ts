import { z } from 'zod'

export const GeneratedContentSchema = z.object({
  unmetRequirements: z.array(z.string()),
  tailoredCv: z.string(),
  coverLetter: z.string(),
  outreachMessage: z.string(),
})

export const MaterialsSchema = GeneratedContentSchema.extend({
  _id: z.string().optional(),
  jobId: z.string(),
  profileId: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
})

export type GeneratedContent = z.infer<typeof GeneratedContentSchema>
export type Materials = z.infer<typeof MaterialsSchema>
