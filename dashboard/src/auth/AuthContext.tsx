import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch, getToken, setToken, clearToken } from '../api/client'

const ADMIN_EMAIL = 'nurulkomor123@gmail.com'

interface AuthContextValue {
  isAuthenticated: boolean
  isAdmin: boolean
  email: string | null
  profileLoading: boolean
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken())
  const [email, setEmail] = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(() => getToken() !== null)

  const login = useCallback((newToken: string) => {
    setToken(newToken)
    setTokenState(newToken)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setTokenState(null)
    setEmail(null)
  }, [])

  useEffect(() => {
    if (!token) {
      setProfileLoading(false)
      return
    }
    setProfileLoading(true)
    apiFetch('/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((profile) => setEmail(profile?.email ?? null))
      .catch(() => setEmail(null))
      .finally(() => setProfileLoading(false))
  }, [token])

  const value = useMemo(
    () => ({
      isAuthenticated: token !== null,
      isAdmin: email === ADMIN_EMAIL,
      email,
      profileLoading,
      login,
      logout,
    }),
    [token, email, profileLoading, login, logout]
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
