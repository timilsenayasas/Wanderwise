import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TripMap from '../components/TripMap';
import { fakeMap, googleMaps, resetGoogleMaps } from './mockGoogleMaps';

vi.mock('@vis.gl/react-google-maps', () => import('./mockGoogleMaps'));

function stop(id, name, start, end, latitude = 41.88, longitude = -87.62) {
  return {
    id,
    name,
    start_time: start,
    end_time: end,
    duration_minutes: 60,
    category: 'sightseeing',
    location: `${name}, Chicago, IL`,
    description: '',
    estimated_cost: 0,
    travel_time_to_next_minutes: 0,
    latitude,
    longitude,
  };
}

/** Two days, four activities; the lunch spot wasn't found, so it has no coordinates. */
const PLAN = {
  trip_id: 7,
  destination: 'Chicago, IL',
  currency: 'USD',
  total_estimated_cost: 0,
  days: [
    {
      id: 1,
      day_number: 1,
      date: '2026-11-05',
      activities: [
        stop(11, 'Art Institute', '09:00', '11:00', 41.8796, -87.6237),
        stop(12, 'Deep-dish lunch', '12:00', '13:00', null, null),
      ],
    },
    {
      id: 2,
      day_number: 2,
      date: '2026-11-06',
      activities: [
        stop(21, 'Navy Pier', '10:00', '12:00', 41.8917, -87.6086),
        stop(22, 'Jazz club', '21:00', '23:00', 41.8902, -87.6262),
      ],
    },
  ],
  cost_items: [],
};

function stopList() {
  return within(screen.getByRole('list', { name: 'Stops on the map' }));
}

beforeEach(() => {
  resetGoogleMaps();
  vi.stubEnv('VITE_GOOGLE_MAPS_KEY', 'test-browser-key');
  vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Trip map', () => {
  it('shows one numbered marker per activity with a location, in visit order', () => {
    render(<TripMap plan={PLAN} />);

    expect(screen.getAllByTestId('map-marker').map((marker) => marker.getAttribute('aria-label'))).toEqual([
      'Marker 1. Art Institute',
      'Marker 2. Navy Pier',
      'Marker 3. Jazz club',
    ]);
    expect(screen.getAllByTestId('map-marker').map((marker) => marker.textContent)).toEqual(['1', '2', '3']);
    expect(screen.queryByLabelText(/deep-dish lunch/i)).not.toBeInTheDocument();
  });

  it('loads the map with the browser key and the demo Map ID by default', () => {
    render(<TripMap plan={PLAN} />);

    expect(screen.getByTestId('maps-api')).toHaveAttribute('data-api-key', 'test-browser-key');
    expect(screen.getByTestId('google-map')).toHaveAttribute('data-map-id', 'DEMO_MAP_ID');
  });

  it('uses the Map ID from the environment when set', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'wanderwise-map');
    render(<TripMap plan={PLAN} />);

    expect(screen.getByTestId('google-map')).toHaveAttribute('data-map-id', 'wanderwise-map');
  });

  it('fits the map to show every stop', () => {
    const map = fakeMap();
    render(<TripMap plan={PLAN} />);

    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    const [bounds] = map.fitBounds.mock.calls[0];
    expect(bounds.points).toEqual([
      { lat: 41.8796, lng: -87.6237 },
      { lat: 41.8917, lng: -87.6086 },
      { lat: 41.8902, lng: -87.6262 },
    ]);
  });

  it('centers on a single stop instead of fitting', () => {
    const map = fakeMap();
    const oneStop = { ...PLAN, days: [PLAN.days[0]] };
    render(<TripMap plan={oneStop} />);

    expect(map.setCenter).toHaveBeenCalledWith({ lat: 41.8796, lng: -87.6237 });
    expect(map.setZoom).toHaveBeenCalledWith(15);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('selecting a marker shows the activity name, day and time', async () => {
    render(<TripMap plan={PLAN} />);

    await userEvent.click(screen.getByRole('button', { name: 'Marker 2. Navy Pier' }));

    const details = screen.getByRole('dialog', { name: 'Map details' });
    expect(details).toHaveTextContent('Navy Pier');
    expect(details).toHaveTextContent('Day 2 · Fri, Nov 6 · 10:00–12:00');
    expect(details).toHaveTextContent('Navy Pier, Chicago, IL');
    expect(stopList().getByRole('button', { name: /navy pier/i })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists the stops so they can be picked with the keyboard', async () => {
    const map = fakeMap();
    render(<TripMap plan={PLAN} />);

    const jazz = stopList().getByRole('button', { name: /stop 3: jazz club/i });
    expect(jazz).toHaveTextContent('Day 2 · Fri, Nov 6 · 21:00–23:00');

    jazz.focus();
    await userEvent.keyboard('{Enter}');

    expect(jazz).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('dialog')).toHaveTextContent('Jazz club');
    expect(map.panTo).toHaveBeenCalledWith({ lat: 41.8902, lng: -87.6262 });

    await userEvent.keyboard('{Enter}'); // pressing it again deselects

    expect(jazz).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Trip map fallbacks', () => {
  it('points to generating a plan when there is none', async () => {
    const onShowItinerary = vi.fn();
    render(<TripMap plan={null} onShowItinerary={onShowItinerary} />);

    expect(screen.getByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
    expect(screen.queryByTestId('maps-api')).not.toBeInTheDocument(); // nothing billable loads

    await userEvent.click(screen.getByRole('button', { name: /go to itinerary/i }));

    expect(onShowItinerary).toHaveBeenCalledTimes(1);
  });

  it('says so when no activity has a location yet', () => {
    const unlocated = { ...PLAN, days: [{ ...PLAN.days[0], activities: [PLAN.days[0].activities[1]] }] };
    render(<TripMap plan={unlocated} onShowItinerary={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'No map locations for this plan yet' })).toBeInTheDocument();
    expect(screen.getByText(/regenerate the plan/i)).toBeInTheDocument();
    expect(screen.queryByTestId('maps-api')).not.toBeInTheDocument();
  });

  it('shows a message without a browser key, and still lists the stops', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_KEY', '');
    render(<TripMap plan={PLAN} />);

    expect(screen.getByRole('status')).toHaveTextContent(/the map can't load right now/i);
    expect(screen.queryByTestId('maps-api')).not.toBeInTheDocument();
    expect(stopList().getAllByRole('button')).toHaveLength(3);
  });

  it.each([
    ['the script fails to load', 'FAILED'],
    ['Google rejects the key', 'AUTH_FAILURE'],
  ])('shows a message when %s, and still lists the stops', (_, status) => {
    googleMaps.status = status;
    render(<TripMap plan={PLAN} />);

    expect(screen.getByRole('status')).toHaveTextContent(/the map can't load right now/i);
    expect(screen.queryByTestId('google-map')).not.toBeInTheDocument();
    expect(stopList().getAllByRole('button')).toHaveLength(3);
  });
});
