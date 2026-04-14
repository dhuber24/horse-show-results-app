from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.shows import router as shows_router
from routers.rings import router as rings_router
from routers.divisions import router as divisions_router
from routers.classes import router as classes_router
from routers.people import users_router, horses_router, riders_router
from routers.entries import router as entries_router
from routers.results import router as results_router
from routers.auth import router as auth_router
from routers.dashboard import router as dashboard_router

app = FastAPI(
    title="Horse Show Results API",
    description="Entry and results management for ranch and western pleasure horse shows.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(shows_router)
app.include_router(rings_router)
app.include_router(divisions_router)
app.include_router(classes_router)
app.include_router(users_router)
app.include_router(horses_router)
app.include_router(riders_router)
app.include_router(entries_router)
app.include_router(results_router)


@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "app": "Horse Show Results API"}
