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
| `customer_platform`      | Approved-only search, public reviews, booking counterpart names   |
| `business_status_values` | Business statuses: pending, under review                          |
| `business_onboarding`    | Status flow, add-ons, booking settings, verification requests     |

Money is stored as whole kobo (`bigint`), never as decimals.

`supabase/seed.sql` loads demo data for local development only: categories, eight approved Lagos
and Abuja businesses with services, areas, hours and reviews, plus one business still waiting for
review (it never appears in search). Every demo account uses the password `Password123`:

| Email              | Role                               |
| ------------------ | ---------------------------------- |
| `customer@demo.ng` | Customer                           |
| `owner@demo.ng`    | Business owner (Lush Events Décor) |
| `admin@demo.ng`    | Admin (use the private admin link) |

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

## Customer platform

| Page                           | Route                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| Home and AI Concierge          | `/`, `/concierge?q=`                                         |
| Search and results, compare    | `/search`, `/compare?ids=`                                   |
| Services by category           | `/services`, `/services/[slug]`                              |
| Business profile               | `/businesses/[slug]`                                         |
| Booking and quote requests     | `/book/[slug]`                                               |
| Checkout                       | `/checkout/[bookingId]`                                      |
| My bookings, messages, reviews | `/account/bookings`, `/account/messages`, `/account/reviews` |
| Account and settings           | `/account`, `/account/settings`                              |

- **Concierge.** Reads the request (service, area, guests, budget) and ranks only approved
  businesses from our own database through `search_businesses`. It never searches the web. Until
  the AI stage it uses rule-based matching (`src/lib/concierge`), so it works without an API key.
- **Bookings.** Prices always come from the database, never the form. A booking moves
  `requested → accepted → confirmed` (paid) `→ in_progress → completed`; quote requests go through
  `quote_requested → quoted → accepted` first. Customers can cancel before paying, or up to 24 hours
  before the start once paid, and reschedule until the business accepts.
- **Payments.** `PAYMENT_PROVIDER=mock` (development only; refused in production) completes checkout
  without a real gateway. Payment is verified server-side and the booking is confirmed once, however
  many times the callback is hit.
- **Chat.** Opens when a booking is confirmed and is only between the customer and the business.
  Messages arrive live through Supabase Realtime. The AI never reads, writes or summarises chat.

## Business platform

Providers start at **Become a Provider** (`/become-a-provider`), sign up as a business and register
in six steps at `/business/setup`: business information, service areas, services (services,
packages, add-ons and prices), availability, portfolio (logo, photos, videos) and verification
documents. They can save and come back at any time, then submit for review.

| Status         | Meaning                                             | Visible to customers and the AI |
| -------------- | --------------------------------------------------- | ------------------------------- |
| `draft`        | Registration not submitted yet                      | No                              |
| `pending`      | Submitted, waiting for the team                     | No                              |
| `under_review` | The team is checking it or asked for more documents | No                              |
| `approved`     | Live; marked verified                               | **Yes (only this one)**         |
| `rejected`     | Not approved; the owner can fix it and resubmit     | No                              |
| `suspended`    | Taken down by the team                              | No                              |

A database trigger only allows these moves: draft → pending; pending → under review, approved or
rejected; under review → approved or rejected; rejected → pending; approved ↔ suspended; approved or
suspended → under review. Only the server changes a status, after checking the owner or admin.

| Dashboard page         | Route                                           |
| ---------------------- | ----------------------------------------------- |
| Overview               | `/business`                                     |
| Profile                | `/business/profile`                             |
| Services and add-ons   | `/business/services`                            |
| Availability and rules | `/business/availability`                        |
| Bookings               | `/business/bookings`, `/business/bookings/[id]` |
| Messages               | `/business/messages`                            |
| Earnings               | `/business/earnings`                            |
| Reviews (with replies) | `/business/reviews`                             |
| Verification status    | `/business/verification`                        |

- **One business per account.** Customer and provider accounts are separate.
- **Uploads** go into the business's own storage folder; verification documents are private to the
  owner and admins.
- **Booking rules.** Owners can pause new bookings and set a notice period, how far ahead customers
  can book and a daily limit. Booking requests are checked against them on the server.
- **Earnings.** Completing a job records a payout: the booking total minus the platform commission
  (`commission_rate_bps`, currently 10%). Paying it out comes with the payments stage.
- **Admin review** (private admin link, `/businesses`): the team sees each registration, opens
  documents through short-lived links, requests more information, accepts or rejects documents and
  approves, rejects, suspends or reinstates the business. Every decision is logged and the owner is
  notified.

## Error handling

- Throw `AppError(code, userSafeMessage)` for expected failures.
- Wrap route handlers in `withErrorHandling` so every error becomes `{ error: { code, message } }` with the right status.
- Unexpected errors are logged server-side and returned as a generic 500 without internal details.
- `error.tsx` and `global-error.tsx` catch rendering errors in the UI.
