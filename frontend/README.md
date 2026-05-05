# Horse Show Results Frontend

Next.js 15 App Router PWA for the Horse Show Results app.

## Local Development

From `frontend/`:

```bash
npm run dev
```

The full app is usually run from the repo root with:

```bash
docker-compose up
```

## Important Files

| Path | Purpose |
| --- | --- |
| `app/` | App Router pages, layouts, and route handlers |
| `app/api/` | Server-side proxy routes to FastAPI |
| `auth.ts` | NextAuth credentials configuration |
| `lib/backend-fetch.ts` | Auth header helper and backend fetch wrapper |
| `lib/api.ts` | Shared fetch helpers |
| `components/` | Shared components used across app routes |
| `types/next-auth.d.ts` | NextAuth session/JWT type augmentation |

## Backend Proxy Pattern

Authenticated mutations should normally call a route handler under `app/api/`. The route handler should call `getAuthHeaders()`, forward the request to FastAPI, and preserve the backend response status.

See [../docs/frontend.md](../docs/frontend.md) for frontend conventions.

## Validation

```bash
npm run type-check
npm run lint
npm run build
```

