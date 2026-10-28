# job-hunter

An AI-assisted remote job hunting platform that discovers, verifies, and tracks remote job listings, with a dashboard for managing your search.

## Workspaces

This is an npm workspaces monorepo with three packages:

- **`shared`** — Shared Zod schemas and types (auth, job, profile) used by both the API and dashboard.
- **`api`** — A Hono-based HTTP API backed by MongoDB. Handles authentication, user profiles, job listing discovery/scraping, and verifying job postings against their source pages.
- **`dashboard`** — A React (Vite) single-page app for browsing and managing discovered jobs.

## Development

```bash
npm install
npm run dev
npm run test
npm run build
```
