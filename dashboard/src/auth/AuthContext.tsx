import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch, getToken, setToken, clearToken } from '../api/client'
import { isAdmin } from '../lib/syncAccess'

// "Skip for now" is a soft bypass: it lets the user into the app without
// finishing onboarding. We persist it per-browser so the gate doesn't nag on
// every navigation, and clear it on logout so the next account starts fresh.
const ONBOARDING_SKIP_KEY = 'onboardingSkipped'

function readSkip(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SKIP_KEY) === 'true'
  } catch {
    return false
  }
}

// Read the `act` (impersonated-by) claim straight off the JWT. We only decode — never verify —
// the payload here; it's purely to drive the "Return to admin" banner. The API is the source of
// truth and re-checks the claim on every request.
function readImpersonatedBy(token: string | null): string | null {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { act?: unknown }
    return typeof payload.act === 'string' ? payload.act : null
  } catch {
    return null
  }
}

interface AuthContextValue {
  isAuthenticated: boolean
  isAdmin: boolean
  email: string | null
  onboardingCompleted: boolean
  onboardingSkipped: boolean
  profileLoading: boolean
  /** True while the session is an admin "login as user" impersonation. */
  impersonating: boolean
  login: (token: string) => void
  logout: () => void
  refreshProfile: () => Promise<void>
  skipOnboarding: () => void
  /** End an impersonation session and restore the admin's own account. */
  stopImpersonating: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken())
  const [email, setEmail] = useState<string | null>(null)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false)
  const [onboardingSkipped, setOnboardingSkipped] = useState(() => readSkip())
  const [profileLoading, setProfileLoading] = useState(() => getToken() !== null)

  const login = useCallback((newToken: string) => {
    setToken(newToken)
    setTokenState(newToken)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    try {
      localStorage.removeItem(ONBOARDING_SKIP_KEY)
    } catch {
      // ignore storage failures (e.g. private mode)
    }
    setTokenState(null)
    setEmail(null)
    setOnboardingCompleted(false)
    setOnboardingSkipped(false)
  }, [])

  const stopImpersonating = useCallback(async () => {
    const res = await apiFetch('/auth/stop-impersonate', { method: 'POST' })
    if (!res.ok) return
    const { token: adminToken } = (await res.json()) as { token: string }
    setToken(adminToken)
    setTokenState(adminToken)
  }, [])

  const skipOnboarding = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_SKIP_KEY, 'true')
    } catch {
      // ignore storage failures; the in-memory flag still lets them through
    }
    setOnboardingSkipped(true)
  }, [])

  const loadProfile = useCallback(async () => {
    setProfileLoading(true)
    try {
      const res = await apiFetch('/profile')
      const profile = res.ok ? await res.json() : null
      setEmail(profile?.email ?? null)
      setOnboardingCompleted(profile?.onboardingCompletedAt != null)
    } catch {
      setEmail(null)
      setOnboardingCompleted(false)
    } finally {
      setProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setProfileLoading(false)
      return
    }
    void loadProfile()
  }, [token, loadProfile])

  const value = useMemo(
    () => ({
      isAuthenticated: token !== null,
      isAdmin: isAdmin(email),
      email,
      onboardingCompleted,
      onboardingSkipped,
      profileLoading,
      impersonating: readImpersonatedBy(token) !== null,
      login,
      logout,
      refreshProfile: loadProfile,
      skipOnboarding,
      stopImpersonating,
    }),
    [
      token,
      email,
      onboardingCompleted,
      onboardingSkipped,
      profileLoading,
      login,
      logout,
      loadProfile,
      skipOnboarding,
      stopImpersonating,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
