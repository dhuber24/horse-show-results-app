# Production deployment

GaitDesk runs as two public web services and a Neon PostgreSQL database:

- `gaitdesk-web`: Next.js application at the main website domain.
- `gaitdesk-api`: FastAPI API at an `api` subdomain.
- Neon: managed PostgreSQL; it is not created by `render.yaml`.

The root [render.yaml](../render.yaml) deploys the two Render services from this
repository. It deliberately contains names and non-secret defaults only.

## First deployment

1. Rotate the production Neon password, internal API key, and Auth.js secret.
   Do not reuse values from a local `.env` file.
2. Back up or branch the Neon database, then run every unapplied SQL migration:

   ```powershell
   powershell -ExecutionPolicy Bypass -File database/migrate.ps1
   ```

3. In Render, choose **New > Blueprint**, connect this GitHub repository, and
   use `render.yaml`.
4. Fill the prompted variables. On the first deploy, use Render's generated
   service URLs:

   | Variable | Initial value |
   | --- | --- |
   | `API_URL` | `https://gaitdesk-api.onrender.com` |
   | `CORS_ORIGINS` | `https://gaitdesk-web.onrender.com` |
   | `AUTH_URL`, `PUBLIC_APP_URL` | `https://gaitdesk-web.onrender.com` |

   `AUTH_URL` is not optional: Auth.js v5 infers `trustHost` from its presence,
   so leaving it unset breaks every sign-in.

   Use the actual URLs displayed by Render if it assigns a different hostname.
   Set `DATABASE_URL` to Neon’s connection string. The backend accepts both
   Neon’s standard `postgresql://...` URL (including its `sslmode` and
   `channel_binding` options) and an async `postgresql+asyncpg://...` URL.

5. Confirm `https://<api-host>/health/ready` returns a success response, then
   open the web service and test sign-in, registration, an authenticated write,
   and a document upload.

   If sign-in returns Auth.js's generic `CredentialsSignin` message, check the
   `gaitdesk-web` service logs. They safely record either the API response
   status or the URL/connectivity error, without recording the submitted email
   address or password.

## Custom domain

Add these custom domains from each Render service's **Settings > Custom Domains**
page, then copy the requested DNS records into the domain registrar:

- Main web service: apex domain and `www`.
- API service: `api` subdomain.

When DNS has verified, update the variables and redeploy both services:

| Variable | Production value |
| --- | --- |
| `API_URL` | `https://api.yourdomain.com` |
| `CORS_ORIGINS` | `https://yourdomain.com,https://www.yourdomain.com` |
| `AUTH_URL`, `PUBLIC_APP_URL` | `https://yourdomain.com` |

Choose one of the apex or `www` names as canonical and redirect the other to it.
Render provides TLS certificates after verification.

## Keep development off the production database

`render.yaml` does not create the database, so nothing stops `DATABASE_URL` in a
local `.env` from naming the same Neon branch the API serves from. That is how
the migration-133 outage happened: the rename of
`show_sanctioning.per_class_fee_cents` was applied from a developer machine
while the deployed release still mapped the old name. Every class load returned
500 — `Class.sanctioning` is `lazy="selectin"`, so this is *every* class load —
and `/health/ready` reported `{"status":"ok"}` throughout, because `SELECT 1`
touches no mapped column.

Use a Neon branch per environment:

1. In the Neon console, branch the production database (**Branches > New
   branch**) and name it `dev`. A branch is copy-on-write, so it costs little
   and starts with production's schema and data.
2. Point the local `.env` `DATABASE_URL` at the `dev` branch's connection
   string. Production keeps the parent branch, set only in Render.
3. Set `PRODUCTION_DATABASE_HOST` in the local `.env` to the *production*
   host (`ep-....neon.tech`, no credentials). `database/migrate.ps1` prints its
   target before doing anything and refuses to run against that host without
   `-AllowProduction`.

Migrating production then becomes a deliberate release step, in this order:

```powershell
# 1. Deploy the code that expects the new schema, or take the outage knowingly.
# 2. Then, and only then:
powershell -ExecutionPolicy Bypass -File database/migrate.ps1 -AllowProduction
```

Order matters in both directions, and neither is free. A migration ahead of its
deploy breaks the running release; a deploy ahead of its migration fails its own
readiness check and is not promoted. The second is the recoverable one, which is
why the readiness probe is allowed to fail on drift.

## What readiness actually checks

`/health/ready` answers two questions, and the second exists because the first
was green for the whole of the outage above:

- **Can this process reach the database?** `SELECT 1`, bounded at
  `READINESS_TIMEOUT_SECONDS`.
- **Does the database still have every column this build maps?**
  `backend/schema_drift.py` diffs `Base.metadata` against
  `information_schema.columns`, at most once a minute. Drift returns 503 with
  the offending columns named in `missing_columns`.

Drift is worth a 503 because there is no harmless case: SQLAlchemy selects every
mapped column, so a column the database lacks breaks every read of that table,
and no amount of restarting repairs it. `Base.metadata.create_all` at startup
creates a missing *table* but never adds a missing *column* — which is exactly
the gap a rename leaves.

A 503 here means Render will not promote the deploy. That is the intent: a
release that arrives before its migration should fail rather than replace a
working one.

## Which variables actually do something

Worth knowing before debugging a symptom against the wrong setting.

- **`API_URL` is the only API address the deployed app reads.** Every backend
  request is made server-side — from an `app/api/` route handler or a server
  component — so there is no `NEXT_PUBLIC_API_URL` in the Blueprint and no
  public copy in the bundle. `lib/api.ts` keeps it as a fallback purely for a
  standalone `npm run dev`.
- **`CORS_ORIGINS` is a guard, not a live setting.** It follows from the point
  above: no browser calls the API directly, so CORS is never exercised in normal
  operation. A failure here will not present as a CORS error, because there are
  no cross-origin browser requests to fail. Keep the value correct anyway.
- **`INTERNAL_API_KEY` is shared by both services** via `fromService`, so it
  cannot drift. `AUTH_SECRET` is deliberately a different value; regenerating it
  invalidates every session.
- **SMTP is optional and silent.** `mailer.py` returns `None` when `SMTP_HOST`
  is unset and never raises, and every flow that mails a link also returns the
  link. The variables it reads are `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`.

## Operations

- Use an always-on paid Render plan for both services.
- Keep the services in the same region as practical; the Blueprint uses Ohio,
  near a US East Neon database.
- Run migrations as a deliberate pre-release step after a backup. The app's
  startup schema creation does not replace the migration runner.
- Enable SMTP before relying on email notifications or email-based workflows.
