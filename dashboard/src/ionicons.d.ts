// Makes the Ionicons <ion-icon> web component usable in JSX across the app.
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'ion-icon': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          name?: string
          src?: string
          size?: 'small' | 'large'
          // React 18 does not map className -> class on custom elements, so use
          // the `class` attribute directly when styling an <ion-icon>.
          class?: string
        },
        HTMLElement
      >
    }
  }
}

export {}
