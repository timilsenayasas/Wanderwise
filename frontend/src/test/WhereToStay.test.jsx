import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import WhereToStay from '../components/WhereToStay';
import {
  DRAKE,
  hotelChoice,
  lodgingPage,
  LUX,
  ownChoice,
  skipChoice,
  STAY_TRIP,
  suggestion,
} from './lodgingFixtures';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

/** Open the tab with this GET answer and wait for the suggestions (or their fallback). */
async function openWith(page = lodgingPage()) {
  api.get.mockResolvedValue(page);
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
    api.get.mockResolvedValue(lodgingPage());
    render(<WhereToStay trip={STAY_TRIP} />);

    expect(screen.getByText(/finding hotels in chicago, il/i)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { name: 'Where to stay in Chicago, IL' })).toBeInTheDocument();

    expect(await screen.findByRole('article', { name: 'The Drake' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/trips/7/lodging');
    expect(screen.getByText(/4 nights · \$1,600 left for lodging/)).toBeInTheDocument();
  });

  it('shows the error with a retry button when loading fails', async () => {
    api.get.mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0));
    api.get.mockResolvedValueOnce(lodgingPage());
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
    api.put.mockResolvedValue(hotelChoice('p1', 140));

    await userEvent.click(within(card('The Drake')).getByRole('button', { name: 'Choose The Drake' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging', { choice: 'hotel', place_id: 'p1' });
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
    api.put.mockResolvedValue(hotelChoice('p3', 99));

    await userEvent.click(screen.getByRole('button', { name: 'Choose New Inn' }));
    const price = screen.getByLabelText('Nightly price for New Inn (USD)');
    expect(price).toHaveFocus();

    await userEvent.click(within(card('New Inn')).getByRole('button', { name: 'Choose' }));
    expect(screen.getByText('Enter a nightly price.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();

    await userEvent.type(price, '99');
    await userEvent.click(within(card('New Inn')).getByRole('button', { name: 'Choose' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging', { choice: 'hotel', place_id: 'p3', nightly_price: 99 });
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
    api.put.mockResolvedValue(hotelChoice('p2', 300));

    await userEvent.click(screen.getByRole('button', { name: 'Choose Hotel Lux' }));

    await waitFor(() => expect(cardState('Hotel Lux')).toBe('chosen'));
    expect(cardState('The Drake')).toBe('plain');
  });

  it('keeps the chosen state after Refresh', async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));
    api.post.mockResolvedValue(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));

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
    api.delete.mockResolvedValue(null);

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
    api.post.mockResolvedValue(lodgingPage({ suggestions: [repriced, LUX], choice: hotelChoice('p1', 140, 4) }));

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
    api.put.mockResolvedValue(ownChoice('Lake House', 80, 3));
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

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging', {
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
    api.put.mockResolvedValue(skipChoice('not_needed'));

    await userEvent.click(screen.getByRole('button', { name: 'No hotel needed' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging', { choice: 'skip', reason: 'not_needed' });
    expect(await screen.findByRole('region', { name: /your stay/i })).toHaveTextContent('No hotel needed');
    expect(screen.getByRole('button', { name: 'No hotel needed' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"I already have a place" saves that reason', async () => {
    await openWith();
    api.put.mockResolvedValue(skipChoice('have_place'));

    await userEvent.click(screen.getByRole('button', { name: 'I already have a place' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging', { choice: 'skip', reason: 'have_place' });
    expect(await screen.findByRole('region', { name: /your stay/i })).toHaveTextContent('You already have a place');
  });

  it("Change edits a picked hotel's price and nights, then returns focus", async () => {
    await openWith(lodgingPage({ choice: hotelChoice('p1', 140, 4, { hotel: DRAKE }) }));
    api.put.mockResolvedValue(hotelChoice('p1', 120, 2));

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

    expect(api.put).toHaveBeenCalledWith('/trips/7/lodging', {
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
    api.delete.mockResolvedValue(null);

    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Remove' }));
    expect(yourStay()).toHaveTextContent('This also removes its $560 Lodging line from your budget.');
    expect(within(yourStay()).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(within(yourStay()).getByRole('button', { name: 'Remove' })).toHaveFocus();

    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(yourStay()).getAllByRole('button', { name: 'Remove' })[0]);

    expect(api.delete).toHaveBeenCalledWith('/trips/7/lodging');
    await waitFor(() => expect(screen.queryByRole('region', { name: /your stay/i })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Suggested hotels' })).toHaveFocus();
    expect(announced()).toMatch(/your stay was removed/i);
  });

  it('shows a hint when the trip got shorter than the stay', async () => {
    await openWith(lodgingPage({ nights: 2, choice: { ...ownChoice('Lake House', 80, 4), nights_exceed_trip: true } }));

    expect(yourStay()).toHaveTextContent('Your trip is now 2 nights, but your stay is set for 4.');
    await userEvent.click(within(yourStay()).getByRole('button', { name: 'Update' }));
    expect(screen.getByLabelText('Hotel name')).toHaveValue('Lake House');
    expect(screen.getByLabelText('Nights')).toHaveValue(2); // capped at the trip's nights
  });
});

describe('Refresh and fallbacks', () => {
  it('Refresh searches again and shows the new estimates', async () => {
    await openWith();
    api.post.mockResolvedValue(lodgingPage({ suggestions: [{ ...DRAKE, nightly_estimate: 150, stay_total: 600 }, LUX] }));

    await userEvent.click(screen.getByRole('button', { name: /refresh suggestions/i }));

    expect(api.post).toHaveBeenCalledWith('/trips/7/lodging/refresh');
    expect(await within(card('The Drake')).findByText('$150 / night')).toBeInTheDocument();
    expect(announced()).toMatch(/suggestions refreshed/i);
    expect(api.get).toHaveBeenCalledTimes(1);
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
    api.put.mockResolvedValue(hotelChoice('p1', 140));

    await userEvent.click(screen.getByRole('button', { name: 'Choose The Drake' }));

    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' }),
    );
  });

  it('jumps without animation when reduced motion is on', async () => {
    useReducedMotion(true);
    await openWith();
    api.put.mockResolvedValue(hotelChoice('p1', 140));

    await userEvent.click(screen.getByRole('button', { name: 'Choose The Drake' }));

    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' }),
    );
  });
});
