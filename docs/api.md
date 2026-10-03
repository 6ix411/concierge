# API (version 1)

The JSON API that the future Concierge apps for iOS and Android will use. It runs on the same server
as the website, and each endpoint calls the same server code the website uses. Validation, permission
checks, rate limits and database rules are shared, so an app can never do more than the website can.

Base URL: `https://<your-site>/api/v1`

## Signing in

Apps sign in with **Supabase Auth**, using the public URL and anon key (the same values as
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Every Supabase client library can do
this, and the anon key is safe to ship inside an app.

```http
POST {NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password
apikey: {anon key}
Content-Type: application/json

{ "email": "customer@demo.ng", "password": "…" }
```

Send the returned `access_token` with every private call:

```http
Authorization: Bearer <access_token>
```

Refresh the token with Supabase Auth before it expires. The Supabase client libraries do this for you.

- **Only the Authorization header counts.** The API strips cookies (`src/proxy.ts`), so the website's
  session cookie never works here, and another site can't use a visitor's browser to call it.
- The token is checked with the auth server on every call. Suspended accounts and accounts that have
  been signed out everywhere are refused straight away.
- Database reads run as the signed-in user, so row level security applies to every query.

## Responses

Every response has one of these two shapes, and none are cached (`Cache-Control: no-store`):

```json
{ "data": … }
{ "error": { "code": "NOT_FOUND", "message": "Not found.", "details": { … } } }
```

| Status | `code`              | When                                                                  |
| ------ | ------------------- | --------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`       | The request can't be done (wrong status, bad JSON, body over 64 KB)   |
| 401    | `UNAUTHENTICATED`   | Missing, expired or invalid token                                     |
| 403    | `FORBIDDEN`         | The account's role can't do this (for example, a business booking)    |
| 404    | `NOT_FOUND`         | Unknown, malformed or **someone else's** id: the API never says which |
| 422    | `VALIDATION_FAILED` | Field problems in `details.fields`, keyed like the website's form     |
| 429    | `RATE_LIMITED`      | Too many attempts; try again later                                    |
| 500    | `INTERNAL`          | Unexpected; details are logged on the server only                     |

Messages are written for people and can be shown to them as they are.

## Endpoints

### Public

| Method and path          | What it returns                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /categories`        | Service categories                                                                                                                                        |
| `GET /businesses`        | Search, using the website's engine. Query: `q`, `category`, `location`, `date`, `guests`, `max` (₦), `sort`, `page`. Returns `{ results, page, hasMore }` |
| `GET /businesses/{slug}` | A business profile: services, prices, areas, hours, published reviews                                                                                     |
| `POST /concierge`        | Asks the AI Concierge. Body: `{ message, history? }` as a visitor, or `{ message, conversationId? }` signed in. Returns `{ reply, conversationId }`       |

Only approved businesses with an active owner ever appear. Anything else is "not found".

### Signed in

| Method and path                | Who      | What it does                                                  |
| ------------------------------ | -------- | ------------------------------------------------------------- |
| `GET /me`                      | Everyone | `{ id, email, role, fullName }`                               |
| `GET /notifications`           | Everyone | `{ items, unread }`. Add `?unread=1` to get unread items only |
| `GET /bookings`                | Customer | `?view=upcoming` (default) or `?view=past`                    |
| `GET /bookings`                | Business | `?tab=requests` (default), `?tab=upcoming` or `?tab=past`     |
| `GET /bookings/{id}`           | Both     | One booking, if it is yours                                   |
| `POST /bookings`               | Customer | Asks for a booking or a quote. Returns `{ id }` (see below)   |
| `POST /bookings/{id}/{action}` | Both     | Moves a booking along (see below)                             |

#### Making a booking

```json
{
  "business": "lush-events-decor",
  "mode": "book",
  "serviceIds": ["…"],
  "packageId": "…",
  "quantities": { "<serviceId>": 2 },
  "date": "2026-11-14",
  "time": "11:00",
  "addressLine": "14 Glover Road",
  "area": "Ikoyi",
  "city": "Lagos",
  "state": "Lagos",
  "guests": 150,
  "notes": "Gold and white theme",
  "requestKey": "<a UUID made once for this request>"
}
```

- `mode` is `book` or `quote`. A quote needs a service, a package, or notes of at least 10 characters.
- Prices always come from the database. The app never sends a price.
- Send the same `requestKey` when you retry. A request that is repeated after a dropped connection
  returns the same booking instead of creating a second one.
- `notes` must not contain phone numbers or email addresses (422). Customer and business talk in the
  Concierge chat once the booking is confirmed.

#### Booking actions

| Who      | `action`       | Body                                         |
| -------- | -------------- | -------------------------------------------- |
| Customer | `cancel`       | `{ reason? }`                                |
| Customer | `reschedule`   | `{ date: "YYYY-MM-DD", time: "HH:MM" }`      |
| Customer | `accept-quote` |                                              |
| Customer | `pay`          | Returns `{ checkoutUrl }`                    |
| Customer | `review`       | `{ rating: 1-5, comment? }` (completed only) |
| Business | `accept`       |                                              |
| Business | `decline`      | `{ reason }`                                 |
| Business | `quote`        | `{ amount (₦), notes? }`                     |
| Business | `start`        |                                              |
| Business | `complete`     |                                              |
| Business | `cancel`       | `{ reason }`                                 |

Each action is only allowed when the booking's status allows it, exactly as on the website. Any
other action returns 404.

**Paying.** Open `checkoutUrl` in an in-app browser. The booking becomes `confirmed` only after the
server has verified the payment with the payment provider (through its signed webhook or a server
check). Nothing the app sends can mark a booking as paid. When the browser view closes, poll
`GET /bookings/{id}` until the status changes.

## What apps read straight from Supabase

Some features don't need an API endpoint, because row level security already limits each user to
their own rows. Apps can use the Supabase client for these:

- **Chat:** read and send `messages` in your own `conversations`, mark them read with
  `rpc('mark_conversation_read')`, and subscribe through Realtime (`messages`, `conversations`,
  `conversation_reads`, `notifications` are published). The AI has no access to these tables.
- **Your profile:** `users` (your own row) and `customer_profiles`.
- **Files:** Storage buckets with the same policies as the website (see `docs/database.md`).

Anything that involves money, status changes, moderation or other people's data goes through
`/api/v1` or the website, never through direct table writes. The database refuses those writes in
any case.

## Versioning

Breaking changes get a new prefix (`/api/v2`), and `/api/v1` keeps working until the store apps
that use it are retired. New fields can be added to v1 responses at any time, so apps should ignore
fields they don't know.

## Code

- `src/lib/api/v1.ts`: response shape, bearer sign-in, JSON body limits, and running website form
  actions for the API.
- `src/app/api/v1/**/route.ts`: one file per endpoint.
- Tests: `src/lib/api/v1.test.ts` (unit) and `e2e/suites/api.mjs` (end to end against a production
  build: sign-in, booking, other users' data, cookies, PWA).
