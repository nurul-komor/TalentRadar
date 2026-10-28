import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function AdminRoute() {
  const { isAdmin, profileLoading } = useAuth()
  if (profileLoading) return null
  return isAdmin ? <Outlet /> : <Navigate to="/jobs" replace />
}
