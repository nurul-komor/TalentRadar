import { describe, it, expect, vi, afterEach } from 'vitest'
import { pageEvidenceVerifier } from '../../src/verification/pageEvidenceVerifier'

describe('pageEvidenceVerifier', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects immediately on a 404 without reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))

    const outcome = await pageEvidenceVerifier('https://verify-404.test/job/1')

    expect(outcome).toEqual({ status: 'rejected', httpStatus: 404, evidence: 'HTTP 404' })
  })

  it('rejects immediately on a 410', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 410 })))

    const outcome = await pageEvidenceVerifier('https://verify-410.test/job/1')

    expect(outcome).toEqual({ status: 'rejected', httpStatus: 410, evidence: 'HTTP 410' })
  })

  it('is inconclusive on a non-2xx, non-gone status, without reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    const outcome = await pageEvidenceVerifier('https://verify-503.test/job/1')

    expect(outcome).toEqual({ status: 'inconclusive', httpStatus: 503, evidence: 'HTTP 503' })
  })

  it('verifies on a 200 page with positive evidence', async () => {
    const html = '<html><body><h1>Apply Now</h1></body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })))

    const outcome = await pageEvidenceVerifier('https://verify-apply.test/job/1')

    expect(outcome).toEqual({ status: 'verified', httpStatus: 200, evidence: 'apply now' })
  })

  it('rejects on a 200 page with negative evidence', async () => {
    const html = '<html><body><p>This position has been filled.</p></body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })))

    const outcome = await pageEvidenceVerifier('https://verify-filled.test/job/1')

    expect(outcome).toEqual({ status: 'rejected', httpStatus: 200, evidence: 'position has been filled' })
  })

  it('is inconclusive on a 200 page with neither positive nor negative evidence', async () => {
    const html = '<html><body><p>A generic page.</p></body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })))

    const outcome = await pageEvidenceVerifier('https://verify-generic.test/job/1')

    expect(outcome).toEqual({ status: 'inconclusive', httpStatus: 200, evidence: null })
  })

  it('is inconclusive when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')))

    const outcome = await pageEvidenceVerifier('https://verify-network-error.test/job/1')

    expect(outcome).toEqual({ status: 'inconclusive', httpStatus: null, evidence: 'network unreachable' })
  })
})
