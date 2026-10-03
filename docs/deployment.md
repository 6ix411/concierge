# Deploying Concierge by 6IX

This is the checklist for the first production launch and for every release after it. Work top to
bottom; each step says where it happens and how to check it worked.

**Defaults this guide assumes** (swap any of them; the app doesn't depend on the vendor):

| Piece                   | Default                                          | Why                                                                                                          |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Hosting                 | Vercel (Pro plan)                                | Built for Next.js; HTTPS, previews and log drains included. Pro is needed for the 5-minute notification job. |
| Database, auth, storage | Supabase (Pro plan), London region (`eu-west-2`) | Same stack as development; daily backups and point-in-time recovery.                                         |
| Function region         | Vercel `lhr1` (London)                           | Next to the database.                                                                                        |
| Payments                | Paystack live keys                               | Flutterwave works the same way.                                                                              |
| Email                   | Resend                                           | Sends notification emails (API) and Supabase sign-in emails (SMTP).                                          |
| Monitoring              | Better Stack (uptime + logs)                     | One place for the uptime check and error logs.                                                               |

Nothing secret ever goes in the repository. Every secret below goes into the Vercel or Supabase
dashboard, or a password manager. CI runs `npm run check:secrets` on every push and fails if a
key-like value, a private key or a filled-in secret in a committed `.env` file is found. If one
ever lands in git, rotate it at the provider: deleting the commit is not enough.

---

## 1. Accounts and access

- [ ] Vercel team created; GitHub repo `6ix411/concierge` connected; only people who deploy have access.
- [ ] Supabase organisation on the Pro plan; two-factor authentication on for every member.
- [ ] Paystack business account verified (KYC complete) so live keys are available.
- [ ] Resend account; Better Stack account.
- [ ] Domain registrar login available (you'll add DNS records in steps 3 and 7).
- [ ] Password manager vault "Concierge production" for every secret in this guide.

## 2. Production database (Supabase)

- [ ] Create a project **concierge-production** in London (`eu-west-2`). Save the database password in the vault.
- [ ] Link and apply the migrations from a clean checkout of `main`:
  ```sh
  npx supabase link --project-ref <project-ref>
  npx supabase db push            # applies supabase/migrations only; never the demo seed
  ```
- [ ] **Do not run `supabase/seed.sql` in production.** It creates demo accounts with a public password.
- [ ] Check: Database → Extensions shows `pg_cron` enabled; Integrations → Cron shows the jobs
      `scheduled-notifications`, `billing-reminders`, `rate-limit-cleanup` and `analytics-retention`.
- [ ] Check: Storage shows the buckets created by the migrations: private `verification-documents`,
      `chat-attachments`, `review-photos` and `dispute-evidence`; public `avatars` and `business-media`.
- [ ] Check: Advisors → Security has no errors (every table has row level security on).
- [ ] Auth → URL configuration: Site URL `https://<your-domain>`; redirect URLs
      `https://<your-domain>/auth/confirm`.
- [ ] Auth → Emails: paste `supabase/templates/recovery.html` into the "Reset password" template, and
      turn on the "Password changed" notification with `supabase/templates/password_changed.html`
      (`supabase/config.toml` applies them only to the local stack).
- [ ] Auth → SMTP: enable custom SMTP with Resend (step 7) so sign-in emails don't hit Supabase's
      low default limit.
- [ ] Settings → API: copy the project URL, `anon` key and `service_role` key into the vault.

## 3. Domain and SSL

- [ ] In Vercel → Project → Domains add `<your-domain>` and `www.<your-domain>` (redirect www to the bare domain).
- [ ] Add the DNS records Vercel shows (A/ALIAS for the apex, CNAME for www) at the registrar.
- [ ] Check: Vercel shows both domains as **Valid** and a certificate was issued (automatic, renews itself).
- [ ] Check: `curl -sI https://<your-domain> | grep -i strict-transport` returns the HSTS header.
      The app already sends HSTS with `preload`; submit the domain at hstspreload.org only once you're
      sure every subdomain serves HTTPS.

## 4. Environment variables (Vercel → Project → Settings → Environment Variables)

Set these for **Production**. **Preview** deployments get their own values: a separate staging
Supabase project (never production data), `APP_ENV=development` and Paystack **test** keys.

| Variable                          | Value                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `APP_ENV`                         | `production`                                                                                        |
| `NEXT_PUBLIC_APP_URL`             | `https://<your-domain>` (https is required in production)                                           |
| `NEXT_PUBLIC_SUPABASE_URL`        | Supabase project URL                                                                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase `anon` key                                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`       | Supabase `service_role` key (**secret**)                                                            |
| `ADMIN_PATH`                      | `openssl rand -hex 16`; the private admin link is `https://<your-domain>/<ADMIN_PATH>` (**secret**) |
| `ANTHROPIC_API_KEY`               | From console.anthropic.com (**secret**)                                                             |
| `ANTHROPIC_MODEL`                 | `claude-sonnet-5-5`                                                                                 |
| `PAYMENT_PROVIDER`                | `paystack`                                                                                          |
| `PAYSTACK_SECRET_KEY`             | Live secret key `sk_live_…` (**secret**; test keys are refused in production)                       |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Live public key `pk_live_…`                                                                         |
| `CRON_SECRET`                     | `openssl rand -hex 32` (**secret**; Vercel sends it to the notification job)                        |
| `RESEND_API_KEY`                  | From Resend (**secret**)                                                                            |
| `EMAIL_FROM`                      | e.g. `Concierge by 6IX <hello@<your-domain>>`                                                       |

- [ ] The app checks these when it starts and refuses to run with a missing or unsafe value
      (mock payments, test keys, no admin path, http URL). Check the first deployment's logs for
      "Invalid server environment variables" if it fails.
- [ ] Function region: `vercel.json` pins `lhr1` (London), next to the database.

## 5. Hosting (Vercel)

- [ ] Import the repo; framework Next.js; production branch `main`; build command `npm run build`;
      Settings → General → Node.js version 22.x (the repo pins 22 in `.nvmrc`).
- [ ] Deploy. Check: `https://<your-domain>/api/health` returns `"status": "ok"`, `"database": "ok"`,
      the commit in `"version"`, and `true` for every service you configured. It answers 503 when the
      database can't be reached.
- [ ] Check: `vercel.json` cron `/api/notifications/dispatch` appears under Settings → Cron Jobs
      (every 5 minutes).
- [ ] Settings → Deployment Protection: protect Preview deployments so only the team can open them.

## 6. Payment webhooks

- [ ] Paystack dashboard → Settings → API Keys & Webhooks:
  - Callback URL: `https://<your-domain>/api/payments/callback`
  - Webhook URL: `https://<your-domain>/api/payments/webhook/paystack`
- [ ] If using Flutterwave instead: webhook URL `https://<your-domain>/api/payments/webhook/flutterwave`,
      and set the same secret hash in Flutterwave and in `FLUTTERWAVE_WEBHOOK_HASH`.
- [ ] Paystack → Settings → Preferences → Transfers: turn off "Confirm transfers before sending"
      (OTP) so payouts to businesses go out automatically. Transfer results arrive on the same webhook.
- [ ] Every webhook is checked against the provider's signature and re-verified with the provider
      before anything is marked paid, so a forged call does nothing. A second payment for an already
      paid booking is refunded automatically.
- [ ] Check with a real ₦100 test booking (step 10): the booking shows **Paid and confirmed**, and the
      admin Payments page shows the payment with the right commission.

## 7. Email

- [ ] Resend → Domains: add `<your-domain>`, then add the SPF, DKIM and return-path DNS records it lists.
      Wait for **Verified**.
- [ ] Add a DMARC record: `_dmarc.<your-domain>` TXT `v=DMARC1; p=quarantine; rua=mailto:dmarc@<your-domain>`.
- [ ] Supabase → Auth → SMTP: host `smtp.resend.com`, port `465`, user `resend`, password = a Resend
      API key, sender `EMAIL_FROM`.
- [ ] Turn on email notifications. The platform setting `notification_channels` controls which
      channels get a copy of each in-app notification. Set it once in the Supabase SQL editor:
  ```sql
  update public.platform_settings set value = '["email"]' where key = 'notification_channels';
  ```
- [ ] Check: request a password reset for your own account and receive it; book something and
      receive the "booking requested" email within 5 minutes. Admin → Notifications shows deliveries
      that failed (wrong sender domain, bad key).

## 8. Storage

- [ ] Nothing to create by hand: buckets, size limits and access rules come from the migrations.
- [ ] Check: upload a logo in the business dashboard and see it on the public profile; upload a
      verification document and confirm the file is **not** reachable without signing in.
- [ ] Storage usage alert in Supabase → Settings → Billing at 80% of the plan quota.

## 9. Monitoring and error logs

- [ ] Better Stack → Uptime: monitor `https://<your-domain>/api/health` every 3 minutes; alert on a
      non-200 or on `"database": "down"`. Add the team's phones and emails to on-call.
- [ ] Vercel → Project → Log Drains: add the Better Stack drain. Every server error is one JSON line
      with `"level":"error"`, a message and a request path (see `src/instrumentation.ts`).
- [ ] Better Stack → Alerts: alert on any `"level":"error"` line, and on more than 5
      `"Payment callback failed"` or `"Notification delivery failed"` in 10 minutes.
- [ ] Supabase → Reports: email alert at 80% database CPU and 80% disk.
- [ ] The admin dashboard's Security page lists rate-limit hits, blocked AI replies, payment
      mismatches and duplicate payments; check it weekly.

## 10. Database backups

- [ ] Supabase Pro keeps daily backups for 7 days. Turn on **Point-in-Time Recovery** (add-on) so
      any moment in the last 7 days can be restored.
- [ ] Monthly: download a logical backup and keep it in encrypted storage outside Supabase:
  ```sh
  npx supabase db dump --linked -f backup-$(date +%F).sql          # schema
  npx supabase db dump --linked --data-only -f data-$(date +%F).sql # data
  ```
  These files contain customers' personal data: store them encrypted, never in the repository or
  a shared drive.
- [ ] Restore drill before launch and every quarter: restore the latest backup into a scratch
      Supabase project and open the app against it.

## 11. First admin and launch data

- [ ] Sign up on the live site with the admin's real email, then promote that account in the
      Supabase SQL editor (the only way to create an admin; nobody can choose the role):
  ```sql
  update public.users set role = 'admin' where email = '<admin email>';
  ```
- [ ] Open `https://<your-domain>/<ADMIN_PATH>`; set the platform commission, plan prices,
      featured prices and the booking fee on the Commission and Revenue pages.
- [ ] Add the service categories on the Categories page.
- [ ] Approve the first verified businesses.

## 12. Go-live checks (on a phone)

- [ ] Sign up as a customer, ask the concierge for a provider, compare, book, pay ₦100 with a real
      card, chat with the business, complete the job and leave a review.
- [ ] Refund that test booking from the admin dashboard and see the refund arrive.
- [ ] `https://<your-domain>/admin` shows "Page not found"; only the private link opens the dashboard.
- [ ] `https://<your-domain>/api/health` is green in Better Stack.

## Every release after launch

1. Open a pull request; CI must be green (checks, database tests, browser suites).
2. Merge to `main`. If the release has new migrations, run `npx supabase db push` **before** merging
   (migrations are written to work with the old and new app during the switch).
3. Vercel deploys `main` automatically. Watch `/api/health` and the error alerts for 15 minutes.
4. To roll back: Vercel → Deployments → previous deployment → **Promote to Production**. Database
   changes are rolled forward with a new migration, never by editing an applied one.
