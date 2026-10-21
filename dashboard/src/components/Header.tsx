import { useAuth } from '../auth/AuthContext'
import { Button } from './Button'

export function Header() {
  const { logout } = useAuth()
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <span className="text-lg font-semibold text-slate-900">AI Remote Job Hunter</span>
        <Button variant="secondary" onClick={logout}>
          Log out
        </Button>
      </div>
    </header>
  )
}
