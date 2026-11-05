
"""A11: Open-Meteo weather integration for WanderWise trips."""

from datetime import date

import httpx

from app.config import logger

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT_SECONDS = 5
GEOCODING_RESULTS = 5

# "Chicago, IL": the geocoding results name the state in full (admin1 "Illinois").
US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def _matches(result: dict, hints: list[str]) -> bool:
    """True if any hint ("IL", "Illinois", "France", "FR") is the result's state, country or country code."""
    fields = {
        str(result.get(key) or "").strip().lower()
        for key in ("admin1", "country", "country_code")
    } - {""}
    for hint in hints:
        if hint.lower() in fields or US_STATES.get(hint.upper(), "").lower() in fields:
            return True
    return False


def find_destination(destination: str) -> dict | None:
    """Find latitude, longitude, and timezone for a destination.

    The geocoding search only matches place names, so "Chicago, IL" is searched as "Chicago",
    and the rest ("IL", "France") picks among the results. No match: the first result.
    """
    name, _, rest = destination.partition(",")
    hints = [part.strip() for part in rest.split(",") if part.strip()]
    try:
        response = httpx.get(
            GEOCODING_URL,
            params={"name": name.strip(), "count": GEOCODING_RESULTS},
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        if not results:
            return None
        return next((result for result in results if _matches(result, hints)), results[0])
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
        logger.warning("Weather location lookup failed: %s", type(exc).__name__)
        return None


def fetch_forecast(latitude: float, longitude: float) -> dict | None:
    """Get daily weather forecasts from Open-Meteo."""
    try:
        response = httpx.get(
            FORECAST_URL,
            params={
                "latitude": latitude,
                "longitude": longitude,
                "daily": (
                    "temperature_2m_max,"
                    "temperature_2m_min,"
                    "precipitation_probability_max,"
                    "weather_code"
                ),
                "timezone": "auto",
                "forecast_days": 16,
            },
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Weather forecast failed: %s", type(exc).__name__)
        return None

# Historical weather data for seasonal estimates.
HISTORICAL_URL = "https://archive-api.open-meteo.com/v1/archive"

# Past weather doesn't change, so answers are kept (oldest dropped first). Only successful ones:
# a failed lookup is tried again next time instead of being remembered until a restart.
HISTORICAL_CACHE_SIZE = 256
_historical_cache: dict[tuple, dict] = {}


def fetch_historical_weather(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
) -> dict | None:
    """Fetch historical daily temperatures for seasonal averages."""
    key = (latitude, longitude, start_date, end_date)
    if key in _historical_cache:
        return _historical_cache[key]
    try:
        response = httpx.get(
            HISTORICAL_URL,
            params={
                "latitude": latitude,
                "longitude": longitude,
                "start_date": start_date,
                "end_date": end_date,
                "daily": "temperature_2m_max,temperature_2m_min",
                "timezone": "auto",
            },
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning(
            "Historical weather lookup failed: %s",
            type(exc).__name__,
        )
        return None

    _historical_cache[key] = data
    if len(_historical_cache) > HISTORICAL_CACHE_SIZE:
        del _historical_cache[next(iter(_historical_cache))]  # the oldest
    return data

def _same_day_in(target: date, year: int) -> date:
    try:
        return target.replace(year=year)
    except ValueError:
        # February 29 does not exist in every year.
        return target.replace(year=year, day=28)


def seasonal_averages(latitude: float, longitude: float, travel_dates: list[str]) -> dict[str, dict]:
    """Estimate temperatures for each date from the same calendar dates over three past years.

    One archive request per past year covers all the dates (at most 3 requests per trip).
    Dates without any past data are left out.
    """
    current_year = date.today().year
    highs = {day: [] for day in travel_dates}
    lows = {day: [] for day in travel_dates}

    for year in range(current_year - 3, current_year):
        past = {day: _same_day_in(date.fromisoformat(day), year) for day in travel_dates}
        if not past:
            break

        data = fetch_historical_weather(
            latitude, longitude, min(past.values()).isoformat(), max(past.values()).isoformat()
        )

        if not data:
            continue

        daily = data.get("daily", {})
        by_date = dict(
            zip(
                daily.get("time") or [],
                zip(daily.get("temperature_2m_max") or [], daily.get("temperature_2m_min") or []),
            )
        )

        for day, past_day in past.items():
            high, low = by_date.get(past_day.isoformat(), (None, None))
            if high is not None and low is not None:
                highs[day].append(high)
                lows[day].append(low)

    return {
        day: {
            "date": day,
            "type": "seasonal_average",
            "temperature_max": round(sum(highs[day]) / len(highs[day]), 1),
            "temperature_min": round(sum(lows[day]) / len(lows[day]), 1),
            "unit": "°C",
            "years_used": len(highs[day]),
            "label": "Historical average (not a forecast)",
        }
        for day in travel_dates
        if highs[day]
    }
