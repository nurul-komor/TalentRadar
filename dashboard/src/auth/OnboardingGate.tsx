import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

// Keeps authenticated users out of the app until onboarding is finished.
// The `/onboarding` route itself lives outside this gate so there's no loop.
export function OnboardingGate() {
  const { onboardingCompleted, onboardingSkipped, profileLoading } = useAuth()
  // Wait for the profile fetch before deciding — otherwise we'd briefly bounce
  // a fully-onboarded user to the wizard while their profile is still loading.
  if (profileLoading) return null
  // "Skip for now" lets the user browse the app without finishing. Generating
  // materials never blocks — the ApplyDrawer nudges them to complete it instead.
  return onboardingCompleted || onboardingSkipped ? <Outlet /> : <Navigate to="/onboarding" replace />
}
