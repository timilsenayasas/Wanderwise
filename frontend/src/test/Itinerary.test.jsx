import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import Itinerary from '../pages/Itinerary';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const TRIP = {
  id: 7,
  origin: 'Dallas, TX',
  destination: 'Chicago, IL',
  start_date: '2026-11-05',
  end_date: '2026-11-06',
  travelers: 2,
  budget: 1200,
  interests: ['food', 'museums'],
  created_at: '2026-10-24T12:00:00Z',
};

function savedPlan(...names) {
  return {
    trip_id: 7,
    destination: 'Chicago, IL',
    currency: 'USD',
    total_estimated_cost: 32,
    days: [
      {
        id: 1,
        day_number: 1,
        date: '2026-11-05',
        activities: names.map((name, i) => ({
          id: i + 1,
          start_time: '09:00',
          end_time: '11:00',
          duration_minutes: 120,
          name,
          category: 'sightseeing',
          location: '111 S Michigan Ave',
          description: 'World-class art museum.',
          estimated_cost: 32,
          travel_time_to_next_minutes: 0,
          latitude: null,
          longitude: null,
        })),
      },
    ],
    cost_items: [{ id: 1, category: 'sightseeing', description: '1 activity', amount: 32 }],
  };
}

/** GET /trips/7 returns TRIP; GET /trips/7/plan returns `plan` (null = none saved yet). */
function mockLoad(plan, trip = TRIP) {
  api.get.mockImplementation((path) => Promise.resolve(path.endsWith('/plan') ? plan : trip));
}

function LocationState() {
  const location = useLocation();
  return <p data-testid="state">{JSON.stringify(location.state)}</p>;
}

function renderTrip(state) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/trips/7', state }]}>
      <Routes>
        <Route
          path="/trips/:tripId"
          element={
            <>
              <Itinerary />
              <LocationState />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('Trip page plan', () => {
  it('shows the saved plan on load without offering to generate', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip();

    expect(await screen.findByText('Art Institute of Chicago')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/trips/7/plan');
    expect(screen.queryByRole('button', { name: /generate ai itinerary/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('offers to generate when there is no plan, then shows the saved result', async () => {
    mockLoad(null);
    api.post.mockResolvedValue(savedPlan('Art Institute of Chicago'));
    renderTrip();

    await userEvent.click(await screen.findByRole('button', { name: /generate ai itinerary/i }));

    expect(api.post).toHaveBeenCalledWith('/trips/7/plan');
    expect(await screen.findByText('Art Institute of Chicago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate ai itinerary/i })).not.toBeInTheDocument();
  });

  it('asks before regenerating and replaces the plan only when confirmed', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    api.post.mockResolvedValue(savedPlan('Field Museum'));
    renderTrip();

    const regenerate = await screen.findByRole('button', { name: /regenerate/i });
    await userEvent.click(regenerate);
    expect(screen.getByText(/replaces your current plan/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/replaces your current plan/i)).not.toBeInTheDocument();
    expect(regenerate).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(regenerate);
    await userEvent.click(screen.getByRole('button', { name: /replace my plan/i }));

    expect(await screen.findByText('Field Museum')).toBeInTheDocument();
    expect(screen.queryByText('Art Institute of Chicago')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('starts generating straight away when arriving from New Trip', async () => {
    mockLoad(null);
    api.post.mockResolvedValue(savedPlan('Art Institute of Chicago'));
    renderTrip({ generate: true });

    expect(await screen.findByText('Art Institute of Chicago')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    // The flag is cleared so a reload doesn't generate again.
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'));
  });

  it('does not regenerate on arrival when the trip already has a plan', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip({ generate: true });

    expect(await screen.findByText('Art Institute of Chicago')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the server message when generating fails', async () => {
    mockLoad(null);
    api.post.mockRejectedValue(new ApiError("AI planning isn't configured.", 503));
    renderTrip();

    await userEvent.click(await screen.findByRole('button', { name: /generate ai itinerary/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ai planning isn't configured/i);
  });

  it('asks for a budget and interests instead of offering to generate', async () => {
    mockLoad(null, { ...TRIP, budget: null, interests: [] });
    renderTrip({ generate: true });

    expect(await screen.findByText(/add a budget and at least one interest/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate ai itinerary/i })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
