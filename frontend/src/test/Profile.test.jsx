import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import Profile from '../pages/Profile';

vi.mock('../api/client', () => ({
    api: {
        get: vi.fn(),
        put: vi.fn(),
    },
}));

describe('Profile page', () => {
    it('loads and displays saved preferences', async () => {
        api.get.mockResolvedValue({
            id: 1,
            user_id: 1,
            home_city: 'Fort Worth',
            interests: 'Food, sightseeing',
            default_budget: 1500,
            travel_style: 'Relaxed',
        });

        render(<Profile />);

        expect(screen.getByText(/loading your preferences/i)).toBeInTheDocument();

        expect(await screen.findByLabelText(/home city/i)).toHaveValue('Fort Worth');
        expect(screen.getByLabelText(/interests/i)).toHaveValue('Food, sightseeing');
        expect(screen.getByLabelText(/default budget/i)).toHaveValue(1500);
        expect(screen.getByLabelText(/travel style/i)).toHaveValue('Relaxed');

        expect(api.get).toHaveBeenCalledWith('/me/preferences');
    });

    it('saves updated preferences', async () => {
        api.get.mockResolvedValue({
            id: 0,
            user_id: 1,
            home_city: '',
            interests: '',
            default_budget: null,
            travel_style: '',
        });

        api.put.mockResolvedValue({
            id: 1,
            user_id: 1,
            home_city: 'Fort Worth',
            interests: 'Food, beaches',
            default_budget: 2000,
            travel_style: 'Relaxed',
        });

        render(<Profile />);

        const homeCity = await screen.findByLabelText(/home city/i);

        await userEvent.type(homeCity, 'Fort Worth');
        await userEvent.type(screen.getByLabelText(/interests/i), 'Food, beaches');
        await userEvent.type(screen.getByLabelText(/default budget/i), '2000');
        await userEvent.type(screen.getByLabelText(/travel style/i), 'Relaxed');

        await userEvent.click(
            screen.getByRole('button', { name: /save preferences/i }),
        );

        await waitFor(() => {
            expect(api.put).toHaveBeenCalledWith('/me/preferences', {
                home_city: 'Fort Worth',
                interests: 'Food, beaches',
                default_budget: 2000,
                travel_style: 'Relaxed',
            });
        });

        expect(
            await screen.findByText(/preferences saved successfully/i),
        ).toBeInTheDocument();
    });
});