import { describe, it, expect } from 'vitest'
import { createAuthToken, verifyAuthToken } from '../src/lib/jwt'

describe('auth tokens', () => {
  const secret = 'test-secret'

  it('round-trips a profile id through sign and verify', async () => {
    const token = await createAuthToken('profile-123', secret)
    const payload = await verifyAuthToken(token, secret)
    expect(payload.sub).toBe('profile-123')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await createAuthToken('profile-123', secret)
    await expect(verifyAuthToken(token, 'wrong-secret')).rejects.toThrow()
  })
})
