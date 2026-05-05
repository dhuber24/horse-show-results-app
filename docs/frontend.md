# Frontend

The frontend is a Next.js 15 App Router PWA in `frontend/`.

## Key Conventions

- Pages and layouts live under `frontend/app/`.
- Route handlers live under `frontend/app/api/`.
- Shared non-route components live in `frontend/components/`.
- Shared frontend helpers live in `frontend/lib/`.
- Authentication is configured in `frontend/auth.ts`.
- Type augmentation for NextAuth lives in `frontend/types/next-auth.d.ts`.

## Backend Access

Authenticated browser actions should call a Next route handler. The route handler should:

1. Call `getAuthHeaders()` from `frontend/lib/backend-fetch.ts`.
2. Return `401` if there is no session.
3. Forward the request to FastAPI with auth headers.
4. Preserve backend status codes in the response.

Prefer `safeFetchBackend()` when the backend may return `204 No Content` or a non-JSON error.

## UI Patterns

- Admin pages use `frontend/components/Breadcrumbs.tsx`.
- Destructive actions use inline confirmation text, not modal overlays.
- Disabled buttons should include a `title` explaining why they are disabled.
- Keep admin and operational screens dense, scannable, and predictable.
- Avoid adding new uses of `ConfirmDialog`; the current convention is inline confirmation.

## Important Routes

| Route | Purpose |
| --- | --- |
| `/` | Public show list |
| `/shows/[id]` | Public show detail and scorekeeper class links |
| `/shows/[id]/classes/[classId]` | Public class results |
| `/shows/[id]/classes/[classId]/scorekeeper` | Scorekeeper placing form |
| `/scorekeeper` | Scorekeeper assigned shows |
| `/dashboard` | Exhibitor entries dashboard |
| `/profile` | User profile and exhibitor horse list |
| `/profile/horses/[id]` | Exhibitor horse editing and documents |
| `/admin` | Admin landing |
| `/admin/shows` | Admin/manager/secretary show list |
| `/admin/shows/[id]` | Show management dashboard |
| `/admin/shows/[id]/classes` | Class list, reorder, APHA import |
| `/admin/shows/[id]/entries` | Entries by class |
| `/admin/shows/[id]/back-numbers` | Show-level back number assignment |
| `/admin/users` | User management |
| `/admin/venues` | Venue management |
| `/admin/show-requests` | Admin show request review |
| `/show-requests` | Show Manager request list |

## Validation

Run from `frontend/`:

```bash
npm run type-check
npm run lint
npm run build
```

`npm run lint` may need adjustment if the Next.js lint command changes; verify against the installed Next.js version before assuming older APIs.

