import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/password'

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('produces a different hash each time due to random salt', async () => {
    const hash1 = await hashPassword('same-password')
    const hash2 = await hashPassword('same-password')
    expect(hash1).not.toBe(hash2)
  })
})
