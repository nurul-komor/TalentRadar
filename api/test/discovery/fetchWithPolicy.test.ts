import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWithPolicy } from '../../src/discovery/fetchWithPolicy'

describe('fetchWithPolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends a named User-Agent header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await fetchWithPolicy('https://ua-header-test.com/a')

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)['User-Agent']).toContain(
      'AIRemoteJobHunter'
    )
  })

  it('aborts the request if it exceeds the timeout', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = fetchWithPolicy('https://abort-timeout-test.com/b')
    const expectation = expect(resultPromise).rejects.toThrow('aborted')
    await vi.advanceTimersByTimeAsync(10_001)

    await expectation
  })

  it('throttles back-to-back requests to the same host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const first = fetchWithPolicy('https://throttle-test.com/a')
    await vi.advanceTimersByTimeAsync(0)
    await first

    const secondPromise = fetchWithPolicy('https://throttle-test.com/b')
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(600)
    await secondPromise
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
