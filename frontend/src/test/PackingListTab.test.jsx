import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import PackingListTab from '../components/PackingListTab';

vi.mock('../api/client', () => ({
    api: {
        post: vi.fn(),
    },
}));

const packingList = {
    trip_id: 7,
    destination: 'Chicago, IL',
    sections: {
        clothing: ['Comfortable walking shoes', 'Jacket'],
        weather_essentials: ['Umbrella'],
        activity_gear: ['Camera'],
        personal_essentials: ['Passport'],
    },
};

describe('Packing List tab', () => {
    it('generates and displays a packing list', async () => {
        api.post.mockResolvedValue(packingList);

        render(<PackingListTab trip={{ id: 7 }} />);

        expect(
            await screen.findByText('Your packing recommendations for Chicago, IL.')
        ).toBeVisible();

        expect(api.post).toHaveBeenCalledWith('/trips/7/packing-list', {});

        expect(screen.getByText('Comfortable walking shoes')).toBeVisible();
        expect(screen.getByText('Jacket')).toBeVisible();
        expect(screen.getByText('Umbrella')).toBeVisible();
        expect(screen.getByText('Camera')).toBeVisible();
        expect(screen.getByText('Passport')).toBeVisible();
    });

    it('updates the packed-items counter when items are checked', async () => {
        const user = userEvent.setup();
        api.post.mockResolvedValue(packingList);

        render(<PackingListTab trip={{ id: 7 }} />);

        const shoes = await screen.findByRole('checkbox', {
            name: 'Comfortable walking shoes',
        });

        expect(screen.getByText('0 of 5 items packed')).toBeVisible();

        await user.click(shoes);

        expect(screen.getByText('1 of 5 items packed')).toBeVisible();

        await user.click(shoes);

        expect(screen.getByText('0 of 5 items packed')).toBeVisible();
    });

    it('shows an error and allows the user to try again', async () => {
        const user = userEvent.setup();

        api.post
            .mockRejectedValueOnce(new Error('Unable to generate packing list.'))
            .mockResolvedValueOnce(packingList);

        render(<PackingListTab trip={{ id: 7 }} />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Unable to generate packing list.'
        );

        await user.click(screen.getByRole('button', { name: 'Try Again' }));

        expect(
            await screen.findByText('Your packing recommendations for Chicago, IL.')
        ).toBeVisible();

        expect(api.post).toHaveBeenCalledTimes(2);
    });
});