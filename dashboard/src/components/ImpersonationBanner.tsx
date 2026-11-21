import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Icon } from './Icon'

// Shown on every page while an admin is impersonating another user ("login as user"). Lets the
// admin see whose account they're viewing and restore their own session in one click.
export function ImpersonationBanner() {
  const { impersonating, email, stopImpersonating } = useAuth()
  const navigate = useNavigate()
  const [returning, setReturning] = useState(false)

  if (!impersonating) return null

  async function handleReturn() {
    setReturning(true)
    try {
      await stopImpersonating()
      navigate('/admin')
    } finally {
      setReturning(false)
    }
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex animate-in fade-in slide-in-from-top-2 items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 duration-300"
    >
      <Icon name="eye-outline" size={16} className="shrink-0" />
      <span className="truncate">
        Viewing as <span className="font-semibold">{email ?? 'user'}</span>
      </span>
      <button
        type="button"
        onClick={handleReturn}
        disabled={returning}
        className="shrink-0 rounded-md bg-amber-950/10 px-3 py-1 font-semibold transition-colors hover:bg-amber-950/20 disabled:opacity-60"
      >
        {returning ? 'Returning…' : 'Return to admin'}
      </button>
    </div>
  )
}
