import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import Itinerary from '../pages/Itinerary';
import { budgetResponse, emptyBudget, HOTEL } from './budgetFixtures';
import { DRAKE, hotelChoice, lodgingPage, nightsOf } from './lodgingFixtures';
import { googleMaps, resetGoogleMaps } from './mockGoogleMaps';

vi.mock('@vis.gl/react-google-maps', () => import('./mockGoogleMaps'));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
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

/** A saved plan whose activity has map coordinates (A12). */
function locatedPlan() {
  const plan = savedPlan('Art Institute of Chicago');
  plan.days[0].activities[0] = { ...plan.days[0].activities[0], latitude: 41.8796, longitude: -87.6237 };
  return plan;
}

/**
 * GET /trips/7 returns TRIP; /plan `plan` (null = none saved yet); /budget a budget;
 * /lodging and /lodging/stays/1 a one-stay `lodging` scenario; /lodging/pins `pins`;
 * /lodging/names?… `names`.
 */
function mockLoad(
  plan,
  trip = TRIP,
  budget = budgetResponse(),
  lodging = lodgingPage({ nights: 1 }),
  pins = [],
  names = [],
) {
  api.get.mockImplementation((path) => {
    if (path.endsWith('/plan')) return Promise.resolve(plan);
    if (path.endsWith('/budget')) return Promise.resolve(budget);
    if (path.endsWith('/lodging')) return Promise.resolve(lodging.overview);
    if (path.endsWith('/lodging/stays/1')) return Promise.resolve(lodging.page);
    if (path.endsWith('/lodging/pins')) return Promise.resolve(pins);
    if (path.includes('/lodging/names?')) return Promise.resolve(names);
    return Promise.resolve(trip);
  });
}

/** A two-day plan (Nov 5 – 6: one night) and a one-stay trip whose hotel p1 (The Drake) is picked. */
function pickedHotelTrip() {
  const plan = savedPlan('Art Institute of Chicago');
  plan.days.push({ ...plan.days[0], id: 2, day_number: 2, date: '2026-11-06' });
  const lodging = lodgingPage({ nights: 1, choice: hotelChoice('p1', 140, 1, { hotel: DRAKE }) });
  return { plan, lodging };
}

const nameRequests = () => api.get.mock.calls.map(([path]) => path).filter((path) => path.includes('/lodging/names'));

function LocationState() {
  const location = useLocation();
  return (
    <>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
      <p data-testid="search">{location.search}</p>
    </>
  );
}

function renderTrip(state, search = '') {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/trips/7', search, state }]}>
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
  Object.values(api).forEach((fn) => fn.mockReset());
  resetGoogleMaps();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('Trip page skeleton loading', () => {
  it('shows skeleton placeholders while the trip is loading', async () => {
    let finishTrip;
    let finishPlan;

    api.get.mockImplementation((path) => {
      if (path.endsWith('/plan')) {
        return new Promise((resolve) => {
          finishPlan = resolve;
        });
      }

      return new Promise((resolve) => {
        finishTrip = resolve;
      });
    });

    renderTrip();

    expect(
      screen.getByRole('status', { name: 'Loading your trip' }),
    ).toBeInTheDocument();

    expect(document.querySelectorAll('.skeleton')).toHaveLength(19);

    finishTrip(TRIP);
    finishPlan(savedPlan('Art Institute of Chicago'));

    expect(
      await screen.findByText('Art Institute of Chicago'),
    ).toBeInTheDocument();

    expect(document.querySelectorAll('.skeleton')).toHaveLength(0);
  });
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

describe('Trip page tabs', () => {
  it('opens on the Itinerary tab', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip();

    expect(await screen.findByText('Art Institute of Chicago')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Itinerary' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'false');
  });

  it("shows the Budget tab's total on the Itinerary, with what it's made of", async () => {
    mockLoad(savedPlan('Art Institute of Chicago')); // its plan alone is $32; the budget is $442.50
    renderTrip();

    expect(await screen.findByText('plan $97 + lodging $300 + your other costs $45.50')).toBeInTheDocument();
    expect(screen.getByText('Estimated total').nextElementSibling).toHaveTextContent('$442.50');
    expect(api.get).toHaveBeenCalledWith('/trips/7/budget'); // the same numbers as the Budget tab
  });

  it("falls back to the plan's own total, and says so, when the budget can't load", async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    const loadNormally = api.get.getMockImplementation();
    api.get.mockImplementation((path) =>
      path.endsWith('/budget') ? Promise.reject(new ApiError('Something went wrong.', 500)) : loadNormally(path),
    );
    renderTrip();

    expect(await screen.findByText(/plan only/i)).toBeInTheDocument();
    expect(screen.getByText('Estimated total').nextElementSibling).toHaveTextContent('$32');
  });

  it('switches to Budget on click and keeps the tab in the URL', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip();

    await userEvent.click(await screen.findByRole('tab', { name: 'Budget' }));

    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Budget' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Budget' })).toBeVisible();
    expect(screen.queryByText('Art Institute of Chicago')).not.toBeVisible();
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=budget');
    expect(api.get).toHaveBeenCalledWith('/trips/7/budget');

    await userEvent.click(screen.getByRole('tab', { name: 'Itinerary' }));

    expect(screen.getByText('Art Institute of Chicago')).toBeVisible();
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
  });

  it('moves between tabs with the arrow keys, Home and End', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip();
    const itinerary = await screen.findByRole('tab', { name: 'Itinerary' });
    const budget = screen.getByRole('tab', { name: 'Budget' });
    const stay = screen.getByRole('tab', { name: 'Stay' });
    const map = screen.getByRole('tab', { name: 'Map' });
    const weather = screen.getByRole('tab', { name: 'Weather' });

    // Only the selected tab is in the Tab order.
    expect(itinerary).toHaveAttribute('tabindex', '0');
    expect(budget).toHaveAttribute('tabindex', '-1');
    expect(stay).toHaveAttribute('tabindex', '-1');
    expect(map).toHaveAttribute('tabindex', '-1');

    itinerary.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(budget).toHaveFocus();
    expect(budget).toHaveAttribute('aria-selected', 'true');
    expect(budget).toHaveAttribute('tabindex', '0');

    await userEvent.keyboard('{ArrowRight}');
    expect(stay).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(map).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(weather).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}'); // wraps around
    expect(itinerary).toHaveFocus();

    await userEvent.keyboard('{End}');
    expect(weather).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(itinerary).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}'); // wraps the other way
    expect(weather).toHaveFocus();
  });

  it('opens the Budget tab from ?tab=budget', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip(undefined, '?tab=budget');

    expect(await screen.findByRole('heading', { name: 'Budget' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
    expect(api.get).toHaveBeenCalledWith('/trips/7/budget');
  });

  it("the Budget tab's empty state leads back to the Itinerary tab", async () => {
    mockLoad(null, TRIP, emptyBudget());
    renderTrip(undefined, '?tab=budget');

    await userEvent.click(await screen.findByRole('button', { name: /go to itinerary/i }));

    const itinerary = screen.getByRole('tab', { name: 'Itinerary' });
    expect(itinerary).toHaveAttribute('aria-selected', 'true');
    expect(itinerary).toHaveFocus();
    expect(screen.getByRole('button', { name: /generate ai itinerary/i })).toBeVisible();
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
  });

  it('opens the Stay tab from ?tab=stay', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip(undefined, '?tab=stay');

    // Hotels first: the loading view's heading is replaced by the stay's own once the overview arrives.
    expect(await screen.findByRole('article', { name: 'The Drake' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where to stay in Chicago, IL' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stay' })).toHaveAttribute('aria-selected', 'true');
    expect(api.get).toHaveBeenCalledWith('/trips/7/lodging');
  });

  it('searches for hotels only when Stay is first opened, not on every visit', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip();
    await screen.findByText('Art Institute of Chicago');
    // The Itinerary asks for the free overview (where you sleep), but nothing searches Google yet.
    expect(api.get).not.toHaveBeenCalledWith('/trips/7/lodging/stays/1');

    await userEvent.click(screen.getByRole('tab', { name: 'Stay' }));
    expect(await screen.findByRole('article', { name: 'The Drake' })).toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=stay');

    await userEvent.click(screen.getByRole('tab', { name: 'Itinerary' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Stay' }));

    expect(screen.getByRole('article', { name: 'The Drake' })).toBeVisible();
    // One (billed) search, however often the tab is reopened.
    expect(api.get.mock.calls.filter(([path]) => path === '/trips/7/lodging/stays/1')).toHaveLength(1);
  });

  it('says where you sleep each night, and leads to the Stay tab to choose', async () => {
    const plan = savedPlan('Art Institute of Chicago');
    plan.days.push({ ...plan.days[0], id: 2, day_number: 2, date: '2026-11-06' }); // Nov 5 – 6: one night
    mockLoad(plan);
    renderTrip();

    const label = await screen.findByText('Tonight in Chicago, IL:');
    expect(label.closest('p')).toHaveTextContent('Tonight in Chicago, IL: no hotel chosen yet');
    expect(api.get).toHaveBeenCalledWith('/trips/7/lodging'); // the free overview, no search
    expect(api.get).not.toHaveBeenCalledWith('/trips/7/lodging/stays/1');

    await userEvent.click(screen.getByRole('button', { name: 'Choose where to stay' }));

    const stay = screen.getByRole('tab', { name: 'Stay' });
    expect(stay).toHaveAttribute('aria-selected', 'true');
    expect(stay).toHaveFocus();
  });

  it('switches a night to travelling and shows the answer straight away', async () => {
    const plan = savedPlan('Art Institute of Chicago');
    plan.days.push({ ...plan.days[0], id: 2, day_number: 2, date: '2026-11-06' }); // Nov 5 – 6: one night
    const before = lodgingPage({ nights: 1 });
    before.overview.nights = nightsOf(['2026-11-05']);
    mockLoad(plan, TRIP, budgetResponse(), before);
    api.put.mockResolvedValue({ ...before.overview, nights: nightsOf(['2026-11-05'], ['2026-11-05'], ['2026-11-05']), stays: [] });
    renderTrip();

    await userEvent.click(await screen.findByRole('button', { name: /i'm travelling this night/i }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/nights/2026-11-05', { in_transit: true });
    expect(await screen.findByText('in transit', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i'm travelling this night/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: "Use the plan's" })).toBeInTheDocument();
  });

  it("the Budget tab's Stay line leads to the Stay tab", async () => {
    const stayLine = { ...HOTEL, description: 'Lodging', from_stay: true };
    mockLoad(savedPlan('Art Institute of Chicago'), TRIP, budgetResponse({ items: [stayLine] }));
    renderTrip(undefined, '?tab=budget');

    await userEvent.click(await screen.findByRole('button', { name: 'Change on the Stay tab' }));

    const stay = screen.getByRole('tab', { name: 'Stay' });
    expect(stay).toHaveAttribute('aria-selected', 'true');
    expect(stay).toHaveFocus();
    await screen.findByRole('article', { name: 'The Drake' }); // loaded: the heading won't be swapped out now
    expect(screen.getByRole('heading', { name: 'Where to stay in Chicago, IL' })).toBeVisible();
  });

  it('opens the Map tab from ?tab=map', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip(undefined, '?tab=map');

    expect(await screen.findByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Map' })).toBeVisible();
    expect(api.get).not.toHaveBeenCalledWith('/trips/7/budget');
  });

  it('shows the hotel chosen on the Stay tab as a pin on the Map tab', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_KEY', 'test-browser-key');
    mockLoad(locatedPlan(), TRIP, budgetResponse(), lodgingPage(), [
      { stay_number: 1, city: 'Chicago, IL', latitude: 41.9, longitude: -87.62 },
    ]);
    renderTrip(undefined, '?tab=map');

    expect(await screen.findByRole('button', { name: 'Marker Your hotel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marker 1. Art Institute of Chicago' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/trips/7/lodging/pins');
    expect(api.get).not.toHaveBeenCalledWith('/trips/7/lodging/stays/1'); // the map never searches for hotels
  });

  it('keeps the other tabs working when the map fails to load', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_KEY', 'test-browser-key');
    googleMaps.status = 'FAILED';
    mockLoad(locatedPlan());
    renderTrip(undefined, '?tab=map');

    expect(await screen.findByText(/the map can't load right now/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Budget' }));
    expect(await screen.findByRole('heading', { name: 'Budget' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Itinerary' }));
    expect(screen.getByText('Art Institute of Chicago')).toBeVisible();
  });

  it('keeps the page working when the map crashes', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_KEY', 'test-browser-key');
    vi.spyOn(console, 'error').mockImplementation(() => { }); // React logs the caught error
    googleMaps.crash = true;
    mockLoad(locatedPlan());
    renderTrip(undefined, '?tab=map');

    expect(await screen.findByText(/the rest of your trip still works/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Itinerary' }));
    expect(screen.getByText('Art Institute of Chicago')).toBeVisible();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
  });

  it('ignores an unknown ?tab= and opens the Itinerary tab', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip(undefined, '?tab=nope');

    expect(await screen.findByRole('tab', { name: 'Itinerary' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps ?tab= when clearing the New Trip flag', async () => {
    mockLoad(savedPlan('Art Institute of Chicago'));
    renderTrip({ generate: true }, '?tab=budget');

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'));
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=budget');
  });
});

describe("Hotel names on the Itinerary", () => {
  it("looks up a picked hotel's name, then says where you sleep by name", async () => {
    const { plan, lodging } = pickedHotelTrip();
    mockLoad(plan, TRIP, budgetResponse(), lodging, [], [{ stay_number: 1, place_id: 'p1', name: 'Hotel Thamel' }]);
    renderTrip();

    const label = await screen.findByText('Tonight:');
    await waitFor(() => expect(label.closest('p')).toHaveTextContent('Tonight: Hotel Thamel'));
    expect(nameRequests()).toEqual(['/trips/7/lodging/names?stays=1']);
    expect(screen.getByText('Hotel names: Google Maps')).toBeInTheDocument(); // Google's attribution
  });

  it('reuses names the Stay tab already loaded: no lookup', async () => {
    const { plan, lodging } = pickedHotelTrip();
    mockLoad(plan, TRIP, budgetResponse(), lodging);
    renderTrip(undefined, '?tab=stay');
    await screen.findByRole('article', { name: 'The Drake' }); // the Stay tab's search brought the names

    await userEvent.click(screen.getByRole('tab', { name: 'Itinerary' }));

    const label = await screen.findByText('Tonight:');
    expect(label.closest('p')).toHaveTextContent('Tonight: The Drake');
    expect(nameRequests()).toEqual([]);
  });

  it('asks once per visit, not every time the Itinerary is shown', async () => {
    const { plan, lodging } = pickedHotelTrip();
    mockLoad(plan, TRIP, budgetResponse(), lodging, [], [{ stay_number: 1, place_id: 'p1', name: 'Hotel Thamel' }]);
    renderTrip();
    await screen.findByText('Hotel names: Google Maps');

    await userEvent.click(screen.getByRole('tab', { name: 'Budget' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Itinerary' }));
    await screen.findByText('Hotel names: Google Maps');

    expect(nameRequests()).toHaveLength(1);
  });

  it('keeps "your hotel in …" when the name lookup fails', async () => {
    const { plan, lodging } = pickedHotelTrip();
    mockLoad(plan, TRIP, budgetResponse(), lodging);
    const loadNormally = api.get.getMockImplementation();
    api.get.mockImplementation((path) =>
      path.includes('/lodging/names') ? Promise.reject(new ApiError('Something went wrong.', 500)) : loadNormally(path),
    );
    renderTrip();

    await waitFor(() => expect(nameRequests()).toHaveLength(1));
    expect((await screen.findByText('Tonight:')).closest('p')).toHaveTextContent('Tonight: your hotel in Chicago, IL');
    expect(screen.queryByText('Hotel names: Google Maps')).toBeNull();
  });

  it('never puts names in localStorage or sessionStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { plan, lodging } = pickedHotelTrip();
    mockLoad(plan, TRIP, budgetResponse(), lodging, [], [{ stay_number: 1, place_id: 'p1', name: 'Hotel Thamel' }]);
    renderTrip();

    await screen.findByText('Hotel names: Google Maps');

    expect(setItem).not.toHaveBeenCalled();
  });

  it('asks again if you leave while a name is loading, and shows it when you come back', async () => {
    const { plan, lodging } = pickedHotelTrip();
    mockLoad(plan, TRIP, budgetResponse(), lodging);
    const loadNormally = api.get.getMockImplementation();
    let lookups = 0;
    api.get.mockImplementation((path) => {
      if (!path.includes('/lodging/names')) return loadNormally(path);
      lookups += 1;
      // The first lookup never answers (you've left before it would); the second one does.
      return lookups === 1 ? new Promise(() => {}) : Promise.resolve([{ stay_number: 1, place_id: 'p1', name: 'Hotel Thamel' }]);
    });
    renderTrip();
    await waitFor(() => expect(nameRequests()).toHaveLength(1));

    await userEvent.click(screen.getByRole('tab', { name: 'Budget' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Itinerary' }));

    expect(await screen.findByText('Hotel names: Google Maps')).toBeInTheDocument();
    expect(nameRequests()).toHaveLength(2);
  });
});
