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
| `admin_dashboard`        | Admin statistics (server only) and dispute outcomes               |

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

- **Concierge.** A chat that finds, compares and explains providers, then opens the booking form.
  See "AI concierge" below.
- **Bookings.** See "Booking engine" below.
- **Payments.** `PAYMENT_PROVIDER=mock` (development only; refused in production) completes checkout
  without a real gateway. Payment is verified server-side and the booking is confirmed once, however
  many times the callback is hit.
- **Chat.** Opens when a booking is confirmed and is only between the customer and the business.
  Messages arrive live through Supabase Realtime. The AI never reads, writes or summarises chat.

### Provider results and business profiles

Every place a provider is listed (search, category pages, concierge replies) uses the same card:
name, verified badge, rating and review count, price range for the matching services, areas served
and completed bookings, with **View profile**, **Compare** and **Book**.

The profile at `/businesses/[slug]` shows the logo, verification, description, location and service
areas, a facts strip (rating, completed bookings, price range, base), services, packages, add-ons,
portfolio, reviews with a 5-to-1 star breakdown, and availability (working hours, notice, how far
ahead it books, upcoming days off). Completed bookings, the price range and the star breakdown come
from `get_business_stats`, which only answers for approved businesses. Nothing on a card or profile
is typed in by hand: it all comes from the database.

## Booking engine

The customer picks the business, then on `/book/[slug]`: services, a package, date and time,
location (address, area, city, state), add-ons, and additional requirements (guests and notes).
The server re-checks everything and prices it from the database: the business must be approved and
taking bookings, serve that state, work at that time, respect its notice, booking window and daily
limit, and every service, package and add-on must still be offered. `create_booking` then writes the
booking and its items in one transaction.

```
requested → pending_provider → accepted → payment_pending → confirmed → in_progress → completed → reviewed
```

| State            | Means                                                          | Moved by                    |
| ---------------- | -------------------------------------------------------------- | --------------------------- |
| requested        | The customer sent it                                           | Customer                    |
| pending_provider | Waiting for the business to accept, decline or send a quote    | Automatic, straight after   |
| quoted           | The business sent a price (quote requests only)                | Business                    |
| accepted         | Accepted (or quote accepted); the customer can pay             | Business, or customer       |
| payment_pending  | The customer started checkout; can retry until it goes through | Customer                    |
| confirmed        | Payment verified on the server; chat opens                     | Payment callback            |
| in_progress      | The job has started                                            | Business                    |
| completed        | The job is done; the payout is created                         | Business or admin           |
| reviewed         | The customer left a review                                     | Automatic, on review        |
| declined         | The business said no                                           | Business                    |
| cancelled        | Called off; if paid, a refund is due                           | Customer, business or admin |
| disputed         | A problem was reported after payment; the payout is held       | Customer or business        |
| refunded         | A cancelled, paid booking has been refunded                    | Admin, after sending it     |

`expired` is kept for bookings nobody acted on. The database enforces the transitions
(`is_valid_booking_transition`), and the app offers the same ones (`src/lib/bookings/workflow.ts`).
All status changes go through `moveBooking` (`src/lib/bookings/transitions.ts`), which only applies if
the booking is still in the expected state.

**Booking ID.** Every booking has a UUID and a unique reference like `BK-3F2483318F`, shown to
everyone.

**History.** `booking_events` records the creation, every status change and every reschedule, with
who made it (customer, business, Concierge team or automatic) and any note or reason. A trigger
writes it, so nothing can change a booking without leaving a record, and the table can't be edited.
Customers, the business and admins see it on the booking page.

**Refunds.** A customer can cancel a paid booking up to 24 hours before the start, and a dispute
can be settled in the customer's favour. Both leave it cancelled with a refund due. The admin
**Refunds due** list shows these; **Refund to the customer** sends the money back through the payment
provider and moves the booking to `refunded` (see [Payments](#payments)).

## Payments

Money flows: **customer payment → platform (Paystack or Flutterwave balance) → platform fee →
payout to the business**.

| Setting                    | What it does                                                      |
| -------------------------- | ----------------------------------------------------------------- |
| `PAYMENT_PROVIDER`         | `paystack` (default), `flutterwave`, or `mock` (development only) |
| `PAYSTACK_SECRET_KEY`      | Paystack secret key; also signs Paystack webhooks                 |
| `FLUTTERWAVE_SECRET_KEY`   | Flutterwave secret key                                            |
| `FLUTTERWAVE_WEBHOOK_HASH` | The "secret hash" set in the Flutterwave dashboard                |

Secret keys are only read on the server. Set the webhook URL in the provider's dashboard to
`https://<your domain>/api/payments/webhook/paystack` (or `/flutterwave`). For payouts, Paystack
transfers must be enabled on the account and funded from the balance.

- **Commission is data, not code.** Admins set the platform rate on the private admin link
  (`/commission`) and can give a business its own rate. A booking stores the rate in force when it
  was made; if no rate has been set, new bookings are refused rather than falling back to a built-in
  number.
- **Every payment records** the amount, currency, booking, customer, business, platform fee,
  provider amount, status, our reference and the provider's transaction reference, payment channel
  and payment date. The database works out the business, rate, fee and provider amount from the
  booking (`check_payment_matches_booking`), so they can't be sent from outside or changed later.
- **Never trusted from the browser.** Returning from checkout only triggers a server-to-server
  verification with the provider (amount, currency and reference must match). Webhooks are checked
  against the provider's signature, stored once in `payment_webhook_events` (replays are
  ignored), and then verified with the provider again before anything changes. A payment is marked
  successful, and the booking confirmed, only after that.
- **Payouts.** Completing a job creates a payout of the payment's provider amount. The business adds
  its bank account on **Earnings**; the account name comes from the bank, not from what was typed.
  On the admin **Payouts** page, **Pay out** (or **Pay all ready**) sends a transfer with our own
  reference. A payout is claimed before any money moves, so a double click can't pay twice; a failed
  transfer goes back to the list with the bank's reason. Payouts stay on hold during a dispute and
  are withheld when a booking is refunded.
- **Refunds** go through the provider's refund API. Some finish later; the refund webhook moves the
  booking to `refunded` then.
- **Admin pages:** **Payments** (every payment with its split, filters and totals) and **Payouts**.

## Customer–business chat

When a booking is **confirmed** (paid), a private chat opens between the customer and the business,
linked to that booking. It is strictly human to human: the AI concierge has no access to it and
never answers, suggests, negotiates, summarises, translates or sends anything there (a unit test
fails if any concierge file references the chat tables). The platform only provides the channel.

- **Booking card** at the top: booking number and status, customer, business, service, date and
  place.
- **Real-time text, photos, videos and files** (images, MP4/MOV/WebM, PDF, Word, Excel, text; up to
  50 MB) in a private storage bucket only the two participants can read. Files are uploaded to the
  chat's own folder, then a server action checks the contents (not the name or what the browser
  says) and sends the message; anything else is deleted. Admins see files only through the
  dashboard's signed links.
- **Timestamps and read receipts** ("Sent" / "Seen", live) via `conversation_reads`.
- **Notifications:** one "new message" notification per chat (never containing the text), cleared
  when the chat is read; inboxes show a "New" badge.
- **Report a message or the person** (`chat_reports`); the Concierge team is notified.
- **Block:** either side can block the other; neither can send until it's lifted. Admins can
  **restrict** a chat (read-only for both sides).
- **Private contact details:** business phone numbers and emails are no longer readable through the
  API, and the chat reminds people to keep talking and paying on Concierge when they type a phone
  number or email (messages are never changed).
- **Admin access when required:** an admin can open a chat only when its booking has a dispute or the
  chat has a report; every visit is logged in the audit log. From there they can hide a message,
  restrict the chat and close reports (private admin link, `/reports`).
- Database rules enforce it: only the customer and the business owner can send, even with full
  database access; blocked or restricted chats refuse messages; senders can't set moderation flags.

## Reviews and ratings

Only a customer whose own booking is **completed** can review it, once. The checks run in the
server action and again in the database (`check_review_booking`), so they hold even if the app is
bypassed:

- Customers can't write to `reviews` directly; the server inserts after checking the booking.
- The booking must belong to the reviewer and be completed; `reviews.booking_id` is unique, so a
  booking gets one review. A business owner can never review their own business.
- Leaving a review moves the booking to `reviewed`, and the business rating only counts published
  reviews.

**Photos.** Up to 4 JPG, PNG or WebP photos, 5 MB each. The server checks each file's first bytes
(a renamed file is refused), then stores it in the private `review-photos` bucket. Pages show
short-lived signed links, and only for reviews the viewer can already see: a hidden review's photos
disappear from the public profile. `serverActions.bodySizeLimit` and `proxyClientMaxBodySize` are
raised to 21 MB in `next.config.ts` for these uploads.

**Businesses** reply publicly from Business → Reviews, or report a review that breaks the guidelines.
A reported review stays up until an admin decides; businesses can't edit or remove reviews.

**Admins** (Reviews in the admin dashboard) see reported reviews under "Reported", the business's
reason and the photos. They can hide or republish a review, remove a single photo, or keep a reported
review. The reviewer or business is told the outcome and every action is in the audit log. The
guidelines live in `src/lib/reviews/rules.ts` and are shown to customers when they write.

## Disputes

The customer or the business can open a dispute on a paid booking, or up to 14 days after it's
completed, from the booking page. They choose a reason, write a short summary and a description of
what happened, and can attach evidence. The booking becomes "In dispute" and the business's payout
is held.

Each dispute has its own page (`/account/bookings/<id>/dispute`, `/business/bookings/<id>/dispute`
and the admin dispute page) with the booking details, all evidence, and a thread where both sides
and the Concierge team write and add more files (photos, videos, PDFs; up to 5 files or 20 MB per
message, 30 per dispute). Admins can also leave internal notes that the two sides never see.

| Status       | Meaning                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| Open         | Just opened                                                                     |
| Under review | An admin has picked it up                                                       |
| Escalated    | Needs a senior decision or outside action; both sides are told, not why         |
| Resolved     | An admin decided for the business or the customer                               |
| Closed       | Ended without a decision for either side: dismissed, or withdrawn by its opener |

**Nobody can manipulate the record.** Clients can't write to any dispute table; the server does,
after checking who the person is. In the database (`20261009100100_disputes.sql`):

- What was reported (booking, who opened it, reason, summary, description) can never be changed.
- Status only moves forward, and a resolved or closed dispute is final.
- Messages, evidence and the history (`dispute_events`, written by triggers with who made each
  change) are append-only. A message or file must come from the booking's customer, its business
  owner or an active admin, and only while the dispute is active.
- Evidence is checked by its first bytes and kept in the private `dispute-evidence` bucket, shown
  through short-lived signed links.

## Notifications

Everyone signed in has a bell in the header with their unread count, updated live over Realtime,
and a notification centre at `/notifications` (All / Unread, a filter per type, "Mark all read").
Admins get theirs inside the private dashboard; the header never links there. Opening a
notification goes through `/notifications/go/<id>`, which marks it read and sends the person to
the page it's about (`src/lib/notifications/links.ts`).

| Event                       | Who is told                     | Sent by                                           |
| --------------------------- | ------------------------------- | ------------------------------------------------- |
| Registration                | The new customer or business    | Database trigger on sign-up                       |
| Business submitted          | The owner and every admin       | `submitForReviewAction`                           |
| Verification updates        | The business                    | Admin approve / reject / request info             |
| Booking request             | The business                    | Booking actions                                   |
| Accepted / declined         | The customer                    | Business booking actions                          |
| Payment confirmation        | Both sides                      | Verified payment (`payment.confirmed`)            |
| Cancellation                | The other side                  | Booking actions                                   |
| New chat message            | The other side (one per chat)   | Database trigger on messages                      |
| Booking reminder            | Both sides, within 24 hours     | Scheduled job (`booking.reminder`)                |
| Service started / completed | The customer                    | Business booking actions                          |
| Review request              | The customer, 1 hour after done | Scheduled job (`review.request`)                  |
| Dispute updates             | Both sides (and admins)         | Opened, under review, messages, escalated, closed |

The scheduled job is `queue_scheduled_notifications()`, run every 15 minutes by `pg_cron`
(`20261010100000_notifications.sql`). Each reminder and review request has a `dedupe_key`, so it
is sent once however often the job runs. Notifications are written by the server only; people can
read and mark their own as read, nothing else.

### Email, SMS and push

Off for now; in-app is the only channel. The pieces to add them one at a time are in place:

1. Write an adapter for the channel in `src/lib/notifications/channels.ts` (e.g. email through a
   provider's API, with its key in an environment variable) and register it in `adapters`.
2. Add the channel to the `notification_channels` platform setting, e.g. `["email"]`. From then on
   every new notification is also queued in `notification_deliveries` (server-only).
3. Set `CRON_SECRET` and have a scheduler call `POST /api/notifications/dispatch` with
   `Authorization: Bearer <CRON_SECRET>` every minute or so. It sends what's queued and retries
   failures up to 5 times. The route answers 404 while `CRON_SECRET` is unset.

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
  (`commission_rate_bps`, set by an admin). It's sent to the bank account on the Earnings page.
- **Admin review** (private admin link, `/businesses`): the team sees each registration, opens
  documents through short-lived links, requests more information, accepts or rejects documents and
  approves, rejects, suspends or reinstates the business. Every decision is logged and the owner is
  notified.

## AI concierge

`/concierge` is a conversation. The concierge works out what the customer needs (asking one short
question when the service or area is missing), searches, compares, explains why each provider fits
and what it misses, and offers a "Start booking" button that opens the booking form with the service
and date filled in. The customer always completes the booking and payment themselves.

- **With `ANTHROPIC_API_KEY`** it uses Claude (`ANTHROPIC_MODEL`) with four tools
  (`src/lib/concierge/tools.ts`): `search_providers`, `get_provider_details`, `compare_providers`
  and `reply_to_customer`. The tools only read the matching engine, so they only ever see eligible
  businesses on Concierge. There is no web search and no tool that books or pays.
- **Without a key** (or if the AI service fails) it uses built-in rules over the same tools, so the
  concierge always works.
- **Every reply is checked** (`src/lib/concierge/guard.ts`) before the customer sees it. It is
  rejected if it shows a provider no tool returned, names a business the tools didn't return
  (including unapproved ones), quotes a price or rating the tools didn't give, claims availability
  that wasn't checked, says a booking or payment happened, or mentions searching the internet. The
  model gets one more chance to fix it; after that the customer gets a reply built from the
  database alone. Provider cards, prices and availability are always rendered from database rows,
  never from the model's text.
- **Nobody fits:** the customer is told "No suitable registered provider is currently available for
  your requirements." Real close options can still be shown, each saying what it misses.
- **History:** signed-in customers' conversations are saved (`ai_conversations`, `ai_messages`,
  written by the server, readable only by their owner) and can be reopened. Visitors' history lives in
  the page. Messages are rate limited per user or network address.
- The concierge never takes part in customer–business chat.

### What the AI can see

The model never touches the database. Its tools call two fixed backend functions, both run as an
anonymous visitor so row level security applies on top of their own rules:

1. `match_businesses` (through `findMatches`): validated filters in, ranked eligible providers out.
2. `concierge_provider_details(id)`: description, services and prices, areas, opening hours, booking
   notice and the five latest public reviews of one eligible provider. It returns nothing for an
   unapproved, suspended or unverified business, and never contacts, owners, documents or bookings.

So for "Find photographers in Victoria Island under ₦300k", the tool arguments are checked by zod,
the backend queries approved providers, and the model gets back structured rows to present.

**Prompt injection:** text businesses and reviewers wrote is cleaned (control and invisible characters
removed, length capped) and wrapped in «» marks the model is told to treat as data, never
instructions. Customers' messages can't change the rules; unknown tools and bad arguments are
refused; replies containing links, emails, phone numbers, "pay directly"-style requests or parts of
the instructions are blocked and logged (`concierge.blocked_reply`). Visitors' history is capped to
the last 20 turns.

## Search and matching engine

Search, category pages, the homepage and the concierge all go through one database function,
`match_businesses` (called from `src/lib/matching/engine.ts`). It only searches businesses registered
on Concierge, never Google or outside directories.

**Who can be returned.** A business must be approved and verified, accepting bookings, owned by an
active account, and offer at least one active service (add-ons don't count). Anyone else is never
returned, whatever the search.

**Reading a request.** `parseServiceRequest` turns plain language into structured details:

> "I need a photographer for a birthday in Victoria Island next Saturday. About 100 people. Budget ₦300k."
>
> Category: Photography & video · Event: Birthday · Location: Victoria Island, Lagos · Date: the
> Saturday of next week · Guests: 100 · Budget: ₦300,000

"This Saturday" is the coming Saturday; "next Saturday" is the Saturday of next week. Dates in the
past are ignored.

**Ranking (0 to 100).**

| Part         | Points | How                                                                           |
| ------------ | ------ | ----------------------------------------------------------------------------- |
| Relevance    | 30     | Right category, and services matching the words used                          |
| Location     | 20     | Serves the exact area 20, whole city 15, whole state 10, elsewhere in state 4 |
| Availability | 15     | Working that day and time, notice period, booking window, daily limit         |
| Price        | 15     | Lowest matching price within budget; falls the further over it is             |
| Rating       | 10     | Average rating, pulled towards 4.0 when there are few reviews                 |
| Track record | 5      | Completed bookings on Concierge                                               |
| Verified     | 5      | Verified by our team                                                          |
| Group size   | −10    | When the largest "up to N guests" service is too small                        |

Businesses in another state are never matched. Those that miss something (nearby area, busy that
day, over budget, too small) still show as "close options", each saying what doesn't fit. The search
page's max budget is a hard filter; the concierge's budget only ranks.

## Admin dashboard

Lives at the private admin link only (see above). Every page checks the admin role on the server,
and the statistics function can only be called by the server, never from a browser.

| Page       | What admins do there                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| Overview   | Key numbers, revenue chart, most popular categories, services and businesses       |
| Providers  | Review, approve, reject, suspend and reactivate providers; set a custom commission |
| Bookings   | Find any booking; mark it completed or cancel it with a reason                     |
| Disputes   | Settle problems reported by customers or businesses                                |
| Reviews    | Hide reviews that break the guidelines (they stop counting towards ratings)        |
| Users      | Search people, suspend or reactivate accounts                                      |
| Categories | Add, edit, hide or delete marketplace categories                                   |
| Commission | Set the platform commission for new bookings                                       |
| Audit log  | Every admin action, who took it and why; entries can't be edited or deleted        |

- **Disputes.** Customers and businesses can report a problem on a paid booking, or up to 14 days
  after it's completed. The booking becomes "In dispute" and the business's payout is held. An admin
  then sides with the business (booking completed, payout released), refunds the customer (booking
  cancelled, payout withheld, refund recorded as due) or dismisses it (booking goes back to where it
  was). The refund is then sent from the booking page.
- **Revenue** is what customers paid, less refunds. **Platform fees** are the commission on
  payouts plus any service fees. Each booking keeps the commission rate it was made at.
- **Suspending a business owner** also takes their live business off the marketplace. Admins can't
  change their own account status.

## Revenue

Four income streams, all set by admins under **Revenue** in the dashboard (`/revenue`):

- **Booking commission:** a percentage of each booking's service price, taken from the business's
  payout. The order is a business's custom rate, then its plan's rate (if the plan sets one), then the
  platform rate (**Commission**). Each booking keeps the rate it was made at.
- **Subscriptions** (`subscription_plans`, `business_subscriptions`): Free, Starter (₦25,000), Growth
  (₦50,000) and Pro (₦100,000) a month by default, with names, prices, commission and perks editable
  by admins. Businesses pay on **Plan** (`/business/plan`). Each paid month is one row: renewing adds
  the next month, and switching plans starts the new one today. With no paid month running, a business
  is on Free. Owners are reminded before a plan ends. Card auto-renewal is not built yet: providers'
  recurring billing can be added behind the same `business_charges` flow.
- **Featured placement** (`featured_packages`, `featured_placements`): businesses buy a week or a
  month on **Get featured** (`/business/promote`). `match_businesses` keeps every eligibility rule and
  filter, so paying never makes a provider appear. Among providers that meet every requirement of a
  search (area, date, budget, group size), up to `featured_slots` (3) featured ones are shown first,
  best match first, with a "Featured" label and a note saying it's paid. Scores never change, and
  sorting by rating or price ignores placement. The AI Concierge uses the same order.
- **Customer booking fee** (setting `booking_fee`, off by default): a percentage plus a fixed amount,
  with an optional cap. Customers see it on the booking form, the booking and checkout. It's stored on
  the booking (`platform_fee_minor`), all of it goes to the platform, and commission is only taken on
  the service price (`payments.booking_fee_minor`). Businesses only ever see their own price.

Businesses' payments to the platform are `business_charges` (`CHG-…` references). The database sets
the price from the catalogue and only lets the owner of an approved business pay. The payment is
verified with the provider (callback or webhook) and then `complete_business_charge` records it and
switches on the plan or placement in one step, once.

## Security

- **Access:** every page and action checks the user on the server (`src/lib/auth/session.ts`, which
  confirms the session with the auth server so "sign out everywhere" is immediate), and the database
  enforces the same rules with row level security. Changing an id in a URL or API call returns
  "Page not found" or nothing; malformed ids are a 404 (`pageId`).
- **Rate limits** (`src/lib/security/rate-limit.ts`): sign-in (per address and per email), sign-up,
  password reset and change, bookings, checkout, payment callbacks and webhooks, reviews, disputes,
  chat files and reports, and the concierge. Counts live in the database (`hit_rate_limit`), so
  every server shares them. Network addresses come from `x-forwarded-for`, which the host must set.
- **Passwords:** "Forgot password?" sends a one-hour link (same answer whether or not the account
  exists). The reset page only works with the short-lived signed cookie that link sets, and a reset
  or password change signs out every other device.
- **Uploads** (`src/lib/security/files.ts`): every file is judged by its first bytes after upload;
  fakes, macro-enabled Office files and HTML/script disguised as text are deleted and logged.
- **Payments:** webhooks need a valid signature and a size limit; amounts and currency are checked
  against the booking before anything is marked paid.
- **Browser:** a Content Security Policy with a fresh nonce per request (`src/proxy.ts`), no framing,
  and no inline scripts without the nonce.
- **Security log** (`security_events`, append-only, server-only): failed sign-ins, lock-outs, refused
  files, bad webhooks, payment mismatches, blocked AI replies and role changes. Addresses are kept
  only as a keyed hash. Admins read it under **Security** in the dashboard.
- **Secrets** stay in server-only environment variables (`src/lib/env/server.ts`); only
  `NEXT_PUBLIC_*` values reach the browser.

## Error handling

- Throw `AppError(code, userSafeMessage)` for expected failures.
- Wrap route handlers in `withErrorHandling` so every error becomes `{ error: { code, message } }` with the right status.
- Unexpected errors are logged server-side and returned as a generic 500 without internal details.
- `error.tsx` and `global-error.tsx` catch rendering errors in the UI.
