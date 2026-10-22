const USER_AGENT = 'AIRemoteJobHunter/1.0 (+https://github.com/nurul-komor/job-hunter)'
const TIMEOUT_MS = 10_000
const MIN_INTERVAL_MS = 1_000

const lastRequestAtByHost = new Map<string, number>()

async function waitForHostSlot(host: string): Promise<void> {
  const lastRequestAt = lastRequestAtByHost.get(host) ?? 0
  const elapsed = Date.now() - lastRequestAt
  const remaining = MIN_INTERVAL_MS - elapsed
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }
  lastRequestAtByHost.set(host, Date.now())
}

export async function fetchWithPolicy(url: string): Promise<Response> {
  const host = new URL(url).hostname
  await waitForHostSlot(host)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}
