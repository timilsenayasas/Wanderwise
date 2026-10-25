"""
WanderWise backend (FastAPI): builds the app from the pieces below.

Where things live:
  config.py        settings from backend/.env
  database.py      engine, sessions, Base
  models.py        database tables  (change one -> create a migration, see README)
  schemas.py       request/response shapes (the API contract)
  plans.py         save/load a trip's generated plan (trip_days, activities, cost_items)
  security.py      passwords, JWT cookie, CurrentUser
  rate_limit.py    limits repeated failed logins
  services/        outside integrations (Gemini; later maps, weather)
  routers/         one file per feature: endpoints only

Adding a feature: put endpoints in a new routers/<feature>.py and include it below.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db_migrate import upgrade_database
from app.routers import auth, plan, preferences, trips


@asynccontextmanager
async def lifespan(_app: FastAPI):
    upgrade_database()
    yield


app = FastAPI(title="WanderWise API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(preferences.router)
app.include_router(trips.router)
app.include_router(plan.router)
