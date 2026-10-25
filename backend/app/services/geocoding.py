"""A12: turn activity location text into coordinates with the Google Geocoding API.

A lookup never fails a plan: anything that goes wrong just leaves that activity
without coordinates, and the map skips it. Without MAPS_API_KEY nothing is looked up.
"""

from concurrent.futures import ThreadPoolExecutor

import httpx

from app.config import logger, settings
from app.schemas import ItineraryResponse

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
TIMEOUT_SECONDS = 4
PARALLEL_LOOKUPS = 5
# Protects the quota if the AI returns a very long plan.
MAX_LOOKUPS_PER_PLAN = 40

Coordinates = tuple[float, float]


def build_query(location: str, destination: str) -> str:
    """"Navy Pier" -> "Navy Pier, Chicago, IL". Text that already names the destination is left as is."""
    if destination.strip().lower() in location.lower():
        return location
    return f"{location}, {destination}"


def _fetch(query: str) -> dict:
    """One Geocoding API request. Tests replace this, so they never call Google."""
    response = httpx.get(
        GEOCODE_URL,
        params={"address": query, "key": settings.maps_api_key},
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def geocode(query: str) -> Coordinates | None:
    """The first match's coordinates, or None if there's no match or the lookup fails."""
    try:
        body = _fetch(query)
    except Exception as exc:  # noqa: BLE001  (any failure must leave the plan unharmed)
        # Only the error type: httpx messages include the request URL, which contains the key.
        logger.warning("Geocoding %r failed (%s).", query, type(exc).__name__)
        return None

    status = body.get("status") if isinstance(body, dict) else None
    if status != "OK":
        if status != "ZERO_RESULTS":  # no match is normal; anything else is worth a look
            logger.warning("Geocoding %r returned %s.", query, status)
        return None
    try:
        location = body["results"][0]["geometry"]["location"]
        return float(location["lat"]), float(location["lng"])
    except (KeyError, IndexError, TypeError, ValueError):
        logger.warning("Geocoding %r returned an unexpected result.", query)
        return None


def locate_activities(itinerary: ItineraryResponse, destination: str) -> dict[str, Coordinates]:
    """Coordinates for each distinct location text in the plan. Locations that weren't found are left out."""
    if not settings.maps_api_key:
        logger.warning("MAPS_API_KEY isn't set, so this plan is saved without map locations.")
        return {}

    # Each location text is looked up once, however many activities share it.
    locations = list(
        dict.fromkeys(
            activity.location.strip()
            for day in itinerary.days
            for activity in day.activities
            if activity.location.strip()
        )
    )
    if len(locations) > MAX_LOOKUPS_PER_PLAN:
        logger.warning("Plan has %d locations; looking up the first %d.", len(locations), MAX_LOOKUPS_PER_PLAN)
        locations = locations[:MAX_LOOKUPS_PER_PLAN]

    with ThreadPoolExecutor(max_workers=PARALLEL_LOOKUPS) as pool:
        found = pool.map(lambda location: geocode(build_query(location, destination)), locations)
    return {location: coordinates for location, coordinates in zip(locations, found) if coordinates}
