# Project conventions

## File storage: Cloudinary (global rule)

Any user-uploaded binary (CVs, and future file uploads) MUST be stored in **Cloudinary** — do not persist uploads to local disk or any other store.

- The API reads Cloudinary credentials from env: either `CLOUDINARY_URL`, or `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` (see `api/.env.example`).
- Use the injectable uploader pattern in `api/src/profile/cloudinaryStorage.ts` (`createCloudinaryUploader(env)` → `CvUploader`), mirroring `cvParser`/`resumeExtractor`. Non-image files (PDF/DOCX) upload with `resource_type: 'raw'`.
- Uploading is **best-effort**: when Cloudinary is unconfigured or the upload fails, the request must still succeed with its primary work done (e.g. CV parse/save) — never let storage block the core flow. Persist the returned `{ url, publicId }` on the owning document.


## Styling: Tailwind CSS (global rule)

All new UI development in this project MUST use Tailwind CSS for styling.

- Use Tailwind utility classes in JSX/TSX. Do not add new plain CSS files, CSS modules, inline `style={{...}}` objects, or styled-components for new work — reach for utilities first.
- The `dashboard/` app uses **Tailwind v4** (`@tailwindcss/vite`), wired via `@import 'tailwindcss'` in `dashboard/src/index.css`. There is no `tailwind.config.js` — v4 is config-less by default; put theme tokens/customization in `index.css` with `@theme`.
- **shadcn/ui** is available (`shadcn/tailwind.css`, `tw-animate-css`). Prefer composing existing shadcn components over hand-rolling new ones.
- Use the `@/` path alias for imports (maps to `dashboard/src`).
- Exceptions (e.g. a one-off global style, a third-party integration that needs raw CSS) are allowed only when a utility approach genuinely doesn't fit — call it out when you do.


## No color gradients (global rule)

Do **not** use color gradients anywhere in the UI. Use flat, solid colors.

- No `linear-gradient` / `radial-gradient` / `conic-gradient` as a **color** fill — not for backgrounds, text, borders, buttons, bars, progress fills, glows, highlights, or hover sheens. Use a single solid color (from the design tokens) instead.
- A "glow" is a solid translucent color plus `filter: blur()`, never a gradient.
- **Allowed exceptions** (these are not color gradients): CSS `mask-image` / `-webkit-mask-image` gradients used purely for **transparency fades**, and single-color **pattern** gradients that draw hairline grids or dot grids (e.g. `linear-gradient(var(--line) 1px, transparent 1px)`). Everything that reads as a visible color blend is banned.
- This applies to `index.css`, inline `style`, Tailwind arbitrary values, and SVG `<linearGradient>`/`<radialGradient>` alike.

## Restrained color — no "AI design" rainbow (global rule)

Do **not** use a lot of color. The UI must read as near-monochrome with **a single accent**, the way Apple / Linear / Stripe do — never the over-colored, multi-hue look typical of AI-generated / template design.

- **One accent only.** Reserve the accent color (the project's blue/indigo) for the primary action and the single most important highlight on a surface. Everything else is grayscale: text, borders, cards, icons, bars, badges, chips.
- **No per-item color.** Do not give each item in a list/grid its own color (e.g. a rainbow of source/company badge swatches). Use one neutral treatment — `--surface-2` fill, hairline border, muted text — and let type, spacing, and imagery carry the hierarchy.
- **Status colors are neutral by default.** "Live", "Verified", "Success" etc. render as neutral gray chips/dots, not green/teal/multi-color, unless a single semantic color is genuinely required — and even then, at most one beyond the accent.
- **Progress/score bars** use one solid neutral (`--line-strong` / `--muted-text`) or the single accent — never a different color per row.
- Pair this with the **No color gradients** rule above: flat solid colors only. When in doubt, remove color.

## Corner radii — concentric corners (global rule)

Use a consistent, tiered corner-radius scale, and keep nested corners **concentric**.

- **Scale by element role:** ~**8pt** for small controls (buttons, inputs, chips, non-full-round pills, small icon tiles); ~**12pt** for larger surfaces (cards, sheets, dialogs, popovers, panels). Larger hero/feature surfaces may go bigger, but stay on the scale — don't invent one-off radii.
- **Concentric nesting:** when a rounded element sits inside another, the **inner radius = outer radius − padding** (the gap between them). A child flush inside a card with 16px padding and a 24px outer radius gets an 8px radius, so the corners stay parallel. Never nest a larger radius inside a smaller one.
- **Use the tokens, not literals:** reach for the existing radius tokens in `index.css` (`--card-radius-sm/md/lg`; the `.apple-ui` skin tunes these for the Apple look). Add a token rather than hard-coding a new px value.
- Full-round (`999px`) is reserved for genuinely pill-shaped controls and circular avatars/dots.

## Motion & animation (global rule)

New and updated UI in the `dashboard/` app MUST feel modern and animated. When a surface includes any of the elements below, implement the corresponding motion — don't ship static versions:

- **Page transitions** — smooth entrance (and exit where the router allows) on route changes.
- **Hero / headline sections** — staggered text reveals.
- **Backgrounds** — premium animated gradients on hero/CTA surfaces.
- **Cards** — subtle hover and interaction effects (lift, sheen, arrow nudge).
- **Bookmark / save buttons** — animated toggle (pop/fill).
- **Lists & grids** — smooth filtering and sorting transitions (re-stagger on change).
- **Matching / scoring** — AI job-matching progress animations.
- **Resume / CV** — scanning animations while parsing.
- **Statistics** — animated count-up counters.
- **Loading** — skeleton loading states (never a blank/spinner-only wait where content has shape).
- **Empty states** — animated empty search/filter results.
- **Applications** — success animations on completion.
- **Overlays** — smooth modal, dropdown, and sidebar transitions.
- **Sections** — scroll-triggered reveals.

Implementation conventions:
- Use the existing **GSAP** setup (`dashboard/src/lib/gsap.ts`, with `ScrollTrigger`) and the shared hooks `useScrollReveal`, `useCountUp`. Reuse the design-system motion primitives in `index.css` (`.skeleton`/`.sk`, `scan`, `shimmer` keyframes, the landing "modern motion layer") rather than reinventing them.
- **Every animation MUST be disabled under `prefers-reduced-motion: reduce`** (the hooks already guard this; CSS animations need an explicit guard — see the reduced-motion block at the end of `index.css`).
- Keep motion subtle and performant: animate `transform`/`opacity`/`filter`, favor short durations and eased curves, and never block interaction or content on an animation.
- The Landing page (`dashboard/src/pages/Landing.tsx`) is the reference implementation for all of the above.
