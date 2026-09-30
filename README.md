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
    auth/              Session, role guards, sign-in/up actions, admin audit
    env/               Validated env: schema.ts, server.ts (server-only), client.ts (public)
    errors/            AppError, JSON error responses, logger
    supabase/          Browser, server, admin (service role) and proxy clients
    ai/                Anthropic client for the concierge (server-only)
    payments/          PaymentProvider interface, Paystack and Flutterwave adapters
    utils/             Small helpers
  types/               Roles and database types
  proxy.ts             Refreshes the session; redirects by role
supabase/
  migrations/          SQL migrations (schema, triggers, RLS, storage)
  tests/               Database access-control tests (pgTAP)
  seed.sql             Local seed data
tests/                 Test setup
```

## Database

Migrations live in `supabase/migrations` and run in order:

| Migration                | What it holds                                                     |
| ------------------------ | ----------------------------------------------------------------- |
| `core_schema`            | Enums and the 21 core tables, relationships, indexes, constraints |
| `functions_and_triggers` | Sign-up trigger, permission helpers, integrity triggers           |
| `row_level_security`     | Table/column privileges and RLS policies for every table          |
| `storage`                | Storage buckets and who can upload or read each one               |
| `reference_data`         | Platform settings every environment needs                         |

Money is stored as whole kobo (`bigint`), never as decimals.

Useful commands (local Supabase must be running):

```bash
npm run db:reset   # rebuild the local database from migrations + seed
npm run db:test    # access-control tests in supabase/tests (pgTAP)
npm run db:lint    # check database functions for errors
npm run db:types   # regenerate src/types/database.ts
```

## Roles and access control

Roles live in `public.users.role`: `customer`, `business`, `admin`.

Access is checked in three places, all on the server:

1. **Database.** Every table has row level security. Column privileges decide what a signed-in
   client can ever write: only "content" it owns (its name, its business profile, services, areas,
   availability, portfolio, chat messages). Money, statuses, verification, reviews, disputes and
   roles are never writable from the browser.
2. **Server code.** `src/lib/auth/session.ts` provides `requireUser`, `requireRole`,
   `requireBusinessOwner` (for actions and API routes) and `requireAreaAccess` (for pages).
   The role always comes from the database, never from the browser. Privileged writes use the
   service-role client only after these checks, and admin decisions go to `admin_actions` via
   `recordAdminAction`.
3. **Proxy.** `src/proxy.ts` redirects people away from areas their role can't use and serves the
   private admin link. This is a convenience; layouts and pages check again.

| Area            | Who can enter      |
| --------------- | ------------------ |
| `/account`      | customers, admins  |
| `/business`     | businesses, admins |
| `/<ADMIN_PATH>` | admins             |

### Private admin link

The admin dashboard has no public URL and is never linked on the site. It lives at
`https://your-site/<ADMIN_PATH>`, where `ADMIN_PATH` is a secret server-only env var
(16-64 characters; generate one with `openssl rand -hex 16`). It is required in production.

- Admins are sent there automatically after signing in.
- Anyone else, signed in or not, gets the normal "Page not found" at that URL.
- The internal route `/admin` always returns 404.
- Links inside the dashboard are built with `adminHref()` (`src/lib/auth/admin-path.ts`).
- Changing `ADMIN_PATH` and redeploying moves the dashboard to a new private link.
- Locally, `.env.development` uses `http://localhost:3000/admin-local-dev-only`.

Rules the database enforces no matter who writes:

- Nobody can pick `admin` at sign-up, and users can't change their own role.
- Only approved businesses are visible to the public (and later, to the AI Concierge).
- Bookings follow a fixed status flow; chat opens only when a booking is confirmed (paid).
- Only the booking's customer and the business can post in its chat, as themselves.
  There is no AI sender: AI Concierge history is stored separately in `ai_conversations`.
- Reviews need a completed booking; business ratings update automatically.
- The admin audit log can't be edited or deleted.

### Creating the first admin

Sign up normally, then run this once in the Supabase SQL editor:

```sql
update public.users set role = 'admin' where email = 'you@example.com';
```

## Error handling

- Throw `AppError(code, userSafeMessage)` for expected failures.
- Wrap route handlers in `withErrorHandling` so every error becomes `{ error: { code, message } }` with the right status.
- Unexpected errors are logged server-side and returned as a generic 500 without internal details.
- `error.tsx` and `global-error.tsx` catch rendering errors in the UI.
