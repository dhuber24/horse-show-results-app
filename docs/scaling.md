# Scaling and cost

**Status: analysis only, no decision taken.** Written 2026-09-12 against commit
`72cfeda`. Nothing here has been implemented and nothing in the app has been
changed on the strength of it. Read "What these numbers are not" before quoting
a figure at anybody.

The question it answers: *what does GaitDesk cost on Render if several hundred
people use it at once?* The short answer is that cost is not the binding
constraint. **Capacity is**, and the ceiling is low enough that the money
question does not really arise until some architectural work is done first.

## The baseline being scaled from

[render.yaml](../render.yaml) puts both services on `0.5c-512mb` — 0.5 CPU,
512 MB, Render's old "Starter" tier at $7/service. Two services, so roughly
**$14/month of compute**, plus Neon, plus bandwidth that has never mattered.

## The load is polling, not clicks

This is the single most important thing to carry into any future rearchitecture
discussion, because it inverts the usual intuition about a low-traffic app.
GaitDesk's busiest screens are unattended: a phone propped on a rail, a tablet
on the in-gate table. Nobody is clicking. The traffic is timers.

- [ScheduleBoard.tsx](../frontend/app/shows/%5Bid%5D/schedule/ScheduleBoard.tsx)
  calls `router.refresh()` every **30 s** while the show is live.
- [AutoRefresh.tsx](../frontend/components/AutoRefresh.tsx) polls every **20 s**,
  mounted on the show hub and both Financials screens.

`router.refresh()` re-runs the **server** render. It is not a client-side
repaint — every tick is a full trip through Next, the API and Neon.

Per `/schedule` render the fan-out is `fetchShow` + `fetchClasses` +
`fetchProgramIndex`, plus an `auth()` session decrypt in
[showHubBack.ts](../frontend/app/shows/%5Bid%5D/_components/showHubBack.ts).

So for 270 spectators on the live schedule:

| | |
| --- | --- |
| Page renders | 270 / 30 s = **9 / sec** |
| Backend requests | ~3 per render = **~27 / sec** |
| Heavy class-list queries | **~9 / sec**, sustained all day |

## The four ceilings, in the order they bite

**1. Nothing is cached.** 98 files pass `cache: 'no-store'` and there is not a
single `revalidate` anywhere under `frontend/app/`. `/schedule` and `/results`
render *identically for every anonymous viewer*, and each viewer still gets
their own round trip to Neon. Three hundred people are being served three
hundred copies of one answer.

**2. Both services are single-process, so vertical scaling stops at one core.**
The frontend runs `next start` ([package.json](../frontend/package.json)) — one
Node process. The backend runs `uvicorn main:app` with no `--workers`
([Dockerfile.production](../backend/Dockerfile.production)) — one event loop.
Moving from `0.5c-512mb` to a four-core plan buys at most 2× (0.5 CPU → 1 CPU)
and then nothing at all. **Capacity here is bought in instances, not in plan
size** — which is why Forecast A below is shaped the way it is.

**3. The class-list query is the expensive one, and it scales with the
schedule.** `list_classes` in [routers/classes.py](../backend/routers/classes.py)
runs three correlated scalar subqueries *per class row* (placed count, entry
count, futurity membership) plus a `selectin` on `Class.sanctioning`. On the
172-class MNSPHC show that is ~516 subquery evaluations per call — and this is
the call being made nine times a second.

**4. The connection pool is at its defaults.**
[database.py](../backend/database.py) builds the engine with no `pool_size` or
`max_overflow`, so SQLAlchemy's defaults apply: **15 connections maximum**, with
`pool_timeout=30`. That matters for the *shape* of the failure more than for the
threshold. Past the cap, requests do not slow down gradually — they queue for
thirty seconds and then error. A load spike here is a cliff, not a ramp.

**Estimated ceiling on the current plan: 15–30 concurrent users on the live
schedule.** An RSC render of a 172-row schedule is roughly 30–60 ms of CPU;
nine renders/sec against a 0.5 CPU budget is already over, before TLS,
serialization or the per-request JWT decrypt.

## Forecast A — brute-force it, no code changes

Scaling by instances, because of ceiling 2.

| Item | Sizing | Monthly |
| --- | --- | --- |
| Frontend | 6 × Standard (`1c-2g`, $25) | $150 |
| Backend | 3 × Standard + `--workers 2` | $75 |
| Render Pro workspace (autoscaling requires it) | — | ~$25 |
| Bandwidth | ~9 GB per show day; 2 weekends ≈ 30 GB | ~$1 |
| Neon | ~3 CU hot on show days, autosuspend between | $20–40 |
| **Total** | | **~$270–300** |

Leaving Neon always-on at 3 CU adds roughly $230, pushing this past $500.

**Bandwidth is never the problem.** At $0.15/GB it stays noise even at this
scale; do not spend design effort on it.

## Forecast B — cache the public reads first

The three hundred people on `/schedule` want the same bytes. Serving them from
one cached answer for ten seconds collapses nine renders/sec to roughly
**0.1/sec**:

- `next: { revalidate: 10 }` on `fetchShow`, `fetchClasses`, `fetchResultsIndex`
  and `fetchProgramIndex` in [lib/api.ts](../frontend/lib/api.ts).
- Replace the three correlated subqueries in `list_classes` with two `GROUP BY`
  joins.
- `--workers 2` on uvicorn; `output: 'standalone'` in `next.config.mjs`.
- Set `pool_size` / `max_overflow` explicitly rather than inheriting defaults.

**Estimated total: $15–40/month** for the same several hundred users — the
current two $7 services, plus Neon on show days.

**Next's Data Cache works inside a dynamic route.** This is the detail that
makes the cheap fix cheap: the `auth()` call in `showHubBack` marks these routes
dynamic and therefore blocks *route-level* caching, but a per-`fetch`
`revalidate` still dedupes across users regardless. The win does not require
restructuring the signed-in/signed-out split first.

The cost of caching is up to ten seconds of staleness on screens that already
refresh every 20–30, and published results are a deliberate human action behind
`classes.results_published_at` — so nothing becomes visible earlier or later
than somebody intended. Worth re-checking against the gate screen before
shipping, since that one is closest to real-time.

## If this is revisited

Roughly in cost-of-work order, cheapest first. The first two are most of the
benefit.

1. **Load-test a copy** and replace the estimates here with measurements.
   Nothing else on this list should be sized off a guess.
2. **Cache the public read paths** (Forecast B). One file, largest single win.
3. **Fix the `list_classes` query shape.** Helps every caller, not just the
   polled ones.
4. **Multi-process both services** — uvicorn `--workers`, Next standalone.
   Needed before any plan upgrade pays for itself.
5. **Set the pool explicitly**, so the failure mode is backpressure rather than
   a thirty-second cliff.
6. **Reconsider the polling interval itself.** 30 s was chosen for freshness at
   the rail with no thought to cost; with caching in place it stops mattering,
   which is the argument for doing caching before touching it.

Only after 2–5 does buying a bigger plan make economic sense. Before then, money
is being spent to re-compute an identical page three hundred times a minute.

## What these numbers are not

- **The CPU-per-render figures are estimates inferred from code shape, not
  measurements.** 30–60 ms for an RSC render and 15–40 ms for serializing 172
  Pydantic models are informed guesses. A load test against a Neon branch would
  replace the whole of Forecasts A and B with real numbers, and is the first
  thing to do if this is picked up.
- **"Several hundred simultaneous" was modelled as 300 concurrent**, split
  ~270 spectators on public screens / ~25 exhibitors / ~5 staff. The staff
  screens are individually the heaviest in the app — the desk aggregate runs
  `build_account` across the whole roster — but there are too few of them to
  dominate. A show with a different mix moves the answer.
- **No real show has yet produced this load.** This is a forecast for growth,
  not a diagnosis of an observed problem.
- **Pricing is as of September 2026**, read off Render's and Neon's published
  pages: compute plans and per-GB bandwidth from Render's docs, CU-hour rates
  from Neon's. The Render **Pro workspace fee of ~$25/month came from a
  third-party summary, not Render's own table — confirm it** before relying on
  it. Everything else is first-party.

## Related

[deployment.md](deployment.md) — what is deployed, in what order, and how
releases work. The free-compute-tier question is answered there as well: free
spins down after fifteen minutes with a ~1 minute wake, which the two-hop
browser → web → API architecture turns into a timeout rather than a slow page,
and free blocks the SMTP ports the mailer is configured for.
