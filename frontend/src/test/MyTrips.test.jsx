
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const mockTrips = [
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
];

function renderMyTrips() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <MyTrips />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('MyTrips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue([...mockTrips]);
    api.delete.mockResolvedValue(null);
  });

  it('fetches and displays the trips list', async () => {
    renderMyTrips();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/trips');
    });

    expect(await screen.findByText('Paris')).toBeTruthy();
    expect(screen.getByText('Tokyo')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'View trip' }))
      .toHaveLength(2);
  });

  it('shows confirmation before deleting a trip', async () => {
    const user = userEvent.setup();
    renderMyTrips();

    await screen.findByText('Paris');

    const deleteButtons = screen.getAllByRole('button', {
      name: 'Delete trip',
    });

    await user.click(deleteButtons[0]);

    expect(
      screen.getByText(/Are you sure you want to delete/i)
    ).toBeTruthy();

    expect(
      screen.getByRole('button', { name: 'Yes, delete' })
    ).toBeTruthy();

    expect(api.delete).not.toHaveBeenCalled();
  });

  it('cancels deletion without removing the trip', async () => {
    const user = userEvent.setup();
    renderMyTrips();

    await screen.findByText('Paris');

    await user.click(
      screen.getAllByRole('button', { name: 'Delete trip' })[0]
    );

    await user.click(
      screen.getByRole('button', { name: 'Cancel' })
    );

    expect(screen.getByText('Paris')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, delete' }))
      .toBeNull();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('deletes a trip and removes it from the list', async () => {
    const user = userEvent.setup();
    renderMyTrips();

    await screen.findByText('Paris');

    await user.click(
      screen.getAllByRole('button', { name: 'Delete trip' })[0]
    );

    await user.click(
      screen.getByRole('button', { name: 'Yes, delete' })
    );

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/trips/1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Paris')).toBeNull();
    });

    expect(screen.getByText('Tokyo')).toBeTruthy();

    expect(
      screen.getByText('Trip deleted successfully.')
    ).toBeTruthy();
  });

  it('shows an error if deleting a trip fails', async () => {
    const user = userEvent.setup();

    api.delete.mockRejectedValue(
      new Error('Unable to delete trip.')
    );

    renderMyTrips();

    await screen.findByText('Paris');

    await user.click(
      screen.getAllByRole('button', { name: 'Delete trip' })[0]
    );

    await user.click(
      screen.getByRole('button', { name: 'Yes, delete' })
    );

    expect(
      await screen.findByRole('alert')
    ).toHaveProperty('textContent', 'Unable to delete trip.');

    expect(screen.getByText('Paris')).toBeTruthy();
  });
});
