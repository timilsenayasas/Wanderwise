
"""B3: Retrieve destination photos from the Pexels API."""

import logging

import httpx

from app.config import settings

logger = logging.getLogger("wanderwise")

PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"


def search_destination_photo(destination: str) -> dict | None:
    """Return one Pexels photo or None if unavailable.

    The API key stays on the backend. Database caching is handled
    separately by the photos endpoint.
    """
    destination = destination.strip()

    if not destination or not settings.pexels_api_key:
        return None

    try:
        response = httpx.get(
            PEXELS_SEARCH_URL,
            headers={"Authorization": settings.pexels_api_key},
            params={
                "query": destination,
                "per_page": 1,
                "orientation": "landscape",
            },
            timeout=5.0,
        )
        response.raise_for_status()

        photos = response.json().get("photos", [])
        if not photos:
            return None

        photo = photos[0]
        photo_url = photo.get("src", {}).get("large")

        if not photo_url:
            return None

        return {
            "photo_url": photo_url,
            "photographer": photo.get("photographer") or "Unknown",
            "photographer_url": photo.get("photographer_url"),
        }

    except (httpx.HTTPError, ValueError, TypeError, AttributeError, KeyError) as exc:
        logger.warning(
            "Pexels photo unavailable for %s: %s",
            destination,
            type(exc).__name__,
        )
        return None
