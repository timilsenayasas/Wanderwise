
"""B3: Cached destination photos from Pexels."""

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.database import DbSession
from app.models import DestinationPhoto
from app.services.pexels import search_destination_photo

router = APIRouter(prefix="/api/photos", tags=["photos"])


@router.get("")
def get_destination_photo(
    db: DbSession,
    query: str = Query(min_length=1, max_length=120),
) -> dict:
    """Return a cached destination photo or search Pexels once."""

    destination = " ".join(query.split()).casefold()

    if not destination:
        return {"photo_url": None, "photographer": None, "photographer_url": None}

    cached = db.scalar(
        select(DestinationPhoto).where(
            DestinationPhoto.destination == destination
        )
    )

    if cached is not None:
        return {
            "photo_url": cached.photo_url,
            "photographer": cached.photographer,
            "photographer_url": cached.photographer_url,
        }

    photo = search_destination_photo(destination)

    if photo is None:
        return {"photo_url": None, "photographer": None, "photographer_url": None}

    db.add(
        DestinationPhoto(
            destination=destination,
            photo_url=photo["photo_url"],
            photographer=photo["photographer"],
            photographer_url=photo.get("photographer_url"),
        )
    )
    db.commit()

    return photo
