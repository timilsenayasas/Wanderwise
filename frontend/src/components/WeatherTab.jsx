
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function WeatherTab({ trip }) {
    const [weather, setWeather] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!trip?.id) {
            setLoading(false);
            return;
        }

        let active = true;

        async function loadWeather() {
            setLoading(true);
            setError('');

            try {
                const data = await api.get(`/trips/${trip.id}/weather`);
                if (active) setWeather(data);
            } catch {
                if (active) setError('Weather is unavailable right now. Your trip plan still works.');
            } finally {
                if (active) setLoading(false);
            }
        }

        loadWeather();

        return () => {
            active = false;
        };
    }, [trip?.id]);

    if (loading) return <p role="status">Loading weather...</p>;

    if (error) return <p role="status">{error}</p>;

    if (!weather?.days?.length) {
        return <p role="status">{weather?.message || 'No weather information available.'}</p>;
    }

    return (
        <section aria-label="Trip weather">
            <h2>Weather for {weather.destination}</h2>

            <p>Daily forecasts and historical averages for your travel dates.</p>

            <div className="weather-days">
                {weather.days.map((day) => (
                    <article key={day.date} className="weather-day">
                        <h3>{day.date}</h3>

                        <p><strong>{day.label}</strong></p>

                        {day.type !== 'unavailable' ? (
                            <>
                                <p>High: {day.temperature_max}°C</p>
                                <p>Low: {day.temperature_min}°C</p>

                                {day.type === 'forecast' && (
                                    <p>Chance of rain: {day.precipitation_probability ?? 'N/A'}%</p>
                                )}

                                {day.type === 'seasonal_average' && (
                                    <p>Based on {day.years_used} historical years. Not a forecast.</p>
                                )}
                            </>
                        ) : (
                            <p>Weather data is unavailable for this date.</p>
                        )}
                    </article>
                ))}
            </div>

            <p>
                Weather data by{' '}
                <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
                    Open-Meteo.com
                </a>
            </p>
        </section>
    );
}
