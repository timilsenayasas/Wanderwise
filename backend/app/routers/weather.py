
"""A11: Weather endpoint for a user's saved trip."""

from datetime import date, timedelta

from fastapi import APIRouter

from app.database import DbSession
from app.routers.trips import get_own_trip
from app.security import CurrentUser
from app.services import weather

router = APIRouter(prefix="/api/trips", tags=["weather"])


@router.get("/{trip_id}/weather")
def get_trip_weather(trip_id: int, user: CurrentUser, db: DbSession) -> dict:
    """Get forecasts or historical averages for each trip date."""
    trip = get_own_trip(trip_id, user, db)

    result = {
        "destination": trip.destination,
        "days": [],
        "attribution": "Weather data by Open-Meteo.com",
    }

    location = weather.find_destination(trip.destination)

    if not location:
        result["message"] = "Weather information is unavailable."
        return result

    latitude = location["latitude"]
    longitude = location["longitude"]

    forecast = weather.fetch_forecast(latitude, longitude)
    daily = forecast.get("daily", {}) if forecast else {}

    forecast_by_date = {
        day: index
        for index, day in enumerate(daily.get("time", []))
    }

    start = date.fromisoformat(str(trip.start_date))
    end = date.fromisoformat(str(trip.end_date))

    current = start

    while current <= end:
        day = current.isoformat()

        if day in forecast_by_date:
            index = forecast_by_date[day]

            result["days"].append({
                "date": day,
                "type": "forecast",
                "temperature_max": daily["temperature_2m_max"][index],
                "temperature_min": daily["temperature_2m_min"][index],
                "precipitation_probability": daily[
                    "precipitation_probability_max"
                ][index],
                "weather_code": daily["weather_code"][index],
                "unit": "°C",
                "label": "Daily forecast",
            })
        else:
            average = weather.seasonal_average(latitude, longitude, day)

            if average:
                result["days"].append(average)
            else:
                result["days"].append({
                    "date": day,
                    "type": "unavailable",
                    "label": "Weather information unavailable",
                })

        current += timedelta(days=1)

    return result
