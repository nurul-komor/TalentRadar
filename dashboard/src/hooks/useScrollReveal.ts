import { useEffect, useRef } from 'react'
import { gsap, ScrollTrigger } from '../lib/gsap'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface ScrollRevealOptions {
  selector: string
  y?: number
  stagger?: number
  start?: string
}

export function useScrollReveal<T extends HTMLElement>({
  selector,
  y = 32,
  stagger = 0.08,
  start = 'top 80%',
}: ScrollRevealOptions) {
  const containerRef = useRef<T | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (prefersReducedMotion()) return

    const ctx = gsap.context(() => {
      gsap.from(selector, {
        opacity: 0,
        y,
        duration: 0.6,
        stagger,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: container,
          start,
        },
      })
    }, container)

    return () => ctx.revert()
  }, [selector, y, stagger, start])

  return containerRef
}

export function refreshScrollTriggers() {
  ScrollTrigger.refresh()
}
