import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import WhereToStay from '../components/WhereToStay';
import {
  DRAKE,
  hotelChoice,
  lodgingPage,
  LUX,
  mockLodging,
  nightsOf,
  overviewOf,
  overviewWith,
  ownChoice,
  skipChoice,
  STAY_TRIP,
  stayOut,
  suggestion,
} from './lodgingFixtures';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

/** Open a one-stay trip's tab with this scenario and wait for the suggestions (or their fallback). */
async function openWith({ overview, page } = lodgingPage()) {
  mockLodging(api, { overview, pages: { 1: page } });
  render(<WhereToStay trip={STAY_TRIP} />);
  await screen.findByRole('heading', { name: 'Suggested hotels' });
  await waitFor(() => expect(screen.queryByText(/finding hotels/i)).not.toBeInTheDocument());
}

function card(name) {
  return screen.getByRole('article', { name });
}

function yourStay() {
  return screen.getByRole('region', { name: /your stay/i });
}

function announced() {
  return screen.getAllByRole('status').map((status) => status.textContent).join(' ');
}

function useReducedMotion(reduce) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Where to stay loading', () => {
  it('shows skeleton cards, then the suggestions from one search', async () => {
    const { overview, page } = lodgingPage();
    mockLodging(api, { overview, pages: { 1: page } });
    render(<WhereToStay trip={STAY_TRIP} />);

    expect(screen.getByText(/finding hotels in chicago, il/i)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { name: 'Where to stay in Chicago, IL' })).toBeInTheDocument();

    expect(await screen.findByRole('article', { name: 'The Drake' })).toBeInTheDocument();
    // The overview (no Google calls), then one search for the trip's one stay.
    expect(api.get.mock.calls.map(([path]) => path)).toEqual(['/trips/7/lodging', '/trips/7/lodging/stays/1']);
    expect(screen.getByText(/4 nights · \$1,600 left for lodging/)).toBeInTheDocument();
  });

  it('shows the error with a retry button when loading fails', async () => {
    const { overview, page } = lodgingPage();
    mockLodging(api, { overview, pages: { 1: page } });
    api.get.mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0));
    render(<WhereToStay trip={STAY_TRIP} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/can't reach the server/i);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('article', { name: 'The Drake' })).toBeInTheDocument();
  });
});

describe('Hotel cards', () => {
  it('show the rating label, estimate, fit, author credit and Google attribution', async () => {
    await openWith();
    const drake = card('The Drake');

    expect(within(drake).getByRole('img', { name: '4.6 out of 5, 1,284 reviews' })).toBeInTheDocument();
    expect(within(drake).getByText('Near North Side')).toBeInTheDocument();
    expect(within(drake).getByText('$140 / night')).toBeInTheDocument();
    expect(within(drake).getByText('$560 total, 4 nights')).toBeInTheDocument();
    expect(within(drake).getByText('Estimated')).toHaveAttribute('title', 'Estimated, actual prices may vary.');
    expect(within(drake).getByText('Fits budget')).toBeInTheDocument();
    expect(within(card('Hotel Lux')).getByText('Slightly over')).toBeInTheDocument();

    const photo = drake.querySelector('img');
    expect(photo).toHaveAttribute('src', 'https://lh3.googleusercontent.com/p1');
    expect(photo).toHaveAttribute('loading', 'lazy');
    expect(photo).toHaveAttribute('width', '800');
    expect(photo).toHaveAttribute('height', '600');
    expect(within(drake).getByRole('link', { name: 'Sam Lee' })).toHaveAttribute(
      'href',
      'https://maps.google.com/maps/contrib/1',
    );
    expect(within(drake).getByRole('link', { name: /view the drake on google maps/i })).toHaveAttribute(
      'href',
      'https://maps.google.com/?cid=p1',
    );
    expect(screen.getByText('Google Maps')).toBeVisible();
  });

  it('highlights exactly one best fit', async () => {
    await openWith();

    expect(screen.getAllByText('Best fit for your budget')).toHaveLength(1);
    expect(within(card('The Drake')).getByText('Best fit for your budget')).toBeInTheDocument();
  });

  it('shows a card without a photo or estimate without breaking', async () => {
    await openWith(lodgingPage({ suggestions: [suggestion('p3', 'New Inn', null, { photo: null, rating: null })] }));
    const inn = card('New Inn');

    expect(within(inn).getByText('No estimate')).toBeInTheDocument();
    expect(inn.querySelector('img')).toBeNull();
    expect(within(inn).queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('Choosing', () => {
  it('chooses a hotel, moves it into Your stay and announces it', async () => {
    await openWith();
    api.put.mockResolvedValue(overviewWith(hotelChoice('p1', 140)));

    await userEvent.click(within(card('The Drake')).getByRole('button', { name: 'Choose The Drake' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging/stays/1', { choice: 'hotel', place_id: 'p1' });
    const stay = await screen.findByRole('region', { name: /your stay/i });
    expect(within(stay).getByRole('heading', { name: 'Your stay: The Drake' })).toBeInTheDocument();
    expect(within(stay).getByText('$560 total, 4 nights')).toBeInTheDocument();
    expect(within(stay).getByText('Estimated')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /your stay/i })).toHaveFocus();
    expect(announced()).toMatch(/the drake is now your stay\. \$560 is in your budget\./i);
    expect(within(card('The Drake')).getByRole('button', { name: /chosen/i })).toBeDisabled();
  });

  it('asks for a price before choosing a hotel without an estimate', async () => {
    await openWith(lodgingPage({ suggestions: [suggestion('p3', 'New Inn', null)] }));
    api.put.mockResolvedValue(overviewWith(hotelChoice('p3', 99)));

    await userEvent.click(screen.getByRole('button', { name: 'Choose New Inn' }));
    const price = screen.getByLabelText('Nightly price for New Inn (USD)');
    expect(price).toHaveFocus();

    await userEvent.click(within(card('New Inn')).getByRole('button', { name: 'Choose' }));
    expect(screen.getByText('Enter a nightly price.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();

    await userEvent.type(price, '99');
    await userEvent.click(within(card('New Inn')).getByRole('button', { name: 'Choose' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging/stays/1', { choice: 'hotel', place_id: 'p3', nightly_price: 99 });
    expect(await screen.findByRole('region', { name: /your stay/i })).toHaveTextContent('Your price');
  });

  it('shows a failed choice on its card', async () => {
    await openWith();
    api.put.mockRejectedValue(new ApiError('Choose one of the suggested hotels.', 422));

    await userEvent.click(screen.getByRole('button', { name: 'Choose Hotel Lux' }));

    expect(await within(card('Hotel Lux')).findByRole('alert')).toHaveTextContent('Choose one of the suggested hotels.');
    expect(screen.queryByRole('region', { name: /your stay/i })).not.toBeInTheDocument();
  });
});

describe('The chosen hotel in Suggested hotels', () => {
  /** "chosen" (class, check badge, disabled Chosen button, no Choose) or "plain" (a Choose button). */
  function cardState(name) {
    const hotel = card(name);
    const chosen =
      hotel.classList.contains('hotel-card--chosen') &&
      within(hotel).queryByRole('img', { name: 'Chosen' }) !== null &&
      within(hotel).getByRole('button', { name: /chosen/i }).disabled &&
      within(hotel).queryByRole('button', { name: `Choose ${name}` }) === null;
    if (chosen) return 'chosen';
    return within(hotel).queryByRole('button', { name: `Choose ${name}` }) ? 'plain' : 'neither';
  }

  it('shows a hotel chosen earlier as chosen when the tab opens', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));

    expect(cardState('The Drake')).toBe('chosen');
    expect(cardState('Hotel Lux')).toBe('plain');
  });

  it('moves the chosen state when another hotel is chosen', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));
    api.put.mockResolvedValue(overviewWith(hotelChoice('p2', 300)));

    await userEvent.click(screen.getByRole('button', { name: 'Choose Hotel Lux' }));

    await waitFor(() => expect(cardState('Hotel Lux')).toBe('chosen'));
    expect(cardState('The Drake')).toBe('plain');
  });

  it('keeps the chosen state after Refresh', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));
    api.post.mockResolvedValue(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }).page);

    await userEvent.click(screen.getByRole('button', { name: /refresh suggestions/i }));

    await waitFor(() => expect(cardState('The Drake')).toBe('chosen'));
  });

  // Safety net: Google can list the chosen hotel under a new place ID. Matched by name in the browser only.
  it('marks the chosen hotel by name when Google lists it under a different place ID', async () => {
    const chosen = hotelChoice('old-id', 140, 4, { hotel: { ...DRAKE, place_id: 'old-id', name: '  the  DRAKE ' } });
    await openWith(lodgingPage({ choice: chosen }));

    expect(cardState('The Drake')).toBe('chosen');
    expect(cardState('Hotel Lux')).toBe('plain');
    expect(within(yourStay()).getByText('Estimated')).toBeInTheDocument(); // the matched card's estimate
    expect(api.put).not.toHaveBeenCalled(); // nothing is saved
  });

  it('marks nothing when neither the place ID nor the name matches', async () => {
    const chosen = hotelChoice('old-id', 140, 4, { hotel: { ...DRAKE, place_id: 'old-id', name: 'The Langham' } });
    await openWith(lodgingPage({ choice: chosen }));

    expect(cardState('The Drake')).toBe('plain');
    expect(cardState('Hotel Lux')).toBe('plain');
  });

  it('prefers the exact place ID over a same-named card', async () => {
    const twin = suggestion('p9', 'The Drake', 200);
    await openWith(lodgingPage({ suggestions: [twin, DRAKE], choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));

    const cards = screen.getAllByRole('article', { name: 'The Drake' });
    expect(cards.map((c) => c.classList.contains('hotel-card--chosen'))).toEqual([false, true]);
  });

  it('goes back to Choose when the stay is removed', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));
    api.delete.mockResolvedValue(overviewWith(null));

    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(yourStay()).getAllByRole('button', { name: 'Remove' })[0]);

    await waitFor(() => expect(cardState('The Drake')).toBe('plain'));
  });
});

describe('Your stay price and fit', () => {
  it('shows the fit badge for the stay', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p2', 300, 4, { hotel: LUX, fit: 'slightly_over' }) }));

    expect(within(yourStay()).getByText('Slightly over')).toHaveClass('fit-badge');
  });

  it('shows no fit badge for a skip or without a budget', async () => {
    await openWith(lodgingPage({ choice: skipChoice('have_place') }));
    expect(within(yourStay()).queryByText(/fits budget|slightly over|over budget/i)).not.toBeInTheDocument();
  });

  it('says "Estimated" while the saved price is still the estimate', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));

    expect(within(yourStay()).getByText('Estimated')).toHaveAttribute('title', 'Estimated, actual prices may vary.');
    expect(within(yourStay()).queryByText('Price when you chose it')).not.toBeInTheDocument();
  });

  it('says "Price when you chose it" once the estimate has changed', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));
    const repriced = { ...DRAKE, nightly_estimate: 150, stay_total: 600 };
    api.post.mockResolvedValue(lodgingPage({ suggestions: [repriced, LUX], choice: hotelChoice('p1', 140, 4) }).page);

    await userEvent.click(screen.getByRole('button', { name: /refresh suggestions/i }));

    expect(await within(yourStay()).findByText('Price when you chose it')).toBeInTheDocument();
    expect(within(yourStay()).getByText('$140 / night')).toBeInTheDocument(); // the stay keeps its price
    expect(within(card('The Drake')).getByText('$150 / night')).toBeInTheDocument();
  });

  it('says "Your price" for my own hotel', async () => {
    await openWith(lodgingPage({ choice: ownChoice('Lake House', 80, 4) }));

    expect(within(yourStay()).getByText('Your price')).toBeInTheDocument();
    expect(within(yourStay()).getByText('Fits budget')).toBeInTheDocument();
  });
});

describe('Your own hotel', () => {
  it('adds my own hotel with a live total, and checks the fields first', async () => {
    await openWith();
    api.put.mockResolvedValue(overviewWith(ownChoice('Lake House', 80, 3)));
    const add = screen.getByRole('button', { name: 'Add my own hotel' });

    await userEvent.click(add);
    const name = screen.getByLabelText('Hotel name');
    expect(name).toHaveFocus();
    expect(screen.getByLabelText('Nights')).toHaveValue(4);

    await userEvent.clear(screen.getByLabelText('Nights'));
    await userEvent.type(screen.getByLabelText('Nights'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save my hotel' }));
    expect(screen.getByText("Enter your hotel's name.")).toBeInTheDocument();
    expect(screen.getByText('Enter a nightly price.')).toBeInTheDocument();
    expect(screen.getByText('Nights must be between 1 and 4, the length of your trip.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();

    await userEvent.type(name, 'Lake House');
    await userEvent.type(screen.getByLabelText('Nightly price (USD)'), '80');
    await userEvent.clear(screen.getByLabelText('Nights'));
    await userEvent.type(screen.getByLabelText('Nights'), '3');
    expect(screen.getByText(/total:/i)).toHaveTextContent('Total: $240 for 3 nights');

    await userEvent.click(screen.getByRole('button', { name: 'Save my hotel' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging/stays/1', {
      choice: 'own',
      name: 'Lake House',
      nightly_price: 80,
      nights: 3,
    });
    const stay = await screen.findByRole('region', { name: /your stay/i });
    expect(within(stay).getByText('Lake House')).toBeInTheDocument();
    expect(within(stay).getByText('Your own place')).toBeInTheDocument();
    expect(within(stay).getByText('Your price')).toBeInTheDocument();
  });

  it("shows the server's message when saving fails", async () => {
    await openWith();
    api.put.mockRejectedValue(new ApiError('Nights must be between 1 and 4, the length of your trip.', 422));

    await userEvent.click(screen.getByRole('button', { name: 'Add my own hotel' }));
    await userEvent.type(screen.getByLabelText('Hotel name'), 'Lake House');
    await userEvent.type(screen.getByLabelText('Nightly price (USD)'), '80');
    await userEvent.click(screen.getByRole('button', { name: 'Save my hotel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nights must be between 1 and 4');
  });

  it('puts focus back on the button when the form is cancelled', async () => {
    await openWith();

    await userEvent.click(screen.getByRole('button', { name: 'Add my own hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Add my own hotel' })).toHaveFocus();
  });
});

describe('Skipping, changing and removing', () => {
  it('skips with one click and no confirm', async () => {
    await openWith();
    api.put.mockResolvedValue(overviewWith(skipChoice('not_needed')));

    await userEvent.click(screen.getByRole('button', { name: 'No hotel needed' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging/stays/1', { choice: 'skip', reason: 'not_needed' });
    expect(await screen.findByRole('region', { name: /your stay/i })).toHaveTextContent('No hotel needed');
    expect(screen.getByRole('button', { name: 'No hotel needed' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"I already have a place" saves that reason', async () => {
    await openWith();
    api.put.mockResolvedValue(overviewWith(skipChoice('have_place')));

    await userEvent.click(screen.getByRole('button', { name: 'I already have a place' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging/stays/1', { choice: 'skip', reason: 'have_place' });
    expect(await screen.findByRole('region', { name: /your stay/i })).toHaveTextContent('You already have a place');
  });

  it("Change edits a picked hotel's price and nights, then returns focus", async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));
    api.put.mockResolvedValue(overviewWith(hotelChoice('p1', 120, 2)));

    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Change' }));
    expect(screen.queryByLabelText('Hotel name')).not.toBeInTheDocument(); // Google's name, not editable
    const price = screen.getByLabelText('Nightly price (USD)');
    expect(price).toHaveFocus();
    expect(price).toHaveValue(140);

    await userEvent.clear(price);
    await userEvent.type(price, '120');
    await userEvent.clear(screen.getByLabelText('Nights'));
    await userEvent.type(screen.getByLabelText('Nights'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging/stays/1', {
      choice: 'hotel',
      place_id: 'p1',
      nightly_price: 120,
      nights: 2,
    });
    await waitFor(() => expect(within(yourStay()).getByRole('button', { name: 'Change' })).toHaveFocus());
    expect(within(yourStay()).getByText('$240 total, 2 nights')).toBeInTheDocument();
    expect(within(yourStay()).getByText('Price when you chose it')).toBeInTheDocument(); // 120, not today's 140
  });

  it('Remove asks first, starting on Cancel, then removes the stay', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));
    api.delete.mockResolvedValue(overviewWith(null));

    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Remove' }));
    expect(yourStay()).toHaveTextContent('This also removes its $560 Lodging line from your budget.');
    expect(within(yourStay()).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(within(yourStay()).getByRole('button', { name: 'Remove' })).toHaveFocus();

    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(yourStay()).getAllByRole('button', { name: 'Remove' })[0]);

    expect(api.delete).toHaveBeenCalledWith('/trips/7/lodging/stays/1');
    await waitFor(() => expect(screen.queryByRole('region', { name: /your stay/i })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Suggested hotels' })).toHaveFocus();
    expect(announced()).toMatch(/your stay was removed/i);
  });

  it('shows a hint when the trip got shorter than the stay', async () => {
    await openWith(lodgingPage({ nights: 2, choice: { ...ownChoice('Lake House', 80, 4), nights_exceed_stay: true } }));

    expect(yourStay()).toHaveTextContent('Your trip is now 2 nights, but your stay is set for 4.');
    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Update' }));
    expect(screen.getByLabelText('Hotel name')).toHaveValue('Lake House');
    expect(screen.getByLabelText('Nights')).toHaveValue(2); // capped at the trip's nights
  });
});

describe('Refresh and fallbacks', () => {
  it('Refresh searches again and shows the new estimates', async () => {
    await openWith();
    api.post.mockResolvedValue(lodgingPage({ suggestions: [{ ...DRAKE, nightly_estimate: 150, stay_total: 600 }, LUX] }).page);

    await userEvent.click(screen.getByRole('button', { name: /refresh suggestions/i }));

    expect(api.post).toHaveBeenCalledWith('/trips/7/lodging/stays/1/refresh');
    expect(await within(card('The Drake')).findByText('$150 / night')).toBeInTheDocument();
    expect(announced()).toMatch(/suggestions refreshed/i);
    // Refresh is the POST; the stay's search GET still ran only once.
    expect(api.get.mock.calls.filter(([path]) => path === '/trips/7/lodging/stays/1')).toHaveLength(1);
  });

  // Refresh only when the search itself worked: a retry may find hotels, but can't fix a missing key.
  it.each([
    ['not_configured', "We can't suggest hotels right now. You can still add your own.", false],
    ['unavailable', "We can't suggest hotels right now. You can still add your own.", false],
    ['ok', "We couldn't find hotels in Chicago, IL. You can still add your own.", true],
  ])('with no suggestions (%s) says so and still offers my own hotel', async (status, message, canRefresh) => {
    await openWith(lodgingPage({ suggestions: [], suggestions_status: status }));

    expect(screen.getByText(message, { exact: false })).toBeInTheDocument();
    expect(Boolean(screen.queryByRole('button', { name: /refresh suggestions/i }))).toBe(canRefresh);
    expect(screen.queryByText('Google Maps')).toBeNull();

    await userEvent.click(screen.getAllByRole('button', { name: 'Add my own hotel' })[0]);
    expect(screen.getByLabelText('Hotel name')).toHaveFocus();
  });

  it('without a budget, says the hotels are sorted by rating', async () => {
    await openWith(lodgingPage({ lodging_budget_left: null, fit_note: 'no_budget' }));

    expect(screen.getByText('Sorted by rating. Set a trip budget to see which hotels fit.')).toBeInTheDocument();
    expect(screen.getByText(/no budget set/i)).toBeInTheDocument();
  });

  it('says when none of the hotels fit', async () => {
    await openWith(lodgingPage({ lodging_budget_left: 520, fit_note: 'none_fit' }));

    expect(screen.getByText('None of these fit the $520 left for lodging.')).toBeInTheDocument();
  });
});

describe('Motion', () => {
  it('scrolls smoothly to Your stay after choosing', async () => {
    useReducedMotion(false);
    await openWith();
    api.put.mockResolvedValue(overviewWith(hotelChoice('p1', 140)));

    await userEvent.click(screen.getByRole('button', { name: 'Choose The Drake' }));

    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' }),
    );
  });

  it('jumps without animation when reduced motion is on', async () => {
    useReducedMotion(true);
    await openWith();
    api.put.mockResolvedValue(overviewWith(hotelChoice('p1', 140)));

    await userEvent.click(screen.getByRole('button', { name: 'Choose The Drake' }));

    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' }),
    );
  });
});

describe('Multi-city trips', () => {
  const KATHMANDU = 'Kathmandu, Nepal';
  const CHITWAN = 'Chitwan, Nepal';
  const TIGER = suggestion('t1', 'Tiger Lodge', 90, { area: 'Sauraha' });

  function twoStays({ first = {}, second = {}, earlier = [], left = 1600 } = {}) {
    const stays = [
      stayOut({ number: 1, city: KATHMANDU, check_out: '2026-11-07', nights: 2, budget_left: left, ...first }),
      stayOut({ number: 2, city: CHITWAN, check_in: '2026-11-07', nights: 2, budget_left: left, ...second }),
    ];
    const page = (stay, suggestions) => ({
      trip_id: 7,
      currency: 'USD',
      lodging_budget_left: left,
      stay,
      suggestions,
      suggestions_status: 'ok',
      fit_note: null,
    });
    return {
      overview: overviewOf(stays, { lodging_budget_left: left, earlier_choices: earlier }),
      pages: { 1: page(stays[0], [{ ...DRAKE, stay_total: 280 }]), 2: page(stays[1], [{ ...TIGER, stay_total: 180 }]) },
    };
  }

  async function openTrip(scenario = twoStays()) {
    mockLodging(api, scenario);
    render(<WhereToStay trip={STAY_TRIP} />);
    await screen.findByRole('heading', { name: 'Where to stay', level: 2 });
  }

  const section = (city) => screen.getByRole('button', { name: new RegExp(`^${city}`) });
  const searches = () => api.get.mock.calls.map(([path]) => path).filter((path) => path.includes('/stays/'));

  it('lists each stay as a section and searches only the first one', async () => {
    await openTrip();

    expect(screen.getByText('Your trip has 2 stays.', { exact: false })).toBeInTheDocument();
    expect(section(KATHMANDU)).toHaveAttribute('aria-expanded', 'true');
    expect(section(KATHMANDU)).toHaveAccessibleName(/Nov 5 – Nov 7, 2026 · 2 nights: Not chosen yet/);
    expect(section(CHITWAN)).toHaveAttribute('aria-expanded', 'false');
    expect(await screen.findByRole('article', { name: 'The Drake' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Tiger Lodge' })).toBeNull();
    expect(searches()).toEqual(['/trips/7/lodging/stays/1']);
  });

  it("opens another stay's section on demand, searching its city once", async () => {
    await openTrip();

    await userEvent.click(section(CHITWAN));
    expect(section(CHITWAN)).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('article', { name: 'Tiger Lodge' })).toBeVisible();

    await userEvent.click(section(CHITWAN)); // close: kept, just hidden
    expect(screen.getByRole('article', { name: 'Tiger Lodge', hidden: true })).not.toBeVisible();
    await userEvent.click(section(CHITWAN)); // and open again

    expect(screen.getByRole('article', { name: 'Tiger Lodge' })).toBeVisible();
    expect(searches()).toEqual(['/trips/7/lodging/stays/1', '/trips/7/lodging/stays/2']);
  });

  it("choosing for one stay updates its pill and re-judges the other stay's hotels", async () => {
    await openTrip();
    await userEvent.click(section(CHITWAN));
    await screen.findByRole('article', { name: 'Tiger Lodge' });
    expect(within(card('The Drake')).getByText('Fits budget')).toBeInTheDocument();
    // After the pick, only $100 is left for Kathmandu.
    const after = twoStays({ second: { choice: hotelChoice('t1', 90, 2) }, first: { budget_left: 100 } }).overview;
    api.put.mockResolvedValue(after);

    await userEvent.click(screen.getByRole('button', { name: 'Choose Tiger Lodge' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging/stays/2', { choice: 'hotel', place_id: 't1' });
    await waitFor(() => expect(section(CHITWAN)).toHaveAccessibleName(/Hotel chosen · \$180$/));
    expect(within(card('The Drake')).getByText('Over budget')).toBeInTheDocument(); // $280 of $100, no new search
    expect(screen.getByText('None of these fit the $100 left for lodging.')).toBeInTheDocument();
    expect(announced()).toMatch(/tiger lodge is now your stay in chitwan, nepal/i);
    expect(searches()).toHaveLength(2);
  });

  it('checks nights against the stay, not the whole trip', async () => {
    await openTrip();
    await screen.findByRole('article', { name: 'The Drake' });

    await userEvent.click(within(section(KATHMANDU).closest('section')).getByRole('button', { name: 'Add my own hotel' }));

    expect(screen.getByLabelText('Nights')).toHaveValue(2);
    await userEvent.clear(screen.getByLabelText('Nights'));
    await userEvent.type(screen.getByLabelText('Nights'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save my hotel' }));
    expect(screen.getByText('Nights must be between 1 and 2, the length of this stay.')).toBeInTheDocument();
  });

  it('points out a choice made for a different city by an earlier plan', async () => {
    const own = ownChoice('Tiger Camp', 80, 2);
    await openTrip(twoStays({ first: { choice: own, plan_changed: true, choice_city: 'Pokhara, Nepal' } }));

    expect(section(KATHMANDU)).toHaveAccessibleName(/Check your choice$/);
    expect(
      await screen.findByText(/Your plan changed: this choice was made for Pokhara, Nepal/),
    ).toBeInTheDocument();
    expect(yourStay()).toHaveTextContent('Tiger Camp'); // kept, not dropped
  });

  it('lists choices for stays the plan no longer has, and removes them', async () => {
    const earlier = [{ number: 3, city: 'Pokhara, Nepal', choice: ownChoice('Lake Inn', 70, 2) }];
    await openTrip(twoStays({ earlier }));
    api.delete.mockResolvedValue(twoStays().overview);
    const list = screen.getByRole('region', { name: 'No longer in your plan' });

    expect(list).toHaveTextContent('Pokhara, Nepal: Lake Inn · $140');
    await userEvent.click(within(list).getByRole('button', { name: /remove pokhara/i }));
    await userEvent.click(within(list).getByRole('button', { name: 'Remove' }));

    expect(api.delete).toHaveBeenCalledWith('/trips/7/lodging/stays/3');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'No longer in your plan' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Where to stay', level: 2 })).toHaveFocus();
  });

  it('a one-stay trip has no sections to open', async () => {
    await openWith();

    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
    expect(screen.queryByRole('button', { expanded: true })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Where to stay in Chicago, IL', level: 2 })).toBeInTheDocument();
  });
});

// main.jsx renders the app in StrictMode, which (in development) mounts, unmounts and mounts every
// component again. A section must still show its hotels after that, and a one-stay trip too.
describe('In StrictMode, like the app', () => {
  it("shows the first stay's hotels on a multi-city trip, not loading cards forever", async () => {
    const stays = [
      stayOut({ number: 1, city: 'Kathmandu, Nepal', check_out: '2026-11-07', nights: 2 }),
      stayOut({ number: 2, city: 'Chitwan, Nepal', check_in: '2026-11-07', nights: 2 }),
    ];
    const page = { trip_id: 7, currency: 'USD', lodging_budget_left: 1600, stay: stays[0], suggestions: [DRAKE, LUX], suggestions_status: 'ok', fit_note: null };
    mockLodging(api, { overview: overviewOf(stays), pages: { 1: page } });

    render(
      <StrictMode>
        <WhereToStay trip={STAY_TRIP} />
      </StrictMode>,
    );

    expect(await screen.findByRole('article', { name: 'The Drake' })).toBeVisible();
    // Done loading. (The unopened Chitwan section keeps its placeholders, hidden, until it's opened.)
    const first = screen.getByRole('button', { name: /^Kathmandu, Nepal/ }).closest('section');
    expect(within(first).queryByText(/finding hotels/i)).toBeNull();
    expect(api.get.mock.calls.map(([path]) => path)).not.toContain('/trips/7/lodging/stays/2');
  });

  it("shows a one-stay trip's hotels", async () => {
    const { overview, page } = lodgingPage();
    mockLodging(api, { overview, pages: { 1: page } });

    render(
      <StrictMode>
        <WhereToStay trip={STAY_TRIP} />
      </StrictMode>,
    );

    expect(await screen.findByRole('article', { name: 'The Drake' })).toBeVisible();
  });
});

describe('Every night in transit', () => {
  it('says there is nowhere to book, and searches nothing', async () => {
    const overview = overviewOf([], { nights: nightsOf(['2026-11-05', '2026-11-06'], ['2026-11-05', '2026-11-06']) });
    mockLodging(api, { overview, pages: {} });
    render(<WhereToStay trip={STAY_TRIP} />);

    expect(await screen.findByRole('heading', { name: 'Where to stay', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/every night of this trip is spent travelling/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Suggested hotels' })).toBeNull();
    expect(api.get.mock.calls.map(([path]) => path)).toEqual(['/trips/7/lodging']);
  });
});

describe('A night switched on the Itinerary', () => {
  it('reloads the stays without searching again', async () => {
    const { overview, page } = lodgingPage();
    mockLodging(api, { overview, pages: { 1: page } });
    const { rerender } = render(<WhereToStay trip={STAY_TRIP} nightsVersion={0} />);
    await screen.findByRole('article', { name: 'The Drake' });

    rerender(<WhereToStay trip={STAY_TRIP} nightsVersion={1} />);

    await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path === '/trips/7/lodging')).toHaveLength(2));
    expect(screen.getByRole('article', { name: 'The Drake' })).toBeVisible(); // no loading flash, same stay
    expect(api.get.mock.calls.filter(([path]) => path.includes('/stays/'))).toHaveLength(1);
  });
});

describe('Splitting a stay and merging it back', () => {
  const TIGER = suggestion('t1', 'Tiger Lodge', 90);
  const YAK = suggestion('y1', 'Yak Hotel', 120);
  const page = (stay, suggestions = [DRAKE, LUX]) => ({
    trip_id: 7,
    currency: 'USD',
    lodging_budget_left: 1600,
    stay,
    suggestions,
    suggestions_status: 'ok',
    fit_note: null,
  });

  /** Chicago, Nov 5 – 9, split on Nov 7 into two 2-night parts. */
  function twoParts(first = {}, second = {}) {
    const stays = [
      stayOut({ check_out: '2026-11-07', nights: 2, part: 1, parts: 2, can_split: true, ...first }),
      stayOut({
        number: 2,
        check_in: '2026-11-07',
        nights: 2,
        part: 2,
        parts: 2,
        merge_night: '2026-11-07',
        can_split: true,
        ...second,
      }),
    ];
    return { overview: overviewOf(stays), pages: { 1: page(stays[0]), 2: page(stays[1], [TIGER]) } };
  }

  const searches = () => api.get.mock.calls.map(([path]) => path).filter((path) => path.includes('/stays/'));
  const part = (n) => screen.getByRole('button', { name: new RegExp(`^Chicago, IL, part ${n} of 2`) });

  async function openParts(scenario) {
    mockLodging(api, scenario);
    render(<WhereToStay trip={STAY_TRIP} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Chicago, IL, part 2 of 2/ }));
    await screen.findByRole('article', { name: 'Tiger Lodge' });
  }

  it('splits a stay on the night I pick, keeping my choice for the first part', async () => {
    const whole = stayOut({ can_split: true, choice: ownChoice('Lake House', 80, 4) });
    mockLodging(api, { overview: overviewOf([whole]), pages: { 1: page(whole) } });
    render(<WhereToStay trip={STAY_TRIP} />);
    await screen.findByRole('article', { name: 'The Drake' });

    await userEvent.click(screen.getByRole('button', { name: 'Split this stay' }));

    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.closest('label').textContent)).toEqual([
      'Fri, Nov 6: 1 night + 3 nights',
      'Sat, Nov 7: 2 nights + 2 nights',
      'Sun, Nov 8: 3 nights + 1 night',
    ]);
    expect(options[1]).toBeChecked();
    expect(options[1]).toHaveFocus();
    expect(screen.getByText(/Lake House will be set to 2 nights \(\$160\), and its Lodging line with it\./)).toBeInTheDocument();

    const after = twoParts({ choice: ownChoice('Lake House', 80, 2) });
    api.put.mockResolvedValue(after.overview);
    mockLodging(api, after);
    await userEvent.click(screen.getByRole('button', { name: 'Split' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/splits/2026-11-07');
    expect(await screen.findByRole('article', { name: 'Tiger Lodge' })).toBeVisible(); // part 2 opened and searched
    expect(part(1)).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(part(2)).toHaveFocus());
    expect(announced()).toMatch(/chicago, il is now two stays: 2 nights and 2 nights\. lake house is now set to 2 nights/i);
    // Part 1 kept its hotels (no new search), re-totalled for its 2 nights.
    expect(searches()).toEqual(['/trips/7/lodging/stays/1', '/trips/7/lodging/stays/2']);
    expect(within(card('The Drake')).getByText('$280 total, 2 nights')).toBeInTheDocument();
  });

  it("keeps later stays open with their hotels when they're renumbered, without searching again", async () => {
    const KTM = 'Kathmandu, Nepal';
    const CHT = 'Chitwan, Nepal';
    const kathmandu = stayOut({ city: KTM, check_out: '2026-11-08', nights: 3, can_split: true });
    const chitwan = stayOut({ number: 2, city: CHT, check_in: '2026-11-08', nights: 1 });
    mockLodging(api, { overview: overviewOf([kathmandu, chitwan]), pages: { 1: page(kathmandu), 2: page(chitwan, [TIGER]) } });
    render(<WhereToStay trip={STAY_TRIP} />);
    await screen.findByRole('article', { name: 'The Drake' });
    await userEvent.click(screen.getByRole('button', { name: /^Chitwan, Nepal/ }));
    await screen.findByRole('article', { name: 'Tiger Lodge' }); // Chitwan opened: stay 2

    // Split Kathmandu after its first night: Chitwan becomes stay 3.
    const after = [
      stayOut({ city: KTM, check_out: '2026-11-06', nights: 1, part: 1, parts: 2 }),
      stayOut({ number: 2, city: KTM, check_in: '2026-11-06', check_out: '2026-11-08', nights: 2, part: 2, parts: 2, merge_night: '2026-11-06' }),
      stayOut({ number: 3, city: CHT, check_in: '2026-11-08', nights: 1 }),
    ];
    api.put.mockResolvedValue(overviewOf(after));
    mockLodging(api, { overview: overviewOf(after), pages: { 1: page(after[0]), 2: page(after[1], [YAK]), 3: page(after[2], [TIGER]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Split this stay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Split' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/splits/2026-11-06');
    expect(await screen.findByRole('article', { name: 'Yak Hotel' })).toBeVisible(); // the new part
    expect(screen.getByRole('article', { name: 'Tiger Lodge' })).toBeVisible(); // Chitwan: still open
    // Kathmandu, Chitwan (as stay 2), then the new part (stay 2 now): Chitwan was never searched as stay 3.
    expect(searches()).toEqual(['/trips/7/lodging/stays/1', '/trips/7/lodging/stays/2', '/trips/7/lodging/stays/2']);
  });

  it("shows why a split can't be made", async () => {
    const whole = stayOut({ can_split: true });
    mockLodging(api, { overview: overviewOf([whole]), pages: { 1: page(whole) } });
    render(<WhereToStay trip={STAY_TRIP} />);
    await screen.findByRole('article', { name: 'The Drake' });
    api.put.mockRejectedValue(new ApiError('A trip can have at most 6 stays, counting split ones.', 422));

    await userEvent.click(screen.getByRole('button', { name: 'Split this stay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Split' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A trip can have at most 6 stays, counting split ones.');
  });

  it("cancelling a split puts focus back, and a stay that can't be split has no button", async () => {
    const whole = stayOut({ can_split: true });
    mockLodging(api, { overview: overviewOf([whole]), pages: { 1: page(whole) } });
    render(<WhereToStay trip={STAY_TRIP} />);
    await screen.findByRole('article', { name: 'The Drake' });

    await userEvent.click(screen.getByRole('button', { name: 'Split this stay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Split this stay' })).toHaveFocus();
    expect(api.put).not.toHaveBeenCalled();

    cleanup();
    await openWith(); // can_split is false
    expect(screen.queryByRole('button', { name: 'Split this stay' })).toBeNull();
  });

  it.each([
    [
      'both parts have a choice',
      { choice: ownChoice('Hotel Thamel', 35, 2) },
      { choice: ownChoice('Yak & Yeti', 120, 2) },
      "Merge back into one stay? Part 1's choice stays. Part 2's choice (Yak & Yeti) and its $240 Lodging line will be removed.",
    ],
    [
      'only part 2 has a choice',
      {},
      { choice: ownChoice('Yak & Yeti', 120, 2) },
      'Merge back into one stay? Yak & Yeti will cover all 4 nights ($480).',
    ],
    [
      'only part 1 has a choice',
      { choice: ownChoice('Hotel Thamel', 35, 2) },
      {},
      "Merge back into one stay? Part 1's choice (Hotel Thamel) stays as it is.",
    ],
    ['neither part has a choice', {}, {}, 'Merge back into one stay?'],
  ])('merging when %s says what will happen, then merges', async (_, first, second, message) => {
    await openParts(twoParts(first, second));
    api.delete.mockResolvedValue(overviewOf([stayOut({ can_split: true })]));

    await userEvent.click(screen.getByRole('button', { name: 'Merge with part 1' }));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus(); // a second Enter can't merge

    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));

    expect(api.delete).toHaveBeenCalledWith('/trips/7/splits/2026-11-07');
    expect(await screen.findByRole('heading', { name: 'Where to stay in Chicago, IL', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /part 2 of 2/ })).toBeNull();
    expect(announced()).toMatch(/chicago, il is one stay again/i);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Where to stay in Chicago, IL' })).toHaveFocus());
    expect(searches()).toEqual(['/trips/7/lodging/stays/1', '/trips/7/lodging/stays/2']); // no new search
  });
});
