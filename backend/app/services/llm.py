"""Gemini itinerary service (F3): prompt, call, validate, cache."""

import json
import time
from collections import OrderedDict

from google import genai
from google.genai import errors
from pydantic import ValidationError

from app.config import logger, settings
from app.schemas import ItineraryResponse, TripPlanRequest

GEMINI_MODEL = "gemini-3.5-flash-lite"

# In-memory cache of generated itineraries, keyed by the exact request.
# Bounded so a long-running server can't grow it forever; cleared on restart.
CACHE_MAX_ENTRIES = 100
itinerary_cache: OrderedDict[str, ItineraryResponse] = OrderedDict()


class LLMServiceError(Exception):
    """Raised when the itinerary service cannot complete a request."""

    def __init__(self, message: str, retry: bool = True):
        super().__init__(message)
        self.message = message
        self.retry = retry


def get_gemini_client():
    """Create the Gemini client only when AI planning is requested."""
    if not settings.llm_api_key:
        raise LLMServiceError(
            "AI planning isn't configured.",
            retry=False,
        )

    return genai.Client(api_key=settings.llm_api_key)


def build_itinerary_prompt(trip: TripPlanRequest) -> str:
    """Build the prompt used to generate a structured trip itinerary."""

    return f"""
You are the itinerary planning service for WanderWise.

Create a realistic day-by-day travel itinerary using the traveler's
constraints below.

TRIP DETAILS
Origin: {trip.origin}
Destination: {trip.destination}
Start date: {trip.start_date.isoformat()}
End date: {trip.end_date.isoformat()}
Number of travelers: {trip.travelers}
Total trip budget (USD): {trip.budget:.2f}
Interests: {", ".join(trip.interests)}
Pace: {trip.pace or "No preference"}
Dietary preferences: {", ".join(trip.dietary_preferences) or "None"}
Accessibility needs: {", ".join(trip.accessibility_needs) or "None"}

REQUIREMENTS
- Cover every date from the start date through the end date.
- Do not create overlapping activities.
- Reflect the traveler's interests throughout the itinerary.
- Include at least one meal suggestion per day.
- Give every activity a start time (24-hour HH:MM) and duration.
- Include estimated cost for each activity.
- estimated_cost is the total for all travelers, not per person.
- Include estimated travel time to the next activity.
- Keep the total estimated cost within the traveler's budget when reasonably possible.
- All monetary values must be in US dollars (USD).
- Costs are estimates, not guaranteed prices.
- Do not include booking or payment instructions.

Return ONLY valid JSON.
Do not include Markdown, code fences, commentary, or text outside the JSON.

Use exactly this JSON structure:

{{
  "destination": "string",
  "currency": "USD",
  "total_estimated_cost": 0.00,
  "days": [
    {{
      "date": "YYYY-MM-DD",
      "activities": [
        {{
          "start_time": "HH:MM",
          "duration_minutes": 0,
          "name": "string",
          "category": "activity, meal, sightseeing, shopping, nightlife, nature, or transportation",
          "location": "string",
          "description": "string",
          "estimated_cost": 0.00,
          "travel_time_to_next_minutes": 0
        }}
      ]
    }}
  ]
}}
""".strip()


def build_cache_key(trip: TripPlanRequest) -> str:
    """Create a consistent cache key from the trip request."""

    return trip.model_dump_json()


def _remember(cache_key: str, itinerary: ItineraryResponse) -> None:
    itinerary_cache[cache_key] = itinerary
    itinerary_cache.move_to_end(cache_key)
    while len(itinerary_cache) > CACHE_MAX_ENTRIES:
        itinerary_cache.popitem(last=False)  # drop the oldest


def generate_itinerary(trip: TripPlanRequest, use_cache: bool = True) -> ItineraryResponse:
    """Generate an itinerary with Gemini and validate the JSON response.

    use_cache=False always asks Gemini (e.g. "Regenerate" wants a different plan).
    """

    cache_key = build_cache_key(trip)

    if use_cache and cache_key in itinerary_cache:
        logger.info("LLM cache hit")
        itinerary_cache.move_to_end(cache_key)
        return itinerary_cache[cache_key]

    logger.info("LLM cache miss")

    prompt = build_itinerary_prompt(trip)

    client = get_gemini_client()

    start_time = time.perf_counter()

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
            },
        )

    except errors.ServerError as exc:
        latency = time.perf_counter() - start_time
        logger.warning(f"LLM request failed after {latency:.2f} seconds")
        raise LLMServiceError(
            "The itinerary service is temporarily unavailable. Please retry."
        ) from exc

    except errors.APIError as exc:
        latency = time.perf_counter() - start_time
        logger.warning(f"LLM request failed after {latency:.2f} seconds")
        raise LLMServiceError(
            "The itinerary service could not complete the request. Please retry."
        ) from exc

    except TimeoutError as exc:
        latency = time.perf_counter() - start_time
        logger.warning(f"LLM request timed out after {latency:.2f} seconds")
        raise LLMServiceError(
            "The itinerary request timed out. Please retry."
        ) from exc

    latency = time.perf_counter() - start_time
    logger.info(f"LLM latency: {latency:.2f} seconds")

    if response.usage_metadata:
        usage = response.usage_metadata
        logger.info(f"LLM input tokens: {usage.prompt_token_count}")
        logger.info(f"LLM output tokens: {usage.candidates_token_count}")
        logger.info(f"LLM total tokens: {usage.total_token_count}")

    if not response.text:
        raise LLMServiceError(
            "The itinerary service returned an empty response. Please retry."
        )

    try:
        response_data = json.loads(response.text)
    except json.JSONDecodeError as exc:
        raise LLMServiceError(
            "The itinerary service returned invalid data. Please retry."
        ) from exc

    try:
        itinerary = ItineraryResponse.model_validate(response_data)
    except ValidationError as exc:
        raise LLMServiceError(
            "The itinerary service returned an invalid itinerary. Please retry."
        ) from exc

    _remember(cache_key, itinerary)

    return itinerary
