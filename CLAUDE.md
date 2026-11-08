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
