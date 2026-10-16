import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ToastProvider } from '../components/Toast';
import MyTrips from '../pages/MyTrips';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), delete: vi.fn() } };
});

const TRIP = {
  id: 7,
  origin: 'Dallas, TX',
  destination: 'New York, NY',
  start_date: '2026-11-05',
  end_date: '2026-11-08',
  travelers: 2,
  budget: 1500,
  interests: ['food', 'museums'],
  created_at: '2026-10-13T16:00:00',
};

function renderPage() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <MyTrips />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.delete.mockReset();
});

describe('MyTrips', () => {
  it('lists saved trips with a link to each trip', async () => {
    api.get.mockResolvedValue([TRIP]);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'New York, NY' })).toBeInTheDocument();
    expect(screen.getByText(/4 days/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new york, ny/i })).toHaveAttribute('href', '/trips/7');
    expect(api.get).toHaveBeenCalledWith('/trips');
  });

  it('shows the empty state when there are no trips', async () => {
    api.get.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no saved trips yet/i)).toBeInTheDocument();
  });

  it('deletes a trip after confirming', async () => {
    api.get.mockResolvedValue([TRIP]);
    api.delete.mockResolvedValue(null);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/delete this trip\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(api.delete).toHaveBeenCalledWith('/trips/7');
    expect(await screen.findByText(/no saved trips yet/i)).toBeInTheDocument();
  });
});
