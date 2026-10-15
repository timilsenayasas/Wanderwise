
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import MyTrips from '../pages/MyTrips';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('MyTrips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and displays the trips list', async () => {
    api.get.mockResolvedValue([
  {
    id: '1',
    origin: 'Dallas',
    destination: 'Paris',
    start_date: '2026-11-10',
    end_date: '2026-11-15',
    travelers: 2,
    budget: 2000,
  },
  {
    id: '2',
    origin: 'Houston',
    destination: 'Tokyo',
    start_date: '2026-12-01',
    end_date: '2026-12-08',
    travelers: 1,
    budget: 3000,
  },
]);

    render(
      <MemoryRouter>
        <ToastProvider>
          <MyTrips />
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/trips');
    });

    expect(
      await screen.findByText(/Paris/i)
    ).toBeTruthy();

    expect(
      screen.getByText(/Tokyo/i)
    ).toBeTruthy();
  });
});