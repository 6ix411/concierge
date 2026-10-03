# Architecture

Concierge by 6IX is a single Next.js application on Vercel with a Supabase backend. The first
version is a responsive web app that can be installed on a phone (a PWA). The native iOS and Android
apps planned for later will use the same backend through `/api/v1`, so no second backend is needed.

```
             Phones and computers
   ┌──────────────────────────────────────────┐
   │ Website / installed PWA  │ Future apps   │
   │ (browser, session cookie)│ (iOS, Android)│
   └─────────────┬────────────┴───────┬───────┘
                 │ pages, server       │ /api/v1 (bearer token)
                 │ actions             │ + Supabase Auth, Realtime, Storage
   ┌─────────────▼─────────────────────▼───────┐
   │ Next.js on Vercel (London)                │
   │  src/proxy.ts     sign-in check, CSP,     │
   │                   private admin URL       │
   │  src/app          pages and API routes    │
   │  src/lib          all business logic      │
   └──┬───────────┬────────────┬───────────┬───┘
      │           │            │           │
  Supabase    Anthropic     Paystack    Resend
  Postgres,   (AI           (payments,  (email)
  Auth,       Concierge)    payouts,
  Storage,                  webhooks)
  Realtime
```

## Layers

1. **Pages and routes** (`src/app`). Server components render pages, and forms call server actions.
   Route handlers serve `/api/v1/*` for apps, `/api/payments/*` for payment callbacks and webhooks,
   `/api/notifications/dispatch` for the scheduler, and `/api/health`.
2. **Domain code** (`src/lib/<area>`). Each area (bookings, business, chat, concierge, payments,
   reviews, disputes, admin, revenue, analytics, notifications) keeps together its validation schemas
   (zod), rules (pure functions, unit tested), queries, and actions. The website and the API call the
   same actions, so a rule is written once.
3. **Database** (Supabase Postgres). Row level security, column privileges and triggers enforce the
   rules again, independently of the server code. See [database.md](database.md).

Security never relies on the browser. Every page, action and API route checks the user on the server
(`src/lib/auth/session.ts`), and the database checks again.

## Accounts and roles

Supabase Auth handles sign-in. `public.users` holds each account's role (`customer`, `business` or
`admin`) and status. The website keeps the session in a cookie. The API accepts only an
`Authorization: Bearer` token and strips cookies. Admin pages live at a private URL
(`ADMIN_PATH`); anyone else gets the normal 404 page there.

## The AI Concierge

`src/lib/concierge` runs a tool-using loop with the Anthropic API. The model can only call four
tools: search, provider details, compare and reply. Each one reads approved businesses from the
platform database, with no web access and no raw SQL. Every reply passes through a guard
(`guard.ts`) that rejects any provider, price, rating, review count or availability claim the tools
didn't return. If no key is configured, or the model fails, a rules-based fallback answers from the
same database. The concierge never reads or writes customer–business chats.

## Bookings, payments and chat

- A booking moves through statuses enforced by a database trigger. Prices are copied from the
  database into `booking_items` when the booking is made, and the client never sends them.
- Checkout goes through the payment provider. A booking is confirmed only when the server has
  verified the payment, through the provider's signed webhook or a server call.
- Confirmation opens a conversation. Chat is human to human, on Supabase Realtime, and the street
  address is shared with the business only at that point.
- Completion allows one verified review. Payouts follow completion unless there is a dispute.

## Notifications

In-app notifications are written by database triggers and server code. Email (and later SMS or push)
goes through an outbox (`notification_deliveries`) that a scheduler drains every 5 minutes by calling
`/api/notifications/dispatch` with `CRON_SECRET`.

## Installable web app (PWA)

- `src/app/manifest.ts`: name, icons (`src/app/app-icons`, drawn at build time), standalone display,
  and shortcuts to Find My Provider, bookings and messages.
- `public/sw.js`: a deliberately small service worker. Pages always come from the network. When
  there is no connection, it shows `/offline`. It caches only that signed-out page and the build's
  static files, never anything personal. It registers in production only
  (`src/components/layout/service-worker.tsx`).

## Ready for native apps

The backend is shared. A native app:

1. Signs in with Supabase Auth (email and password today) and keeps the token.
2. Calls `/api/v1` for search, profiles, the concierge, bookings, payments (through the provider's
   checkout in an in-app browser), reviews and notifications. See [api.md](api.md).
3. Uses the Supabase client directly for chat (Realtime), profile edits and file uploads, all limited
   by row level security.

Push notifications will be a new channel in `src/lib/notifications/channels.ts`, fed by the same
outbox. Business-side screens use the same API, with the role taken from the token.

## Environments and deployment

- Local: `npm run dev` with a local Supabase in Docker.
- CI (GitHub Actions): typecheck, lint, format, unit tests, secret scan, database tests (pgTAP), and
  browser suites against a production build.
- Production: Vercel (London region) with Supabase (London). See [deployment.md](deployment.md) and
  [environment.md](environment.md).

## Where things are

| Path                  | What it holds                                                        |
| --------------------- | -------------------------------------------------------------------- |
| `src/app`             | Pages, layouts, API routes                                           |
| `src/app/api/v1`      | The app API                                                          |
| `src/components`      | UI components (`ui/` primitives, `layout/`, and one folder per area) |
| `src/lib`             | Domain code, one folder per area                                     |
| `src/lib/supabase`    | Clients: browser, server (cookie or bearer), admin (service role)    |
| `src/proxy.ts`        | Session refresh, CSP nonce, role routing, private admin URL          |
| `supabase/migrations` | The schema, in order                                                 |
| `supabase/tests`      | Database tests (pgTAP)                                               |
| `e2e/suites`          | Browser suites (Playwright)                                          |
| `docs`                | This documentation                                                   |
