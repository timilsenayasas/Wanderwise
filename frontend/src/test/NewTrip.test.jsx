import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewTrip from '../pages/NewTrip';
import { ToastProvider } from '../components/Toast';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    post: vi.fn(),
  },
}));

function LocationDisplay() {
  const location = useLocation();

  return <p data-testid="location">{location.pathname}</p>;
}

function renderNewTrip() {
  return render(
    <MemoryRouter initialEntries={['/trips/new']}>
      <ToastProvider>
        <Routes>
          <Route path="/trips/new" element={<NewTrip />} />
          <Route path="/trips/:tripId" element={<LocationDisplay />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function fillValidForm(user) {
  await user.type(
    screen.getByLabelText(/origin/i),
    'Dallas, TX',
  );

  await user.type(
    screen.getByLabelText(/destination/i),
    'New York, NY',
  );

  fireEvent.change(
    screen.getByLabelText(/start date/i),
    { target: { value: '2026-10-20' } },
  );

  fireEvent.change(
    screen.getByLabelText(/end date/i),
    { target: { value: '2026-10-25' } },
  );

  await user.clear(screen.getByLabelText(/travelers/i));
  await user.type(screen.getByLabelText(/travelers/i), '2');

  await user.type(
    screen.getByLabelText(/budget/i),
    '1500',
  );

  await user.type(
    screen.getByLabelText(/interests/i),
    'food, museums, hiking',
  );
}

describe('New Trip page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows validation errors when the form is submitted empty', async () => {
    const user = userEvent.setup();

    renderNewTrip();

    await user.click(
      screen.getByRole('button', { name: /create trip/i }),
    );

    expect(
      await screen.findByText('Enter your starting location'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Enter your destination'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Choose a start date'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Choose an end date'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Enter a budget'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Enter at least one interest'),
    ).toBeInTheDocument();

    expect(api.post).not.toHaveBeenCalled();
  });

  it('submits the trip, shows a success toast, and redirects', async () => {
    const user = userEvent.setup();

    api.post.mockResolvedValue({
      id: 42,
    });

    renderNewTrip();

    await fillValidForm(user);

    await user.click(
      screen.getByRole('button', { name: /create trip/i }),
    );

    expect(api.post).toHaveBeenCalledWith('/trips', {
      origin: 'Dallas, TX',
      destination: 'New York, NY',
      start_date: '2026-10-20',
      end_date: '2026-10-25',
      travelers: 2,
      budget: 1500,
      interests: ['food', 'museums', 'hiking'],
    });

    expect(
      await screen.findByText('Trip saved!'),
    ).toBeInTheDocument();

    expect(
      await screen.findByTestId('location'),
    ).toHaveTextContent('/trips/42');
  });
});