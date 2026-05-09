import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.responses import JSONResponse

from database import engine, Base
from dependencies import INTERNAL_API_KEY
import models  # noqa: F401 — ensure all models are registered before create_all
from routers.shows import router as shows_router
from routers.rings import router as rings_router
from routers.divisions import router as divisions_router
from routers.classes import router as classes_router
from routers.people import users_router, horses_router, exhibitors_router
from routers.breeds import router as breeds_router
from routers.horse_colors import router as horse_colors_router
from routers.horse_documents import router as horse_documents_router
from routers.exhibitor_documents import router as exhibitor_documents_router
from routers.entries import router as entries_router
from routers.results import router as results_router
from routers.auth import router as auth_router
from routers.dashboard import router as dashboard_router
from routers.backnumbers import router as backnumbers_router
from routers.venues import router as venues_router
from routers.show_types import router as show_types_router
from routers.show_staff import router as show_staff_router
from routers.show_requests import router as show_requests_router
from routers.certifications import router as certifications_router
from routers.apha_standard_classes import router as apha_standard_classes_router
from routers.standard_setup import router as standard_setup_router
from routers.side_pots import router as side_pots_router

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
app.include_router(divisions_router)
app.include_router(classes_router)
app.include_router(users_router)
app.include_router(horses_router)
app.include_router(breeds_router)
app.include_router(horse_colors_router)
app.include_router(horse_documents_router)
app.include_router(exhibitor_documents_router)
app.include_router(exhibitors_router)
app.include_router(entries_router)
app.include_router(results_router)
app.include_router(backnumbers_router)
app.include_router(venues_router)
app.include_router(show_types_router)
app.include_router(show_staff_router)
app.include_router(show_requests_router)
app.include_router(certifications_router)
app.include_router(apha_standard_classes_router)
app.include_router(standard_setup_router)
app.include_router(side_pots_router)


@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "app": "Horse Show Results API"}
