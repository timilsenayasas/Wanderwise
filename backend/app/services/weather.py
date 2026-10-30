
"""A11: Open-Meteo weather integration for WanderWise trips."""

import httpx
from functools import lru_cache

from app.config import logger

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT_SECONDS = 5


def find_destination(destination: str) -> dict | None:
    """Find latitude, longitude, and timezone for a destination."""
    try:
        response = httpx.get(
            GEOCODING_URL,
            params={"name": destination, "count": 1},
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        return results[0] if results else None
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
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



@lru_cache(maxsize=256)
def fetch_historical_weather(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
) -> dict | None:
    """Fetch historical daily temperatures for seasonal averages."""
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
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning(
            "Historical weather lookup failed: %s",
            type(exc).__name__,
        )
        return None

def seasonal_average(latitude: float, longitude: float, travel_date: str) -> dict | None:
    """Estimate temperatures using the same calendar date over three past years."""
    from datetime import date

    target = date.fromisoformat(travel_date)
    current_year = date.today().year

    highs = []
    lows = []

    for year in range(current_year - 3, current_year):
        try:
            historical_date = target.replace(year=year).isoformat()
        except ValueError:
            # February 29 does not exist in every year.
            historical_date = target.replace(year=year, day=28).isoformat()

        data = fetch_historical_weather(
            latitude, longitude, historical_date, historical_date
        )

        if not data:
            continue

        daily = data.get("daily", {})
        high = (daily.get("temperature_2m_max") or [None])[0]
        low = (daily.get("temperature_2m_min") or [None])[0]

        if high is not None and low is not None:
            highs.append(high)
            lows.append(low)

    if not highs:
        return None

    return {
        "date": travel_date,
        "type": "seasonal_average",
        "temperature_max": round(sum(highs) / len(highs), 1),
        "temperature_min": round(sum(lows) / len(lows), 1),
        "unit": "°C",
        "years_used": len(highs),
        "label": "Historical average (not a forecast)",
    }
