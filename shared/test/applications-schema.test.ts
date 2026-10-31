import { describe, it, expect } from 'vitest'
import { ApplicationSchema, AutomationRunSchema, ApprovalSchema } from '../src/index'

describe('ApplicationSchema', () => {
  const VALID_APPLICATION = {
    jobId: 'remoteok:12345',
    profileId: 'profile-123',
    company: 'Acme',
    title: 'Backend Engineer',
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
  }

  it('accepts a valid draft application', () => {
    expect(ApplicationSchema.safeParse(VALID_APPLICATION).success).toBe(true)
  })

  it('accepts an application with unresolved required answers', () => {
    const result = ApplicationSchema.safeParse({
      ...VALID_APPLICATION,
      requiredAnswers: [{ question: 'Why do you want this role?', answer: null }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown status value', () => {
    const result = ApplicationSchema.safeParse({ ...VALID_APPLICATION, status: 'pending' })
    expect(result.success).toBe(false)
  })
})

describe('AutomationRunSchema', () => {
  it('accepts a valid blocked run', () => {
    const result = AutomationRunSchema.safeParse({
      jobId: 'remoteok:12345',
      runNumber: 1,
      status: 'blocked',
      filledFields: null,
      blockReason: 'captcha',
      manualApplyUrl: 'https://remoteok.com/remote-jobs/12345',
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a runNumber of zero', () => {
    const result = AutomationRunSchema.safeParse({
      jobId: 'remoteok:12345',
      runNumber: 0,
      status: 'claimed',
      filledFields: null,
      blockReason: null,
      manualApplyUrl: null,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('ApprovalSchema', () => {
  it('accepts a valid approval record', () => {
    const result = ApprovalSchema.safeParse({
      jobId: 'remoteok:12345',
      runNumber: 1,
      approvedBy: 'profile-id-123',
      approvedAt: '2026-10-24T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })
})
