import { describe, it, expect } from 'vitest'
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  ProfileSchema,
  ProfileUpdateSchema,
} from '../src/index'

describe('auth schemas', () => {
  it('accepts a valid register request', () => {
    const result = RegisterRequestSchema.safeParse({
      email: 'a@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a password shorter than 8 characters', () => {
    const result = RegisterRequestSchema.safeParse({
      email: 'a@example.com',
      password: 'short',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email on login', () => {
    const result = LoginRequestSchema.safeParse({
      email: 'not-an-email',
      password: 'whatever',
    })
    expect(result.success).toBe(false)
  })
})

describe('profile schemas', () => {
  it('accepts a full profile with defaults applied to preferences', () => {
    const result = ProfileSchema.safeParse({
      email: 'a@example.com',
      eligibility: { workAuthorization: 'unknown', countries: [] },
      preferences: {},
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.preferences.remoteOnly).toBe(true)
      expect(result.data.preferences.targetRoles).toEqual([])
    }
  })

  it('rejects an unknown workAuthorization enum value', () => {
    const result = ProfileSchema.safeParse({
      email: 'a@example.com',
      eligibility: { workAuthorization: 'alien', countries: [] },
      preferences: {},
    })
    expect(result.success).toBe(false)
  })

  it('allows a partial update with only preferences', () => {
    const result = ProfileUpdateSchema.safeParse({
      preferences: { targetRoles: ['Software Engineer'] },
    })
    expect(result.success).toBe(true)
  })
})
