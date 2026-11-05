"""Where to stay: estimated nightly hotel prices from Gemini, one call per set of suggestions.

An estimate is our own data, so it's stored (TripHotelEstimate), but it's only a guide:
the page always labels it "Estimated, actual prices may vary." Anything that goes wrong
just leaves hotels without an estimate; the page still works.
"""

import json
from datetime import date

from pydantic import BaseModel, Field, ValidationError

from app.config import logger
from app.services import llm
from app.services.places import Hotel

# Anything above this is a bad answer, not a hotel price.
MAX_NIGHTLY_USD = 20_000


class NightlyEstimate(BaseModel):
    place_id: str
    nightly_usd: float = Field(gt=0, le=MAX_NIGHTLY_USD, allow_inf_nan=False)


def build_prices_prompt(
    destination: str, start_date: date, end_date: date, travelers: int, hotels: list[Hotel]
) -> str:
    """Ask for one nightly price per hotel, keyed by the place ID we sent."""
    hotel_lines = "\n".join(f"- id: {hotel.place_id} | {hotel.name} | {hotel.area}" for hotel in hotels)
    return f"""
You estimate hotel prices for WanderWise, a trip planner.

For each hotel below, estimate the typical price of one night's stay in one room
that suits the travelers, in US dollars (USD), for these dates.

TRIP
Destination: {destination}
Check-in: {start_date.isoformat()}
Check-out: {end_date.isoformat()}
Number of travelers: {travelers}

HOTELS (id | name | area)
{hotel_lines}

REQUIREMENTS
- One estimate per hotel, using its id exactly as given.
- nightly_usd is a number above 0: the price for one night, not the whole stay.
- These are estimates, not quotes. Do not include booking or payment instructions.

Return ONLY valid JSON, with no Markdown, code fences or other text, in exactly this structure:

{{"prices": [{{"place_id": "string", "nightly_usd": 0.00}}]}}
""".strip()


def _parse(text: str, asked: set[str]) -> dict[str, float]:
    """The valid estimates for hotels we asked about. One bad entry doesn't spoil the rest."""
    try:
        entries = json.loads(text)["prices"]
    except (json.JSONDecodeError, KeyError, TypeError):
        logger.warning("Hotel price estimates came back in an unexpected shape.")
        return {}

    prices = {}
    for entry in entries if isinstance(entries, list) else []:
        try:
            estimate = NightlyEstimate.model_validate(entry)
        except ValidationError:
            continue
        if estimate.place_id in asked:
            prices[estimate.place_id] = round(estimate.nightly_usd, 2)
    return prices


def estimate_nightly_prices(
    destination: str, start_date: date, end_date: date, travelers: int, hotels: list[Hotel]
) -> dict[str, float]:
    """place_id -> estimated nightly price (USD). Hotels Gemini didn't price are left out."""
    if not hotels:
        return {}
    try:
        client = llm.get_gemini_client()
        response = client.models.generate_content(
            model=llm.GEMINI_MODEL,
            contents=build_prices_prompt(destination, start_date, end_date, travelers, hotels),
            config={"response_mime_type": "application/json"},
        )
    except Exception as exc:  # noqa: BLE001  (no estimate must never break the page)
        logger.warning("Hotel price estimates failed (%s).", type(exc).__name__)
        return {}

    return _parse(response.text or "", {hotel.place_id for hotel in hotels})
