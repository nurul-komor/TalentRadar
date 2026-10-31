import { describe, it, expect } from 'vitest'
import { MaterialsSchema, GeneratedContentSchema } from '../src/index'

const VALID_CONTENT = {
  unmetRequirements: ['5+ years Kubernetes experience'],
  tailoredCv: 'Tailored CV text...',
  coverLetter: 'Dear hiring manager...',
  outreachMessage: 'Hi, I noticed your posting...',
}

describe('GeneratedContentSchema', () => {
  it('accepts a valid generated content object', () => {
    expect(GeneratedContentSchema.safeParse(VALID_CONTENT).success).toBe(true)
  })

  it('rejects content missing the outreach message', () => {
    const { outreachMessage, ...withoutOutreach } = VALID_CONTENT
    expect(GeneratedContentSchema.safeParse(withoutOutreach).success).toBe(false)
  })
})

describe('MaterialsSchema', () => {
  it('accepts a valid stored materials document', () => {
    const result = MaterialsSchema.safeParse({
      ...VALID_CONTENT,
      jobId: 'remoteok:12345',
      profileId: 'profile-123',
      version: 1,
      createdAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a version that is not a positive integer', () => {
    const result = MaterialsSchema.safeParse({
      ...VALID_CONTENT,
      jobId: 'remoteok:12345',
      version: 0,
      createdAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})
