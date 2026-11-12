import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

// Keeps authenticated users out of the app until onboarding is finished.
// The `/onboarding` route itself lives outside this gate so there's no loop.
export function OnboardingGate() {
  const { onboardingCompleted, onboardingSkipped, profileLoading, refreshProfile } = useAuth()
  const [revalidated, setRevalidated] = useState(false)

  // "Skip for now" lets the user browse the app without finishing. Generating
  // materials never blocks — the ApplyDrawer nudges them to complete it instead.
  const settled = onboardingCompleted || onboardingSkipped

  // The cached `onboardingCompleted` flag is loaded once per token and can be
  // stale: a failed initial /profile fetch defaults it to false, and another
  // tab/device can complete onboarding without us knowing. Before bouncing a
  // supposedly-unonboarded user to the wizard (which would just re-fetch and
  // bounce them straight back to /jobs), confirm against a fresh profile.
  useEffect(() => {
    if (profileLoading || settled || revalidated) return
    setRevalidated(true)
    void refreshProfile()
  }, [profileLoading, settled, revalidated, refreshProfile])

  // Wait for the profile fetch (initial or the confirming re-fetch) before
  // deciding — otherwise we'd briefly bounce a fully-onboarded user to the wizard.
  if (profileLoading) return null
  if (settled) return <Outlet />
  // Hold the render until the confirming fetch has run at least once.
  if (!revalidated) return null
  return <Navigate to="/onboarding" replace />
}
