import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.responses import JSONResponse
from sqlalchemy import text

from database import engine, Base
from dependencies import INTERNAL_API_KEY
import models  # noqa: F401 — ensure all models are registered before create_all
from routers.shows import router as shows_router
from routers.rings import router as rings_router
from routers.disciplines import router as disciplines_router
from routers.divisions import router as divisions_router
from routers.classes import router as classes_router
from routers.people import users_router, horses_router, exhibitors_router
from routers.trainers import router as trainers_router
from routers.trainer_documents import router as trainer_documents_router
from routers.breeds import router as breeds_router
from routers.horse_colors import router as horse_colors_router
from routers.horse_documents import router as horse_documents_router, documents_router
from routers.exhibitor_documents import router as exhibitor_documents_router
from routers.entries import router as entries_router, coggins_audit_router
from routers.results import router as results_router
from routers.auth import router as auth_router
from routers.dashboard import router as dashboard_router
from routers.backnumbers import router as backnumbers_router
from routers.venues import router as venues_router
from routers.show_types import router as show_types_router
from routers.show_staff import router as show_staff_router
from routers.certifications import router as certifications_router
from routers.apha_standard_classes import router as apha_standard_classes_router
from routers.aqha_standard_classes import router as aqha_standard_classes_router
from routers.standard_setup import router as standard_setup_router
from routers.futurities import public_router as futurities_public_router
from routers.futurities import router as futurities_router
from routers.side_pots import router as side_pots_router
from routers.show_registration import router as show_registration_router
from routers.show_fees import router as show_fees_router
from routers.show_judges import router as show_judges_router
from routers.judges import router as judges_router
from routers.associations import router as associations_router
from routers.sanctioning import (
    registry_router as sanctioning_registry_router,
    requests_router as sanctioning_requests_router,
    show_router as show_sanctioning_router,
)
from routers.user_invites import router as user_invites_router
from routers.gate import router as gate_router
from routers.horse_access import router as horse_access_router
from routers.my_shows import router as my_shows_router
from routers.show_contact import router as show_contact_router
from routers.show_office import router as show_office_router
from routers.show_financials import router as show_financials_router
from routers.show_desk import router as show_desk_router
from routers.show_waivers import router as show_waivers_router

# uvicorn configures its own named loggers but leaves the root logger with no
# handlers at WARNING, so every logger.info() in this codebase was being
# discarded — including mailer.py's "Email not sent (no SMTP configured)", which
# is exactly the line someone debugging email needs to see. Plain basicConfig
# (never force=True) is a no-op if the root already has handlers, so this adds
# the missing configuration without displacing uvicorn's.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not INTERNAL_API_KEY:
        raise RuntimeError("INTERNAL_API_KEY environment variable is not set — refusing to start")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Horse Show Results API",
    lifespan=lifespan,
    description="Entry and results management for ranch and western pleasure horse shows.",
    version="0.1.0",
)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request, exc):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please try again later."}
    )

# Health endpoints are excluded because docker-compose polls `/` every 10
# seconds — 8,640 lines a day of nothing, which is how a log becomes something
# nobody reads.
_UNLOGGED_PATHS = {"/", "/health/ready"}

# How long the readiness probe waits on the database before calling it down.
READINESS_TIMEOUT_SECONDS = 5


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Method, path, status and duration for every request.

    uvicorn's own access log carries no timing and cannot escalate on failure.
    Deliberately no try/except around `call_next`: Starlette already logs
    unhandled exceptions with a traceback, and wrapping would double-log every
    500.
    """
    started = time.perf_counter()
    response = await call_next(request)
    if request.url.path not in _UNLOGGED_PATHS:
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.log(
            logging.WARNING if response.status_code >= 500 else logging.INFO,
            "%s %s -> %d (%.0fms)",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
    return response


ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "X-User-Id", "X-User-Role"],
)

app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(shows_router)
app.include_router(rings_router)
app.include_router(disciplines_router)
app.include_router(divisions_router)
app.include_router(classes_router)
app.include_router(users_router)
app.include_router(horses_router)
app.include_router(trainers_router)
app.include_router(trainer_documents_router)
app.include_router(breeds_router)
app.include_router(horse_colors_router)
app.include_router(horse_documents_router)
app.include_router(documents_router)
app.include_router(exhibitor_documents_router)
app.include_router(exhibitors_router)
app.include_router(entries_router)
app.include_router(coggins_audit_router)
app.include_router(results_router)
app.include_router(backnumbers_router)
app.include_router(venues_router)
app.include_router(show_types_router)
app.include_router(associations_router)
app.include_router(show_staff_router)
app.include_router(certifications_router)
app.include_router(apha_standard_classes_router)
app.include_router(aqha_standard_classes_router)
app.include_router(standard_setup_router)
app.include_router(side_pots_router)
# Public first, and it has to stay that way. FastAPI matches routes in
# registration order, and the admin router carries `GET /{futurity_id}` under
# the same prefix — registered ahead of the public router it swallows
# `/futurities/public`, which then fails as a router-level auth check plus a
# UUID parse error on the literal string "public". That is how the show bill's
# futurity section quietly rendered nothing. `show_fees` avoids the problem a
# different way — one router with per-route auth, so `/public` can simply be
# declared above `/{fee_id}` — which is not available here because the futurity
# router gates every route at the router level.
app.include_router(futurities_public_router)
app.include_router(futurities_router)
app.include_router(show_registration_router)
app.include_router(show_fees_router)
app.include_router(show_judges_router)
app.include_router(judges_router)
app.include_router(sanctioning_registry_router)
app.include_router(sanctioning_requests_router)
app.include_router(show_sanctioning_router)
app.include_router(user_invites_router)
app.include_router(gate_router)
app.include_router(horse_access_router)
app.include_router(my_shows_router)
app.include_router(show_contact_router)
app.include_router(show_office_router)
app.include_router(show_financials_router)
app.include_router(show_desk_router)
app.include_router(show_waivers_router)


@app.get("/", tags=["Health"])
async def root():
    """Liveness only — deliberately does not touch the database.

    docker-compose polls this, and `frontend.depends_on.backend.condition:
    service_healthy` means a failure here stops the frontend from starting. A
    transient Neon blip must not do that, so the database check lives on
    /health/ready instead. Do not "tidy" the two into one.
    """
    return {"status": "ok", "app": "Horse Show Results API"}


@app.get("/health/ready", tags=["Health"])
async def readiness():
    """Readiness — can this process actually reach the database?

    Separate from `/` on purpose (see above). Returns 503 rather than raising so
    a monitor reads a status rather than a stack trace.
    """
    async def _ping():
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    try:
        # Bounded on purpose. An unreachable host does not refuse the
        # connection, it goes unanswered — and pool_pre_ping retries — so
        # without this the probe hangs until the caller gives up and reports
        # nothing. A readiness check that never answers is no more use than one
        # that always says yes.
        await asyncio.wait_for(_ping(), timeout=READINESS_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.error("Readiness check timed out after %ss", READINESS_TIMEOUT_SECONDS)
        return JSONResponse(
            status_code=503, content={"status": "degraded", "database": "timeout"}
        )
    except Exception:
        logger.exception("Readiness check failed: database unreachable")
        return JSONResponse(
            status_code=503, content={"status": "degraded", "database": "error"}
        )
    return {"status": "ok", "database": "ok"}
