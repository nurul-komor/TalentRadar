const TOKEN_STORAGE_KEY = 'job-hunter-token'

// Decode (never verify) a JWT's `exp` claim and report whether it's in the past.
// The API is the real authority on token validity; this is a client-side shortcut
// so an obviously-expired token logs the user out on load instead of lingering as
// "authenticated" until the next request happens to 401. A token without a readable
// `exp` is treated as still valid — we only act when expiry is certain.
export function isTokenExpired(token: string | null): boolean {
  if (!token) return false
  try {
    const part = token.split('.')[1]
    if (!part) return false
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { exp?: unknown }
    if (typeof payload.exp !== 'number') return false
    // `exp` is in seconds since epoch (RFC 7519).
    return payload.exp * 1000 <= Date.now()
  } catch {
    return false
  }
}

export function getToken(): string | null {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (token && isTokenExpired(token)) {
    clearToken()
    return null
  }
  return token
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
}
