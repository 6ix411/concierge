# Concierge by 6IX

A mobile-first marketplace that connects customers with **verified** businesses in Nigeria.
Customers describe what they need to an AI Concierge, which recommends only businesses that are
registered and approved on this platform. After booking, customers and businesses talk directly in a
human-to-human chat; the AI never takes part in that conversation.

## Stack

| Concern      | Choice                                                     |
| ------------ | ---------------------------------------------------------- |
| App          | Next.js 16 (App Router), React 19, TypeScript (strict)     |
| Styling      | Tailwind CSS 4 with design tokens in `src/app/globals.css` |
| Data & auth  | Supabase: Postgres, Auth, Storage, Realtime                |
| AI Concierge | Anthropic API (server-only)                                |
| Payments     | Paystack (default), Flutterwave behind the same interface  |
| Tests        | Vitest + Testing Library                                   |
| Hosting      | Vercel                                                     |

## Getting started

Requirements: Node 22+, and Docker if you want a local Supabase.

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run db:start             # local Supabase (prints the anon and service-role keys)
npm run db:reset             # apply migrations + seed
npm run dev                  # http://localhost:3000
```

## Scripts

| Script             | What it does                                               |
| ------------------ | ---------------------------------------------------------- |
| `npm run dev`      | Development server                                         |
| `npm run build`    | Production build                                           |
| `npm run check`    | Typecheck, lint, format check and tests                    |
| `npm test`         | Unit and component tests                                   |
| `npm run db:types` | Regenerate `src/types/database.ts` from the local database |

## Environments

`APP_ENV` is `development`, `test` or `production`. Next.js loads env files in this order (later wins):

- `.env.development` / `.env.test` / `.env.production`: committed, **non-secret** defaults only.
- `.env.local` (and `.env.*.local`): your secrets, git-ignored.
- In production, set every value in the hosting provider's environment settings.

Rules for secrets:

- Only `NEXT_PUBLIC_*` variables reach the browser. Everything else is server-only.
- Modules that read secrets import `server-only`, so importing them from client code fails the build.
- Env is validated with Zod (`src/lib/env`). Missing or invalid values fail with a list of variable names, never values.
- Test payment keys are rejected when `APP_ENV=production`.

## Folder structure

```
src/
  app/                 Routes (App Router), error/not-found/loading boundaries, API routes
    api/health/        Liveness check
  components/
    ui/                Reusable primitives (Button, Card, Input, Badge)
    layout/            Page chrome (Container, SiteHeader, SiteFooter)
  lib/
    env/               Validated env: schema.ts, server.ts (server-only), client.ts (public)
    errors/            AppError, JSON error responses, logger
    supabase/          Browser, server, admin (service role) and proxy clients
    ai/                Anthropic client for the concierge (server-only)
    payments/          PaymentProvider interface, Paystack and Flutterwave adapters
    utils/             Small helpers
  types/               Roles and database types
  proxy.ts             Refreshes the Supabase session on each request
supabase/
  migrations/          SQL migrations (profiles + roles + RLS)
  seed.sql             Local seed data
tests/                 Test setup
```

## Roles

Three roles live in `public.profiles.role`: `customer`, `business`, `admin`.
People choose customer or business at sign-up; `admin` can only be granted server-side by an admin.
Users can edit their own name, phone and avatar but never their role (enforced in the database).

## Error handling

- Throw `AppError(code, userSafeMessage)` for expected failures.
- Wrap route handlers in `withErrorHandling` so every error becomes `{ error: { code, message } }` with the right status.
- Unexpected errors are logged server-side and returned as a generic 500 without internal details.
- `error.tsx` and `global-error.tsx` catch rendering errors in the UI.
