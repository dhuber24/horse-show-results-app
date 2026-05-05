# Auth And Roles

Authentication uses NextAuth credentials on the frontend and bcrypt password verification on the FastAPI backend.

## Login Flow

1. User submits credentials on `/login`.
2. `frontend/auth.ts` posts to backend `POST /auth/verify`.
3. Backend verifies email/password and checks `users.is_approved`.
4. NextAuth stores `id` and `role` in the JWT/session.
5. Authenticated Next route handlers forward `X-User-Id` and `X-User-Role` to FastAPI.

## Roles

| Role | Purpose |
| --- | --- |
| `ADMIN` | Full system access, user management, venues, configuration, all shows |
| `SHOW_MANAGER` | Requests and manages hosted shows; can assign show secretaries and scorekeepers |
| `SHOW_SECRETARY` | Manages assigned shows, classes, entries, back numbers, and results administration |
| `SCOREKEEPER` | Enters placings for assigned shows |
| `EXHIBITOR` | Views own entries/results and manages profile/horses |

## Registration

- Exhibitor registration at `/register` creates both a `users` row and a linked `exhibitors` row. Keep those atomic.
- Show Secretary registration at `/register/show-secretary` captures association certifications. APHA certification is required when APHA is selected.
- Show Manager registration at `/register/show-manager` is available immediately. APHA certification lookup is informational.
- New self-registered Show Secretaries and Show Managers are currently auto-approved. The `is_approved` column remains as an account lock gate.
- Show Manager approval happens at the show request level, not at account creation.

## Backend Guards

Common guards live in `backend/dependencies.py`:

| Guard | Requires |
| --- | --- |
| `require_api_key` | Valid `X-API-Key` |
| `require_authenticated` | Valid `X-API-Key` and `X-User-Id` |
| `require_admin` | Valid API key and `ADMIN` role |
| `require_admin_or_show_admin` | `ADMIN`, `SHOW_SECRETARY`, or `SHOW_MANAGER` |
| `require_admin_or_show_manager` | `ADMIN` or `SHOW_MANAGER` |
| `require_admin_or_scorekeeper` | `ADMIN` or `SCOREKEEPER` |

Show-scoped write access is usually checked with join tables:

- `show_secretaries`
- `show_managers`
- `show_scorekeepers`

## Sharp Edges

- Do not trust client-provided role or user IDs from browser code. Only server-side Next route handlers should attach backend auth headers.
- Any endpoint returning PII or horse ownership data should require auth.
- When changing an `EXHIBITOR` user to another role, the linked exhibitor data is preserved but the exhibitor dashboard no longer applies.

