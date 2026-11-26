
import json
import time

from google.genai import errors
from pydantic import ValidationError

from app.config import logger
from app.schemas import PackingListOut, PackingListSections
from app.services import llm


def build_packing_prompt(
    destination: str,
    weather: list[dict],
    activities: list[str],
) -> str:
    """Build a prompt using the trip's weather and activity categories."""

    return f"""
You are the packing assistant for WanderWise.

Create a practical packing list for this trip.

DESTINATION
{destination}

WEATHER
{json.dumps(weather, default=str)}

PLANNED ACTIVITY CATEGORIES
{", ".join(activities) or "General sightseeing"}

Create a packing list that considers the weather and planned activities.

Use exactly these four sections:
- clothing
- weather_essentials
- activity_gear
- personal_essentials

REQUIREMENTS
- Include practical items the traveler should bring.
- Consider temperature, rain, and other available weather information.
- Consider the planned activity categories.
- Avoid duplicate items.
- Keep each item short and specific.
- Do not include explanations or extra sections.
- Return ONLY valid JSON.

Use exactly this structure:

{{
    "clothing": ["item"],
    "weather_essentials": ["item"],
    "activity_gear": ["item"],
    "personal_essentials": ["item"]
}}
""".strip()


def generate_packing_list(
    trip_id: int,
    destination: str,
    weather: list[dict],
    activities: list[str],
) -> PackingListOut:
    """Generate and validate a packing list using Gemini."""

    prompt = build_packing_prompt(destination, weather, activities)
    client = llm.get_gemini_client()

    start_time = time.perf_counter()

    try:
        response = client.models.generate_content(
            model=llm.GEMINI_MODEL,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

    except errors.ServerError as exc:
        logger.warning("Gemini packing-list request failed.")
        raise llm.LLMServiceError(
            "The packing list service is temporarily unavailable. Please retry."
        ) from exc

    except errors.APIError as exc:
        logger.warning("Gemini packing-list request failed.")
        raise llm.LLMServiceError(
            "The packing list could not be generated. Please retry."
        ) from exc

    except TimeoutError as exc:
        logger.warning("Gemini packing-list request timed out.")
        raise llm.LLMServiceError(
            "The packing list request timed out. Please retry."
        ) from exc

    latency = time.perf_counter() - start_time
    logger.info(f"Packing-list generation latency: {latency:.2f} seconds")

    if not response.text:
        raise llm.LLMServiceError(
            "The packing list service returned an empty response."
        )

    try:
        response_data = json.loads(response.text)
    except json.JSONDecodeError as exc:
        raise llm.LLMServiceError(
            "The packing list service returned invalid data."
        ) from exc

    try:
        sections = PackingListSections.model_validate(response_data)
    except ValidationError as exc:
        raise llm.LLMServiceError(
            "The packing list service returned an invalid list."
        ) from exc

    return PackingListOut(
        trip_id=trip_id,
        destination=destination,
        sections=sections,
    )