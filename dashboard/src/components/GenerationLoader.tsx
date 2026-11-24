import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

// Fullscreen "stepped checklist" preloader shown while a résumé or cover letter
// is being generated from a job. The generation API is a single request with no
// progress events, so the steps advance on a timer purely for feedback; when the
// request finishes (open → false) every step snaps to done and the overlay fades.
const STEPS: Record<'cv' | 'cover', string[]> = {
  cv: [
    'Reading your profile',
    'Analyzing the job description',
    'Matching your experience',
    'Tailoring your résumé',
    'Optimizing for ATS',
    'Formatting the document',
  ],
  cover: [
    'Reading your profile',
    'Analyzing the job description',
    'Finding the strongest angle',
    'Drafting your cover letter',
    'Polishing the tone',
    'Finalizing',
  ],
}

// Roughly how long a generation takes end to end. Both kinds go through the same
// `/generate` endpoint, which runs up to two full LLM drafts plus a skill-audit
// pass, so the steps are paced to span this window instead of racing through on
// a fixed interval and then sitting frozen on the last step. If the request
// finishes sooner the loader snaps to done; if it runs longer it holds on the
// final step until the request actually resolves.
const ESTIMATED_MS = 15_000

// Ease-out so the first steps feel responsive while later ones stretch out,
// keeping the final step from being reached too early.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// Cumulative time (ms from start) at which each step i becomes active, spread
// across ESTIMATED_MS. Step 0 is shown immediately; the last step is never
// auto-reached on the timer — it's held for the request to resolve.
function stepSchedule(count: number): number[] {
  const times: number[] = []
  for (let i = 1; i < count; i++) {
    times.push(Math.round(ESTIMATED_MS * easeOutCubic(i / count)))
  }
  return times
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function GenerationLoader({ open, kind }: { open: boolean; kind: 'cv' | 'cover' }) {
  const steps = STEPS[kind]
  // `visible` outlives `open` by one short "all done" beat so the final check and
  // the fade-out can play after the request resolves.
  const [visible, setVisible] = useState(false)
  const [active, setActive] = useState(0)
  const [closing, setClosing] = useState(false)
  const timers = useRef<number[]>([])

  // Begin: reveal and cycle steps while the request is in flight.
  useEffect(() => {
    if (!open) return
    setVisible(true)
    setClosing(false)
    if (prefersReducedMotion()) {
      // No auto-advance under reduced motion — show the whole list, last step active.
      setActive(steps.length - 1)
      return
    }
    setActive(0)
    // Schedule each step to appear at its point in the estimated generation
    // window; the last step is intentionally left for the request to resolve.
    timers.current = stepSchedule(steps.length).map((at, i) =>
      window.setTimeout(() => setActive(i + 1), at),
    )
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
  }, [open, steps.length])

  // Finish: when the request resolves, mark every step done, then fade out.
  useEffect(() => {
    if (open || !visible) return
    setClosing(true)
    setActive(steps.length)
    const id = window.setTimeout(() => setVisible(false), 650)
    return () => window.clearTimeout(id)
  }, [open, visible, steps.length])

  if (!visible) return null

  return (
    <div className="gen-loader" role="status" aria-live="polite" data-closing={closing || undefined}>
      <div className="gen-loader__inner">
        <ul className="gen-loader__list">
          {steps.map((label, i) => {
            const state = i < active ? 'done' : i === active ? 'active' : 'todo'
            return (
              <li key={label} className="gen-loader__step" data-state={state}>
                <span className="gen-loader__glow" aria-hidden="true" />
                <Icon
                  className="gen-loader__icon"
                  name={state === 'todo' ? 'ellipse-outline' : 'checkmark-circle'}
                  size={20}
                />
                <span className="gen-loader__label">{label}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
