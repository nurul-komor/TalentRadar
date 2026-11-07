import { useEffect, useRef, useState } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { DashboardSidebar, DashboardMobileNav, DashboardMobileHeader } from './DashboardSidebar'

// Cross-fades the routed page on navigation: the outgoing page blurs/fades out,
// then the incoming page blurs/fades in. We snapshot the outlet element so the
// old page stays mounted through its exit animation before the swap.
function AnimatedOutlet() {
  const location = useLocation()
  const outlet = useOutlet()
  const [display, setDisplay] = useState({ outlet, key: location.pathname })
  const [stage, setStage] = useState<'entering' | 'leaving'>('entering')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (location.pathname !== display.key) setStage('leaving')
  }, [location.pathname, display.key])

  return (
    <div
      ref={containerRef}
      className={`page-transition ${stage === 'leaving' ? 'is-leaving' : 'is-entering'}`}
      onAnimationEnd={(event) => {
        // Ignore animations bubbling up from children.
        if (event.target !== containerRef.current) return
        if (stage === 'leaving') {
          setDisplay({ outlet, key: location.pathname })
          setStage('entering')
        }
      }}
    >
      {display.outlet}
    </div>
  )
}

export function DashboardLayout() {
  return (
    <div className="app-shell">
      <DashboardSidebar />
      <DashboardMobileHeader />
      <DashboardMobileNav />
      <main className="app-main">
        <AnimatedOutlet />
      </main>
    </div>
  )
}
