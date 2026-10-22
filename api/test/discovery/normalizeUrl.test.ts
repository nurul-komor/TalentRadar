import { describe, it, expect } from 'vitest'
import { normalizeUrl } from '../../src/discovery/normalizeUrl'

describe('normalizeUrl', () => {
  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://ExAmple.COM/jobs/1')).toBe('https://example.com/jobs/1')
  })

  it('strips query parameters', () => {
    expect(normalizeUrl('https://example.com/jobs/1?utm_source=feed')).toBe(
      'https://example.com/jobs/1'
    )
  })

  it('strips a trailing slash', () => {
    expect(normalizeUrl('https://example.com/jobs/1/')).toBe('https://example.com/jobs/1')
  })

  it('keeps a bare root path as-is', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('strips the hash fragment', () => {
    expect(normalizeUrl('https://example.com/jobs/1#apply')).toBe('https://example.com/jobs/1')
  })
})
