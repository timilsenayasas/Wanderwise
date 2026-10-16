"""F1 profile: the logged-in user's travel preferences."""

from fastapi import APIRouter
from sqlalchemy import select

from app.database import DbSession
from app.models import Preference
from app.schemas import PreferenceIn, PreferenceOut
from app.security import CurrentUser

router = APIRouter(prefix="/api/me/preferences", tags=["preferences"])


@router.get("", response_model=PreferenceOut)
def get_preferences(user: CurrentUser, db: DbSession) -> PreferenceOut:
    preference = db.scalar(select(Preference).where(Preference.user_id == user.id))

    if preference is None:
        # Nothing saved yet: return empty defaults (id 0 = not stored).
        return PreferenceOut(
            id=0,
            user_id=user.id,
            home_city="",
            interests="",
            default_budget=None,
            travel_style="",
        )

    return preference


@router.put("", response_model=PreferenceOut)
def update_preferences(body: PreferenceIn, user: CurrentUser, db: DbSession) -> PreferenceOut:
    preference = db.scalar(select(Preference).where(Preference.user_id == user.id))

    if preference is None:
        preference = Preference(user_id=user.id)
        db.add(preference)

    preference.home_city = body.home_city
    preference.interests = body.interests
    preference.default_budget = body.default_budget
    preference.travel_style = body.travel_style

    db.commit()
    db.refresh(preference)
    return preference
