# Environment variables

Every setting is checked when the server starts (`src/lib/env/schema.ts`). A missing or unsafe value
stops the server with the variable's **name**, never its value. In production
(`APP_ENV=production`) the check runs on boot (`src/instrumentation.ts`), so a misconfigured deploy
fails before it serves anyone.

- Only `NEXT_PUBLIC_*` variables reach the browser. Everything else is read only by server code that
  imports `server-only`, and importing such code into a client component fails the build.
- Real values live in `.env.local` (git-ignored) on your machine and in the host's settings in
  production. `npm run check:secrets` (also run in CI) fails if a key or a filled-in secret is
  committed.
- Committed files (`.env.development`, `.env.test`, `.env.production`) hold non-secret defaults only.

## Reference

| Variable                             | Browser | Required                        | What it is                                                                                              |
| ------------------------------------ | ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                            | No      | Defaults to `development`       | `development`, `test` or `production`. Production turns on the strict checks below                      |
| `NEXT_PUBLIC_APP_URL`                | Yes     | Always (https in production)    | The site's public address, used in emails, payment callbacks and the app manifest                       |
| `ADMIN_PATH`                         | No      | Production                      | The private admin dashboard URL segment (16-64 of `a-z 0-9 - _`). `openssl rand -hex 16`                |
| `NEXT_PUBLIC_SUPABASE_URL`           | Yes     | Always (https in production)    | Supabase project URL. Apps use it too                                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | Yes     | Always                          | Supabase public key. Safe to share; row level security protects the data                                |
| `SUPABASE_SERVICE_ROLE_KEY`          | No      | Always                          | Bypasses row level security. Used only by server code for admin and system work                         |
| `ANTHROPIC_API_KEY`                  | No      | Production                      | The AI Concierge. Without it, the concierge says it is unavailable                                      |
| `ANTHROPIC_MODEL`                    | No      | Defaults to `claude-sonnet-5-5` | The model the concierge uses                                                                            |
| `PAYMENT_PROVIDER`                   | No      | Defaults to `paystack`          | `paystack`, `flutterwave` or `mock`. `mock` (instant success) is refused in production                  |
| `PAYSTACK_SECRET_KEY`                | No      | With Paystack                   | Also verifies Paystack webhook signatures. `sk_test_` keys are refused in production                    |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`    | Yes     | Optional                        | Paystack public key                                                                                     |
| `FLUTTERWAVE_SECRET_KEY`             | No      | With Flutterwave                | Flutterwave secret key. Test keys are refused in production                                             |
| `FLUTTERWAVE_WEBHOOK_HASH`           | No      | With Flutterwave                | The secret hash Flutterwave sends with each webhook                                                     |
| `NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY` | Yes     | Optional                        | Flutterwave public key                                                                                  |
| `CRON_SECRET`                        | No      | Production                      | At least 32 characters. The scheduler sends it to `/api/notifications/dispatch`. `openssl rand -hex 32` |
| `RESEND_API_KEY`                     | No      | Set with `EMAIL_FROM`           | Sends notification email through Resend. Unset: in-app notifications only                               |
| `EMAIL_FROM`                         | No      | Set with `RESEND_API_KEY`       | Sender, on a domain verified in Resend, e.g. `Concierge by 6IX <hello@your-domain>`                     |

Set by the host, not by you:

| Variable                | What it is                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`              | Set by Next.js (`development` for `next dev`, `production` builds) |
| `VERCEL_GIT_COMMIT_SHA` | The deployed commit, shown as `version` by `/api/health`           |

## Tests and CI only

| Variable           | Default                                                   | What it is                                |
| ------------------ | --------------------------------------------------------- | ----------------------------------------- |
| `E2E_BASE_URL`     | `http://localhost:3000`                                   | Where the browser suites run              |
| `E2E_PORT`         | `3000`                                                    | Port for the production server they start |
| `E2E_DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Local database the suites check           |
| `E2E_SHOTS`        | `e2e/screenshots`                                         | Where screenshots are saved               |

## Per environment

| Setting             | Local (`.env.local`)               | CI                          | Production (host settings) |
| ------------------- | ---------------------------------- | --------------------------- | -------------------------- |
| `APP_ENV`           | `development`                      | `development`               | `production`               |
| Supabase            | `npm run db:start` prints the keys | Local stack in the job      | Supabase project (London)  |
| `PAYMENT_PROVIDER`  | `mock` or Paystack test keys       | `mock` (dummy Paystack key) | `paystack` with live keys  |
| `ANTHROPIC_API_KEY` | Optional                           | Not set                     | Required                   |
| `ADMIN_PATH`        | Any value                          | Demo value                  | Required, secret           |
| `CRON_SECRET`       | Optional                           | Not set                     | Required                   |
| Email               | Optional                           | Not set                     | Recommended                |

See [deployment.md](deployment.md) for where each production value comes from.
