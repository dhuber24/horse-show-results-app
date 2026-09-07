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
   | `API_URL`, `NEXT_PUBLIC_API_URL` | `https://gaitdesk-api.onrender.com` |
   | `CORS_ORIGINS` | `https://gaitdesk-web.onrender.com` |
   | `AUTH_URL`, `PUBLIC_APP_URL` | `https://gaitdesk-web.onrender.com` |

   Use the actual URLs displayed by Render if it assigns a different hostname.
   Set `DATABASE_URL` to Neon’s connection string. The backend accepts both
   Neon’s standard `postgresql://...` URL and an async
   `postgresql+asyncpg://...` URL.

5. Confirm `https://<api-host>/health/ready` returns a success response, then
   open the web service and test sign-in, registration, an authenticated write,
   and a document upload.

## Custom domain

Add these custom domains from each Render service's **Settings > Custom Domains**
page, then copy the requested DNS records into the domain registrar:

- Main web service: apex domain and `www`.
- API service: `api` subdomain.

When DNS has verified, update the variables and redeploy both services:

| Variable | Production value |
| --- | --- |
| `API_URL`, `NEXT_PUBLIC_API_URL` | `https://api.yourdomain.com` |
| `CORS_ORIGINS` | `https://yourdomain.com,https://www.yourdomain.com` |
| `AUTH_URL`, `PUBLIC_APP_URL` | `https://yourdomain.com` |

Choose one of the apex or `www` names as canonical and redirect the other to it.
Render provides TLS certificates after verification.

## Operations

- Use an always-on paid Render plan for both services.
- Keep the services in the same region as practical; the Blueprint uses Ohio,
  near a US East Neon database.
- Run migrations as a deliberate pre-release step after a backup. The app's
  startup schema creation does not replace the migration runner.
- Enable SMTP before relying on email notifications or email-based workflows.
