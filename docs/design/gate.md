# The In-Gate

Read before changing `/gate`, check-in or no-shows, how a class starts and finishes at the gate, `classes.gate_status`, or anything that reads them — the public schedule's live badge (`lib/class-progress.ts`) and exhibitor self-entry (`backend/self_entry.py`) both do. The role itself is in [accounts.md](accounts.md); what a class's placings do afterwards is in [results-and-scoring.md](results-and-scoring.md).

These are the rules this part of the app keeps and the reasons behind them. One claim per bullet, the claim first. Add new ones under the heading they belong to.

## Key Files

| Area | File |
| --- | --- |
| Ready, on deck, what may start and what a start closes | `backend/gate_rules.py` |
| The gate's endpoints | `backend/routers/gate.py` |
| The steward's screen | `frontend/app/gate/[showId]/GatePanel.tsx` |
| The schedule's live badge | `frontend/lib/class-progress.ts` |

## The data

- `entries.gate_order`: the order of go within a class, 1-based (migration 075); NULL falls back to back-number order. Dragged into place or drawn at random (SC-185.I), at any time.
- `entries.gate_checked_in` (migration 076) and `entries.gate_no_show` (migration 162): **where a rider stands at the gate, never both.** `PATCH .../entries/{id}/check-in` takes `{checked_in, no_show}` and refuses both true; both false is back to waiting. `no_show` defaults to false so an older screen that only sends `checked_in` still works.
- `classes.gate_status`: `pending`, `in_progress` or `done` as the gate writes it (migrations 076, 077). **`ready` is still allowed by the CHECK and is no longer written** — see below — and every reader treats a stored `ready` as not started.

## Check-in and no-shows

- **A no-show is not a scratch.** The entry stays `ENTERED`, on the bill and in the class; scratching is the office's or the exhibitor's call and never the gate's. What a no-show changes is who is in the class that ran: the class can be ready without them, the scribe screens do not list them, the APHA placing-depth check before posting does not count them, and a high-point chart's class size does not count them — a horse that never entered the ring was not shown.
- **Riders can be checked in for any class not yet started**, not only the one on deck. The steward works down the day as riders arrive. It closes once a class is in the ring.
- **A rider added to a class already in the ring is not checked in.** They go straight into the class. Exhibitors still cannot add themselves to a class in the ring (`CLASS_UNDER_WAY` in `self_entry.py`); the office can, until the class is completed.

## Ready

- **Ready is worked out from the riders, never stored** (`gate_rules.gate_status`). A class not yet started is ready when somebody is checked in and every rider is checked in or a no-show; scratched entries are not riders. It used to be written by the check-in endpoint — the only thing that recomputed it — so a rider the office added to a ready class left it reading ready, and a scratch of the one rider still to check in left it pending. About twenty places add or scratch an entry; deriving it on read is the only way all of them are right. `GET /shows/{id}/gate/classes` serves the class list with it derived and the counts beside it.
- **Any number of classes can be ready at once**, since check-in is open ahead. Ready only means *may start when its turn comes*.
- **A class with nobody to ride it is skipped, not started** — no entries, or every rider a no-show (`nothing_to_run`).

## Classes run in order

- **Only a ring's on-deck class can start** — the first class that day in that ring not yet started — and only once ready. The gate cannot change the order of classes; the server refuses a start on any other class however ready it is. The running order is `class_date`, `sort_order`, `class_number`, the order `GET /shows/{id}/classes/` hands every screen.
- **Starting a class finishes the classes in the ring ahead of it.** The steward starts the next class when it goes in, and the one before is over; there is no prompt. **Mark class done** remains for the last class in a ring, and before a break.
- **Classes that run together are started together, not recorded as a group.** "Run with #12" on the on-deck class (`concurrent: true`) starts it alongside the classes already in the ring, and the next ordinary start finishes the whole group. The group is simply the classes in progress in the ring, so nothing new is stored and nothing can disagree with it. The one-class-per-ring 409 this replaced asked "is the previous class finished?" every time two classes really did run as one go.
- **Skipping is for the on-deck class only.** It marks a class completed, which shuts out late entries — so a class further down the day cannot be skipped early.
- **Undo start is refused once a later class in the ring has started; reopen once a later class has finished.** Both would put the ring's history out of order. Reopening a class while a later one is in the ring is allowed — the two then run together, which is how a "Start" tapped where "Run with" was meant is put right.
- **Clearing check-ins is for a class not yet started.** A started class is put back with undo start or reopen.

## The screen

- **The gate screen polls every 10 seconds** (`POLL_MS`) — the class list and the open class's riders — so a rider the office adds or scratches, a second steward's check-ins, or a class moved in the schedule reach the steward on their own. It stops while the tab is hidden and refreshes the moment it is visible again.
- **A refresh never paints over a tap.** Every write bumps a generation counter and a refresh that set off before it is dropped; once the last write lands the screen reads everything back, since two quick taps each answer with the class status as of their own commit.
- **A tap that did not reach the server says so.** A phone at the arena loses signal; the old screen's check-in had no handler for a failed request, so the button came back and nothing changed, and the steward took it as saved. A failed refresh only shows a quiet "can't reach the server" line.
- **Each rider saves on their own**, so a line of riders can be checked in without waiting for each tap to come back. Class-level buttons wait for them.
