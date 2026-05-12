# Codex Handoff — Horse Section Improvements

This document describes the remaining frontend work to complete the horse section
improvements. All backend changes are already committed and ready.

---

## Background

Two feature branches worth of changes are staged in the working tree:

1. **Exhibitor contact fields** (migration 041) — added `phone`, `address`,
   `city`, `state`, `zip`, `emergency_contact_name`, `emergency_contact_phone`,
   `parent_guardian_name`, `parent_guardian_phone` to `exhibitors`. The backend
   model, schemas, and PATCH handler already support these. A new tabbed profile
   page (`ProfileTabs`, `EditAccountForm`) exposes them to exhibitors.

2. **Trainer registry** (migration 042) — a new `trainers` table. Horses now
   have a `trainer_id` FK alongside the legacy `trainer_name` free-text field.
   The backend router, schemas, and horse update logic are all done. The
   `HorseOut.trainer_name` field is resolved: it returns the linked trainer's
   name when `trainer_id` is set, otherwise the free-text value.

---

## Styling conventions

All UI uses an inline warm-brown palette. Follow these exactly — do not use
Tailwind color utilities for brand colours:

| Token | Value |
|---|---|
| Dark brown (headings, text) | `#2c1810` |
| Medium brown (labels) | `#8b7355` |
| Rust (primary action) | `#8b4513` |
| Light tan (border) | `#d4b896` |
| Off-white background | `#faf7f2` |
| Muted label | `#a89070` |

Primary buttons: `backgroundColor: '#8b4513', color: '#ffffff'`  
Inputs: `className="border rounded px-3 py-2 text-sm"`, `style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}`  
Section borders: `style={{ borderColor: '#d4b896' }}`

---

## Task 1 — Add `fetchTrainers` to `frontend/lib/api.ts`

Follow the exact pattern of `fetchBreeds` (already in that file, line ~99):

```ts
export async function fetchTrainers() {
  const res = await fetch(`${API_URL}/trainers/`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}
```

Note: `fetchTrainers` needs auth headers because `GET /trainers/` requires
authentication. Check how `fetchExhibitors` does it (line ~51) — it accepts
optional `headers?: HeadersInit`. Do the same for `fetchTrainers`.

---

## Task 2 — `TrainerSelect` component

**File:** `frontend/components/TrainerSelect.tsx`  
**Type:** `'use client'` component

### Behaviour
- On mount, fetches `/api/trainers` to get the registry list.
- Shows a `<select>` dropdown with one `<option>` per trainer (sorted by name),
  plus a sentinel option `"Other — enter name"` at the bottom.
- When a trainer from the registry is selected, calls `onChange` with
  `{ trainerId: trainer.id, trainerName: null }`.
- When "Other" is selected, reveals a text `<input>` beneath the dropdown.
  As the user types, calls `onChange` with
  `{ trainerId: null, trainerName: value }`.
- Clearing the text input (empty string) calls `onChange` with
  `{ trainerId: null, trainerName: null }`.

### Props interface
```ts
interface Props {
  trainerId: string | null;
  trainerName: string | null;         // free-text value; only meaningful when trainerId is null
  onChange: (trainerId: string | null, trainerName: string | null) => void;
  disabled?: boolean;
}
```

### Initialisation logic
- If `trainerId` is non-null on mount → dropdown should show that trainer selected.
- If `trainerId` is null and `trainerName` is non-null on mount → dropdown shows
  "Other — enter name" and the text input is pre-filled with `trainerName`.
- If both are null → dropdown shows the placeholder option.

### Placeholder option
```html
<option value="">— No trainer —</option>
```

### Loading state
Show a disabled select with `"Loading trainers…"` while the fetch is in flight.

### Styling
Use the standard input style from the conventions table above. The text input
for manual entry should appear immediately below the select with `mt-2`.

---

## Task 3 — Admin trainer management page

**File:** `frontend/app/admin/trainers/page.tsx`

Pattern: follow `frontend/app/admin/breeds/` exactly — server component that
fetches the list and renders a client list component with inline add/edit/delete.

If there is no separate `breeds/` page (the breeds admin page lives at a
different path), look at `frontend/app/admin/horses/breeds/page.tsx` or
similar. The key pattern is:
- Server component loads initial data
- Client component manages state + inline form
- Breadcrumbs: Admin → Trainers
- Each row: trainer name, optional phone/email, Edit / Delete actions
- Add form: name (required), phone (optional), email (optional)
- Destructive delete uses inline confirm (not a modal — see project conventions in `CLAUDE.md`)

Register a link to this page in whatever admin nav or index page lists the
other lookup tables (breeds, colors, etc.).

---

## Task 4 — Update admin `NewHorseForm`

**File:** `frontend/app/admin/horses/new/NewHorseForm.tsx`

Changes needed:

1. **Owner is now optional.** Remove the `if (!form.owner_exhibitor_id)` guard
   that blocks save. The select should keep `"Select exhibitor…"` as the
   placeholder but saving without one is allowed.

2. **Replace trainer text input with `<TrainerSelect>`.**
   - Remove the `trainer_name` text input field.
   - Add `trainer_id: ''` and `trainer_name: ''` to the `form` state.
   - Render `<TrainerSelect trainerId={...} trainerName={...} onChange={...} />`.
   - In `handleSave`, include both `trainer_id` and `trainer_name` in the body
     (send null for whichever is not set; the backend enforces mutual
     exclusivity).

3. **Pass initial trainers** from the page. The page (`new/page.tsx`) should
   call `fetchTrainers(headers)` and pass the result as a `trainers` prop to
   `NewHorseForm` so `TrainerSelect` can receive it without an extra fetch.
   Alternatively, `TrainerSelect` can self-fetch — either approach is fine.

---

## Task 5 — Update admin `EditHorseForm`

**File:** `frontend/app/admin/horses/[id]/EditHorseForm.tsx`

Changes needed:

1. **Owner is optional.** Remove the `if (!form.owner_exhibitor_id)` save
   guard. Change the placeholder to `"— No owner linked —"`. If the horse has a
   legacy `owner_name` (from the DB column that still exists) and no linked
   exhibitor, show it as a read-only hint beneath the dropdown:
   ```
   {!form.owner_exhibitor_id && horse.owner_name && (
     <p className="text-xs mt-1" style={{ color: '#a89070' }}>
       Legacy owner on file: {horse.owner_name}
     </p>
   )}
   ```

2. **Replace trainer text input with `<TrainerSelect>`.**  
   Same as Task 4 above. The `Horse` interface needs `trainer_id: string | null`
   added. Initialise `form.trainer_id` from `horse.trainer_id ?? ''` and
   `form.trainer_name` from `horse.trainer_name ?? ''`.

3. **Add a Riders section** below the horse edit card.  
   - Fetch riders from `GET /api/horses/{horse.id}/riders` on component mount
     (client-side, since this is already a client component).
   - The response is `Array<{ exhibitor_id: string; full_name: string }>`.
   - Display as a simple read-only list under a "Riders" heading.
   - Show "No riders linked." when empty.
   - No add/remove UI needed here for now.

The `Horse` interface at the top of this file needs these additions:
```ts
owner_name: string | null;   // legacy free-text (read-only display only)
trainer_id: string | null;
```

---

## Task 6 — Update admin horse detail page

**File:** `frontend/app/admin/horses/[id]/page.tsx`

The page already fetches horse + breeds + colors + exhibitors + showTypes +
registrations in parallel. Add `fetchTrainers(headers)` to that `Promise.all`
and pass the result to `EditHorseForm` as a `trainers` prop (if you chose to
pass trainers down rather than letting `TrainerSelect` self-fetch).

Also add the `owner_name` field to the `fetchHorse` response type if needed —
it is already returned by `HorseOut` from the backend.

---

## Task 7 — Update profile `MyHorsesPanel`

**File:** `frontend/app/profile/MyHorsesPanel.tsx`

The "Add a Horse" inline form currently has a `trainer_name` text input. Replace
it with `<TrainerSelect>`.

Changes:
- Add `trainer_id: ''` to `emptyForm` (alongside the existing `trainer_name: ''`).
- In the form JSX, replace the trainer `<input>` with
  `<TrainerSelect trainerId={form.trainer_id} trainerName={form.trainer_name} onChange={...} />`.
- In `handleCreate`, include both `trainer_id` and `trainer_name` in the body
  (null out whichever is not set).

---

## Task 8 — Update profile `EditMyHorseForm`

**File:** `frontend/app/profile/horses/[id]/EditMyHorseForm.tsx`

Same trainer swap as Task 7. The `Horse` interface at the top needs
`trainer_id: string | null` added. Initialise `form.trainer_id` from
`horse.trainer_id ?? ''`.

---

## Task 9 — Delete dead file

**Delete:** `frontend/app/profile/EditExhibitorForm.tsx`

This file was created during the profile refactor but is not imported anywhere.
It has been superseded by `EditAccountForm.tsx`.

---

## Task 10 — Update `docs/database.md`

Add the following to the database documentation:

**New table: `trainers`**
- `id` UUID PK
- `name` TEXT NOT NULL
- `phone` TEXT nullable
- `email` TEXT nullable
- `created_at` TIMESTAMP WITH TIME ZONE

**Updated table: `horses`**
- `trainer_id` UUID FK → `trainers.id` ON DELETE SET NULL (nullable)
- `trainer_name` TEXT — free-text fallback when no registry entry is linked

**Updated table: `exhibitors`** (migration 041)
- `phone` TEXT nullable
- `address` TEXT nullable
- `city` TEXT nullable
- `state` TEXT nullable
- `zip` TEXT nullable
- `emergency_contact_name` TEXT nullable
- `emergency_contact_phone` TEXT nullable
- `parent_guardian_name` TEXT nullable
- `parent_guardian_phone` TEXT nullable

---

## Task 11 — Apply migrations

Run both pending migrations against the Neon database:

```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

Migrations to apply (in order):
- `041_exhibitor_contact_youth`
- `042_trainer_registry`

---

## Task 12 — Validation

From `frontend/`:
```bash
npm run type-check
npm run lint
```

From repo root:
```bash
py -m compileall backend
```

All must pass clean before the work is considered done.
