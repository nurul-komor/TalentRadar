import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch, getToken, setToken, clearToken } from '../api/client'

const ADMIN_EMAIL = 'nurulkomor123@gmail.com'

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

interface AuthContextValue {
  isAuthenticated: boolean
  isAdmin: boolean
  email: string | null
  onboardingCompleted: boolean
  onboardingSkipped: boolean
  profileLoading: boolean
  login: (token: string) => void
  logout: () => void
  refreshProfile: () => Promise<void>
  skipOnboarding: () => void
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
      isAdmin: email === ADMIN_EMAIL,
      email,
      onboardingCompleted,
      onboardingSkipped,
      profileLoading,
      login,
      logout,
      refreshProfile: loadProfile,
      skipOnboarding,
    }),
    [token, email, onboardingCompleted, onboardingSkipped, profileLoading, login, logout, loadProfile, skipOnboarding]
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
