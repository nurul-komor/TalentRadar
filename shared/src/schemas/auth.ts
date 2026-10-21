import { z } from 'zod'

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>
export type LoginRequest = z.infer<typeof LoginRequestSchema>
