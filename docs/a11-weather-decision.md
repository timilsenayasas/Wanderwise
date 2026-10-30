
# A11 – Weather API Decision

## Selected Service
Open-Meteo

## Reason
We selected Open-Meteo because it provides weather forecasts and historical weather data without requiring an API key for non-commercial use.

## Implementation
- FastAPI retrieves weather data from Open-Meteo.
- The backend provides weather information for saved trip dates.
- Dates within the forecast range show daily forecasts.
- Dates outside the forecast range show historical seasonal averages, clearly labeled as estimates rather than forecasts.
- Weather information is optional and does not prevent users from accessing their trips.
- The frontend displays Open-Meteo attribution.

## Testing
Backend tests use mocked weather responses to verify authentication, trip ownership, forecasts, historical averages, and unavailable weather information.

## Limitations
- Forecasts are available only for a limited number of upcoming days.
- Historical averages are not predictions of actual future weather.
- Weather data depends on the availability of Open-Meteo.
