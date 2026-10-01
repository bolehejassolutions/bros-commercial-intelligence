# BROS Commercial Intelligence (BCI)

Independent internal application for BROS.

## Purpose

BROS Commercial Intelligence is the internal intelligence and decision-support layer for the BROS ecosystem.

It is intentionally independent from customer-facing products such as BROS SELL™ — Closing OS.

## Core model

Evidence → Signal → Case → Diagnosis → Decision → Action → Outcome → Learning

## Boundary

- Internal application
- Not a customer-facing product
- Not a replacement for BROS SELL™
- Not a generic BI dashboard
- Not a CRM
- Not a premature V2 feature set for BROS SELL™

## Initial direction

BCI should help BROS understand commercial conditions, diagnose meaningful problems, support decisions, and capture learning across the ecosystem.

## Repository status

Architecture bootstrap / initial implementation.

## Development tooling

This repository uses npm, with npm 11.9.0 recorded in `packageManager`.
Use Node.js 22.9.0 or newer: the resolved Supabase client requires >=22.0.0 and npm 11 requires >=22.9.0.
The npm-generated lockfile records the dependency state resolved within the
existing application version ranges, except for the approved SSR compatibility
upgrade. `@supabase/ssr` is pinned to 0.10.3 to support the existing two-argument
`setAll(cookiesToSet, headers)` callbacks; `@supabase/supabase-js` is pinned to
2.117.2. Authentication callbacks and database migrations are unchanged.
The TypeScript `@/*` alias and logout import target were corrected so the
existing implementation builds. Next.js generated the JSX/type configuration
updates during build verification.

```sh
npm ci
npm run lint
npm run build
npm run dev
```

Commit `package.json` and `package-lock.json` together when changing
dependencies. Use `npm ci` for verification and deployment; use `npm install`
only to intentionally update the dependency state. Do not add other package
manager lockfiles.

Lint uses the ESLint CLI with Next.js Core Web Vitals and TypeScript flat
configs. Existing untyped database record findings are scoped to warnings in
`eslint.config.mjs` so this maintenance does not rewrite the application.
These warnings remain follow-up work. Production builds still check types.
ESLint 9 matches the React/import/accessibility plugins' peer ranges; its npm
end-of-support warning remains until those plugins support ESLint 10.

For local runtime access, supply `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in an untracked `.env.local`.
