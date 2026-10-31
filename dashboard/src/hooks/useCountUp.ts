import { useEffect, useState } from 'react'
import { gsap } from '../lib/gsap'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useCountUp(target: number | null, duration = 1.2): number {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (target === null) return

    if (prefersReducedMotion()) {
      setValue(target)
      return
    }

    const counter = { value: 0 }
    const tween = gsap.to(counter, {
      value: target,
      duration,
      ease: 'power2.out',
      onUpdate: () => setValue(Math.round(counter.value)),
    })

    return () => {
      tween.kill()
    }
  }, [target, duration])

  return value
}
