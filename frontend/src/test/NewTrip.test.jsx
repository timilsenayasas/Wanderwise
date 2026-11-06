import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewTrip from '../pages/NewTrip';
import { ToastProvider } from '../components/Toast';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

function LocationDisplay() {
  const location = useLocation();

  return (
    <>
      <p data-testid="location">{location.pathname}</p>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
    </>
  );
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
  await user.type(screen.getByLabelText(/origin/i), 'Dallas, TX');
  await user.type(screen.getByLabelText(/destination/i), 'New York, NY');

  fireEvent.change(screen.getByLabelText(/start date/i), {
    target: { value: '2026-10-20' },
  });

  fireEvent.change(screen.getByLabelText(/end date/i), {
    target: { value: '2026-10-25' },
  });

  await user.clear(screen.getByLabelText(/travelers/i));
  await user.type(screen.getByLabelText(/travelers/i), '2');

  await user.type(screen.getByLabelText(/budget/i), '1500');
  await user.type(
    screen.getByLabelText(/interests/i),
    'food, museums, hiking',
  );
}

describe('New Trip page', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    api.get.mockResolvedValue({
      home_city: '',
      interests: [],
      default_budget: null,
      travel_style: '',
    });
  });

  // TEST 1: Empty form validation
  it('shows validation errors when the form is submitted empty', async () => {
    const user = userEvent.setup();

    renderNewTrip();

    await user.click(
      screen.getByRole('button', { name: /create trip/i }),
    );

    expect(
      await screen.findByText('Enter your starting location'),
    ).toBeInTheDocument();

    expect(screen.getByText('Enter your destination')).toBeInTheDocument();
    expect(screen.getByText('Choose a start date')).toBeInTheDocument();
    expect(screen.getByText('Choose an end date')).toBeInTheDocument();
    expect(screen.getByText('Enter a budget')).toBeInTheDocument();
    expect(
      screen.getByText('Enter at least one interest'),
    ).toBeInTheDocument();

    expect(api.post).not.toHaveBeenCalled();
  });

  // TEST 2: Successful trip submission and plan generation
  it('submits the trip, shows a success toast, and goes on to generate its plan', async () => {
    const user = userEvent.setup();

    api.post.mockResolvedValue({ id: 42 });

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
      await screen.findByText('Trip saved! Planning your itinerary…'),
    ).toBeInTheDocument();

    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/trips/42',
    );

    expect(screen.getByTestId('state')).toHaveTextContent(
      '{"generate":true}',
    );
  });

  // TEST 3: Reject more than 20 travelers
  it('rejects more than 20 travelers', async () => {
    const user = userEvent.setup();

    renderNewTrip();

    await fillValidForm(user);

    const travelersInput = screen.getByLabelText(/travelers/i);

    await user.clear(travelersInput);
    await user.type(travelersInput, '25');

    await user.click(
      screen.getByRole('button', { name: /create trip/i }),
    );

    expect(
      await screen.findByText('You can have a maximum of 20 travelers'),
    ).toBeInTheDocument();

    expect(api.post).not.toHaveBeenCalled();
  });

  // TEST 4: Accept exactly 20 travelers
  it('accepts 20 travelers', async () => {
    const user = userEvent.setup();

    api.post.mockResolvedValue({ id: 43 });

    renderNewTrip();

    await fillValidForm(user);

    const travelersInput = screen.getByLabelText(/travelers/i);

    await user.clear(travelersInput);
    await user.type(travelersInput, '20');

    await user.click(
      screen.getByRole('button', { name: /create trip/i }),
    );

    expect(api.post).toHaveBeenCalledWith(
      '/trips',
      expect.objectContaining({
        travelers: 20,
      }),
    );

    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/trips/43',
    );
  });

  // TEST 5: Display actual server error
  it('displays the actual server error when saving fails', async () => {
    const user = userEvent.setup();

    api.post.mockRejectedValue({
      response: {
        data: {
          detail: 'Maximum number of travelers is 20.',
        },
      },
    });

    renderNewTrip();

    await fillValidForm(user);

    await user.click(
      screen.getByRole('button', { name: /create trip/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Maximum number of travelers is 20.',
    );
  });

  // TEST 6: Prefill form with saved profile preferences
  it('prefills the New Trip form with saved profile preferences', async () => {
    api.get.mockResolvedValue({
      home_city: 'Fort Worth, TX',
      interests: ['food', 'museums'],
      default_budget: 2000,
      travel_style: 'Relaxed',
    });

    renderNewTrip();

    expect(api.get).toHaveBeenCalledWith('/me/preferences');

    expect(
      await screen.findByDisplayValue('Fort Worth, TX'),
    ).toBeInTheDocument();

    expect(screen.getByLabelText(/budget/i)).toHaveValue(2000);
    expect(screen.getByLabelText(/interests/i)).toHaveValue(
      'food, museums',
    );
  });

  // TEST 7: Work without saved profile preferences
  it('works normally without saved profile preferences', async () => {
    const user = userEvent.setup();

    renderNewTrip();

    expect(api.get).toHaveBeenCalledWith('/me/preferences');

    expect(await screen.findByLabelText(/origin/i)).toHaveValue('');
    expect(screen.getByLabelText(/budget/i)).toHaveValue(null);
    expect(screen.getByLabelText(/interests/i)).toHaveValue('');

    await fillValidForm(user);

    await user.click(
      screen.getByRole('button', { name: /create trip/i }),
    );

    expect(api.post).toHaveBeenCalledWith(
      '/trips',
      expect.objectContaining({
        origin: 'Dallas, TX',
        destination: 'New York, NY',
        budget: 1500,
      }),
    );
  });

  // TEST 8: Allow users to change prefilled values
  it('allows users to change prefilled profile values', async () => {
    const user = userEvent.setup();

    api.get.mockResolvedValue({
      home_city: 'Fort Worth, TX',
      interests: ['food', 'museums'],
      default_budget: 2000,
      travel_style: 'Relaxed',
    });

    renderNewTrip();

    const origin = await screen.findByLabelText(/origin/i);
    const budget = screen.getByLabelText(/budget/i);
    const interests = screen.getByLabelText(/interests/i);

    expect(origin).toHaveValue('Fort Worth, TX');
    expect(budget).toHaveValue(2000);
    expect(interests).toHaveValue('food, museums');

    await user.clear(origin);
    await user.type(origin, 'Dallas, TX');

    await user.clear(budget);
    await user.type(budget, '1500');

    await user.clear(interests);
    await user.type(interests, 'hiking, beaches');

    expect(origin).toHaveValue('Dallas, TX');
    expect(budget).toHaveValue(1500);
    expect(interests).toHaveValue('hiking, beaches');
  });
});