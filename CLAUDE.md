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
