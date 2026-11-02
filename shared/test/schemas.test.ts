import { describe, it, expect } from 'vitest'
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  ProfileSchema,
  ProfileUpdateSchema,
  ResumeSchema,
  emptyResume,
  isResumeEmpty,
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

  it('defaults resume to an empty resume when a profile omits it', () => {
    const result = ProfileSchema.safeParse({
      email: 'a@example.com',
      eligibility: { workAuthorization: 'unknown', countries: [] },
      preferences: {},
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.resume).toEqual(emptyResume())
    }
  })

  it('allows a partial update with only resume', () => {
    const result = ProfileUpdateSchema.safeParse({
      resume: { ...emptyResume(), fullName: 'Nadia Rahman' },
    })
    expect(result.success).toBe(true)
  })
})

describe('resume schema', () => {
  it('accepts a fully filled-in resume', () => {
    const result = ResumeSchema.safeParse({
      fullName: 'Nurul Komor',
      headline: 'Full-Stack Developer',
      phone: '+8801860081978',
      links: ['github.com/nurul-komor'],
      summary: 'Full-stack engineer.',
      experience: [
        {
          company: 'wOow Global',
          role: 'Software Engineer',
          startDate: '03/2024',
          endDate: null,
          bullets: ['Built an automation system.'],
        },
      ],
      projects: [
        {
          name: 'wOow CRM',
          url: null,
          role: 'Full Stack Engineer',
          technologies: ['Laravel', 'React.js'],
          bullets: ['Developed lead-management workflows.'],
        },
      ],
      skillGroups: [{ category: 'Programming Languages', skills: ['PHP', 'TypeScript'] }],
      education: [{ institution: 'East Delta University', credential: 'BSc in Computer Science' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an experience entry missing a required field', () => {
    const result = ResumeSchema.safeParse({
      ...emptyResume(),
      experience: [{ company: 'wOow Global', startDate: '03/2024', endDate: null, bullets: [] }],
    })
    expect(result.success).toBe(false)
  })
})

describe('isResumeEmpty', () => {
  it('returns true for a freshly created empty resume', () => {
    expect(isResumeEmpty(emptyResume())).toBe(true)
  })

  it('returns false once a scalar field is filled in', () => {
    expect(isResumeEmpty({ ...emptyResume(), fullName: 'Nurul Komor' })).toBe(false)
  })

  it('returns false once a list field has an entry', () => {
    expect(
      isResumeEmpty({
        ...emptyResume(),
        skillGroups: [{ category: 'Languages', skills: ['TypeScript'] }],
      })
    ).toBe(false)
  })
})
