import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import WeatherTab from '../components/WeatherTab';

vi.mock('../api/client', () => ({
    api: {
        get: vi.fn(),
    },
}));

function forecastDay(date, precipitationProbability) {
    return {
        date,
        type: 'forecast',
        temperature_max: 20,
        temperature_min: 10,
        precipitation_probability: precipitationProbability,
        weather_code: 1,
        unit: '°C',
        label: 'Daily forecast',
    };
}

describe('Weather tab', () => {
    it('shows the chance of rain, or says it is not available', async () => {
        api.get.mockResolvedValue({
            destination: 'Chicago, IL',
            days: [forecastDay('2026-10-30', 40), forecastDay('2026-10-31', null)],
            attribution: 'Weather data by Open-Meteo.com',
        });

        render(<WeatherTab trip={{ id: 7 }} />);

        const [first, second] = await screen.findAllByRole('article');
        expect(api.get).toHaveBeenCalledWith('/trips/7/weather');
        expect(first).toHaveTextContent('Chance of rain: 40%');
        expect(second).toHaveTextContent('Chance of rain: not available');
        expect(second).not.toHaveTextContent('%');
    });
});
