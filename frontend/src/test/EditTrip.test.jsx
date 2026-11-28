import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EditTrip from '../pages/EditTrip';
import { ToastProvider } from '../components/Toast';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

function LocationDisplay() {
  const location = useLocation();

  return <p data-testid="location">{location.pathname}</p>;
}

const mockTrip = {
  id: 42,
  origin: 'Dallas, TX',
  destination: 'New York, NY',
  start_date: '2026-10-20',
  end_date: '2026-10-25',
  travelers: 2,
  budget: 1500,
  interests: ['food', 'museums', 'hiking'],
};

function renderEditTrip() {
  return render(
    <MemoryRouter initialEntries={['/trips/42/edit']}>
      <ToastProvider>
        <Routes>
          <Route path="/trips/:tripId/edit" element={<EditTrip />} />
          <Route path="/trips/:tripId" element={<LocationDisplay />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Edit Trip page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(mockTrip);
  });

  // TEST 1: Load existing trip information
  it('loads and displays the existing trip information', async () => {
    renderEditTrip();

    expect(
      await screen.findByDisplayValue('Dallas, TX'),
    ).toBeInTheDocument();

    expect(
      screen.getByDisplayValue('New York, NY'),
    ).toBeInTheDocument();

    expect(
      screen.getByDisplayValue('2026-10-20'),
    ).toBeInTheDocument();

    expect(
      screen.getByDisplayValue('2026-10-25'),
    ).toBeInTheDocument();

    expect(
      screen.getByDisplayValue('2'),
    ).toBeInTheDocument();

    expect(
      screen.getByDisplayValue('1500'),
    ).toBeInTheDocument();

    expect(
      screen.getByDisplayValue('food, museums, hiking'),
    ).toBeInTheDocument();

    expect(api.get).toHaveBeenCalledWith('/trips/42');
  });

  // TEST 2: Successfully update a trip
  it('updates the trip and redirects to the itinerary', async () => {
    const user = userEvent.setup();
    
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    api.put.mockResolvedValue({
      ...mockTrip,
      destination: 'Chicago, IL',
    });

    renderEditTrip();

    const destination = await screen.findByLabelText(/destination/i);

    await user.clear(destination);
    await user.type(destination, 'Chicago, IL');

    await user.click(
      screen.getByRole('button', { name: /save changes/i }),
    );

    expect(api.put).toHaveBeenCalledWith('/trips/42', {
      origin: 'Dallas, TX',
      destination: 'Chicago, IL',
      start_date: '2026-10-20',
      end_date: '2026-10-25',
      travelers: 2,
      budget: 1500,
      interests: ['food', 'museums', 'hiking'],
    });

    expect(
      await screen.findByTestId('location'),
    ).toHaveTextContent('/trips/42');
  });

  // TEST 3: Validate empty fields
  it('shows validation errors when required fields are empty', async () => {
    const user = userEvent.setup();

    renderEditTrip();

    const origin = await screen.findByLabelText(/origin/i);

    await user.clear(origin);

    await user.click(
      screen.getByRole('button', { name: /save changes/i }),
    );

    expect(
      await screen.findByText('Enter your starting location'),
    ).toBeInTheDocument();

    expect(api.put).not.toHaveBeenCalled();
  });

  // TEST 4: Display server errors
  it('displays the server error when updating fails', async () => {
    const user = userEvent.setup();

    api.put.mockRejectedValue(
      new Error('Unable to update trip. Please try again.'),
    );

    renderEditTrip();

    await screen.findByDisplayValue('Dallas, TX');

    await user.click(
      screen.getByRole('button', { name: /save changes/i }),
    );

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Unable to update trip. Please try again.');
  });
});