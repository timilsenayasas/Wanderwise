"""Where to stay: hotel suggestions from Google Places API (New).

Text Search finds hotels near the destination; Place Photos turns each hotel's first photo
into an image URL the browser can load without our key. Google's terms allow keeping only
place IDs (and coordinates for 30 days), so every call here fetches fresh and nothing is cached.

A lookup never fails the page: anything that goes wrong returns no hotels with a reason.
Without MAPS_API_KEY nothing is looked up. The key goes in a header, never in a URL.
"""

import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from typing import Literal

import httpx

from app.config import logger, settings
from app.services.geocoding import Coordinates

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACE_URL = "https://places.googleapis.com/v1/places/{place_id}"
PHOTO_URL = "https://places.googleapis.com/v1/{photo_name}/media"
TIMEOUT_SECONDS = 5
MAX_HOTELS = 6
PHOTO_MAX_WIDTH_PX = 800

# Google bills by the fields asked for, so ask only for what the hotel cards show.
HOTEL_FIELDS = (
    "id",
    "displayName",
    "formattedAddress",
    "addressComponents",
    "location",
    "rating",
    "userRatingCount",
    "photos",
    "googleMapsUri",
)
SEARCH_FIELD_MASK = ",".join(f"places.{name}" for name in HOTEL_FIELDS)
DETAILS_FIELD_MASK = ",".join(HOTEL_FIELDS)
# Location only keeps the coordinate refresh in Google's cheapest (Essentials) tier.
LOCATION_FIELD_MASK = "location"

# The most specific address part that reads as "where in town", first match wins.
AREA_TYPES = ("neighborhood", "sublocality_level_1", "sublocality", "locality")

# Place IDs and photo names go into URL paths, so only Google's own characters are let through.
PLACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
PHOTO_NAME_PATTERN = re.compile(r"^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$")

SearchStatus = Literal["ok", "not_configured", "unavailable"]


@dataclass(frozen=True)
class PhotoAuthor:
    name: str
    uri: str | None


@dataclass(frozen=True)
class Photo:
    name: str  # Google's photo name: expires, so it's only used within one request
    authors: tuple[PhotoAuthor, ...]
    uri: str | None = None  # the image URL for the browser, once fetched


@dataclass(frozen=True)
class Hotel:
    place_id: str
    name: str
    address: str
    area: str
    location: Coordinates | None
    rating: float | None
    review_count: int | None
    google_maps_uri: str | None
    photo: Photo | None


@dataclass(frozen=True)
class HotelSearch:
    status: SearchStatus
    hotels: list[Hotel] = field(default_factory=list)


def _fetch(
    method: str, url: str, field_mask: str | None = None, body: dict | None = None, params: dict | None = None
) -> dict:
    """One Places API request. Tests replace this, so they never call Google."""
    headers = {"X-Goog-Api-Key": settings.maps_api_key}
    if field_mask:
        headers["X-Goog-FieldMask"] = field_mask
    response = httpx.request(method, url, headers=headers, json=body, params=params, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def _call(what: str, method: str, url: str, **kwargs) -> dict | None:
    """_fetch, or None (logged) if it fails or doesn't return an object."""
    try:
        body = _fetch(method, url, **kwargs)
    except Exception as exc:  # noqa: BLE001  (any failure must leave the page working)
        # Only the error type: the message could include request details.
        logger.warning("Places %s failed (%s).", what, type(exc).__name__)
        return None
    if not isinstance(body, dict):
        logger.warning("Places %s returned an unexpected result.", what)
        return None
    return body


# --- Reading Google's answer ----------------------------------------------
def _area(place: dict) -> str:
    """"Near North Side" from the address parts, else the full address."""
    parts = place.get("addressComponents") or []
    for wanted in AREA_TYPES:
        for part in parts:
            if wanted in (part.get("types") or []) and part.get("longText"):
                return part["longText"]
    return place.get("formattedAddress", "")


def _location(place: dict) -> Coordinates | None:
    try:
        return float(place["location"]["latitude"]), float(place["location"]["longitude"])
    except (KeyError, TypeError, ValueError):
        return None


def _photo(place: dict) -> Photo | None:
    """The first photo with its authors, which must be credited wherever it's shown."""
    photos = place.get("photos") or []
    if not photos or not PHOTO_NAME_PATTERN.match(photos[0].get("name", "")):
        return None
    authors = tuple(
        PhotoAuthor(name=author["displayName"], uri=author.get("uri"))
        for author in photos[0].get("authorAttributions") or []
        if author.get("displayName")
    )
    return Photo(name=photos[0]["name"], authors=authors)


def _to_hotel(place: dict) -> Hotel | None:
    """A Places result as a Hotel. Results without an ID or name are skipped."""
    place_id = place.get("id", "")
    name = (place.get("displayName") or {}).get("text", "")
    if not PLACE_ID_PATTERN.match(place_id) or not name:
        return None
    rating = place.get("rating")
    review_count = place.get("userRatingCount")
    return Hotel(
        place_id=place_id,
        name=name,
        address=place.get("formattedAddress", ""),
        area=_area(place),
        location=_location(place),
        rating=float(rating) if isinstance(rating, (int, float)) else None,
        review_count=int(review_count) if isinstance(review_count, int) else None,
        google_maps_uri=place.get("googleMapsUri"),
        photo=_photo(place),
    )


# --- Photos ---------------------------------------------------------------
def _photo_uri(photo_name: str) -> str | None:
    """A fresh image URL for the photo. Asked for each time: Google's photo names expire."""
    body = _call(
        "photo",
        "GET",
        PHOTO_URL.format(photo_name=photo_name),
        params={"maxWidthPx": PHOTO_MAX_WIDTH_PX, "skipHttpRedirect": "true"},
    )
    uri = body.get("photoUri") if body else None
    return uri if isinstance(uri, str) and uri.startswith("https://") else None


def with_photo_uris(hotels: list[Hotel]) -> list[Hotel]:
    """The same hotels with their photo URLs filled in, one request each, at the same time.

    A photo that can't be fetched is dropped, so the card shows no photo rather than a broken one.
    """
    if not hotels:
        return hotels
    with ThreadPoolExecutor(max_workers=MAX_HOTELS) as pool:
        uris = list(pool.map(lambda hotel: _photo_uri(hotel.photo.name) if hotel.photo else None, hotels))
    return [
        replace(hotel, photo=replace(hotel.photo, uri=uri) if uri else None)
        for hotel, uri in zip(hotels, uris)
    ]


# --- Lookups --------------------------------------------------------------
def search_hotels(destination: str) -> HotelSearch:
    """Up to MAX_HOTELS hotels in the destination, with photo URLs."""
    if not settings.maps_api_key:
        logger.warning("MAPS_API_KEY isn't set, so no hotels are suggested.")
        return HotelSearch(status="not_configured")

    body = _call(
        "hotel search",
        "POST",
        SEARCH_URL,
        field_mask=SEARCH_FIELD_MASK,
        body={
            "textQuery": f"hotels in {destination}",
            "includedType": "lodging",
            "strictTypeFiltering": True,
            "pageSize": MAX_HOTELS,
        },
    )
    if body is None:
        return HotelSearch(status="unavailable")

    places = body.get("places") or []  # no matches: Google leaves "places" out
    hotels = [hotel for hotel in map(_to_hotel, places) if hotel][:MAX_HOTELS]
    return HotelSearch(status="ok", hotels=with_photo_uris(hotels))


def get_hotel(place_id: str) -> Hotel | None:
    """One hotel's details and photo URL, e.g. a chosen hotel that's no longer in the search results."""
    if not settings.maps_api_key or not PLACE_ID_PATTERN.match(place_id):
        return None
    body = _call("details", "GET", PLACE_URL.format(place_id=place_id), field_mask=DETAILS_FIELD_MASK)
    hotel = _to_hotel(body) if body else None
    return with_photo_uris([hotel])[0] if hotel else None


def get_location(place_id: str) -> Coordinates | None:
    """Just the hotel's coordinates (map pin), refreshed when the stored ones are 30 days old."""
    if not settings.maps_api_key or not PLACE_ID_PATTERN.match(place_id):
        return None
    body = _call("location", "GET", PLACE_URL.format(place_id=place_id), field_mask=LOCATION_FIELD_MASK)
    return _location(body) if body else None
