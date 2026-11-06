import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Resets scroll to the top on every route change. Paired with
// `history.scrollRestoration = 'manual'` (set in main.tsx) this keeps the
// browser from restoring a stale scroll offset after async page content loads.
// Runs in a layout effect so the reset happens before paint — no visible jump.
export function ScrollToTop() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}
