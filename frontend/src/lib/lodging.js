/** Where to stay: labels and helpers for GET /trips/{id}/lodging. Money is USD, like the budget. */
import { formatCurrency } from './format';

export const FIT_LABELS = {
  fits: 'Fits budget',
  slightly_over: 'Slightly over',
  over: 'Over budget',
};

export const SKIP_LABELS = {
  have_place: 'You already have a place',
  not_needed: 'No hotel needed',
};

export const ESTIMATE_NOTE = 'Estimated, actual prices may vary.';

/** Check-in on the start date, check-out on the end date; a same-day trip counts one night. */
export function tripNights(trip) {
  const ms = new Date(`${trip.end_date}T00:00`) - new Date(`${trip.start_date}T00:00`);
  return Math.max(1, Math.round(ms / 86_400_000));
}

export function nightsText(nights) {
  return `${nights} ${nights === 1 ? 'night' : 'nights'}`;
}

/** Nightly price x nights, in whole cents like the server's cost line. */
export function stayTotal(nightly, nights) {
  return (Math.round(nightly * 100) * nights) / 100;
}

/** "4.6 out of 5, 1,284 reviews" for screen readers. */
export function ratingLabel(rating, reviewCount) {
  const label = `${rating} out of 5`;
  if (reviewCount == null) return label;
  return `${label}, ${reviewCount.toLocaleString()} ${reviewCount === 1 ? 'review' : 'reviews'}`;
}

/** The header's "$1,600 left for lodging", or why there's no such number. */
export function lodgingLeftText(left) {
  if (left == null) return 'No budget set';
  if (left < 0) return `Other costs are ${formatCurrency(-left)} over budget`;
  return `${formatCurrency(left)} left for lodging`;
}

/** The note above the suggestions when there's no budget or nothing fits. */
export function fitNoteText(fitNote, left) {
  if (fitNote === 'no_budget') return 'Sorted by rating. Set a trip budget to see which hotels fit.';
  if (fitNote === 'none_fit') {
    return left > 0
      ? `None of these fit the ${formatCurrency(left)} left for lodging.`
      : 'None of these fit: your other costs already use the whole budget.';
  }
  return '';
}

/** Element ids for one stay's section, so several sections can share a page. */
export function stayIds(number) {
  const prefix = `stay-${number}`;
  return {
    section: `${prefix}-section`,
    body: `${prefix}-body`,
    choiceTitle: `${prefix}-choice-title`,
    change: `${prefix}-change`,
    suggestionsTitle: `${prefix}-suggestions-title`,
    addOwn: `${prefix}-add-own`,
    elsewhereTitle: `${prefix}-elsewhere-title`,
  };
}

/**
 * A plan day's lodging, from GET /lodging (`lodging`: its nights and stays). Dates are YYYY-MM-DD.
 *   night:    that night (in transit or not); none on the last day: the trip ends
 *   tonight:  the stay it sleeps in; none when the night is in transit
 *   checkOut: the city of a stay that ends this morning; checkIn: of one that starts today.
 *             Not on the trip's first and last days, which are arriving and going home.
 */
export function dayLodging(lodging, date, firstDate, lastDate) {
  if (!lodging) return { night: null, tonight: null, checkOut: null, checkIn: null };
  const { nights = [], stays = [] } = lodging;
  const night = date === lastDate ? null : nights.find((n) => n.date === date) ?? null;
  const tonight =
    date === lastDate || night?.in_transit ? null : stays.find((s) => s.check_in <= date && date < s.check_out) ?? null;
  const checkOut = date === lastDate ? null : stays.find((s) => s.check_out === date)?.city ?? null;
  const checkIn = date === firstDate ? null : stays.find((s) => s.check_in === date)?.city ?? null;
  return { night, tonight, checkOut, checkIn };
}

/**
 * Where the traveler sleeps, for the Itinerary: "your hotel in Chitwan" (Google's names cost a lookup
 * on every visit, so they aren't shown), their own hotel's name, or what they told us.
 * null when there's nothing settled to show: no choice yet, or one made for a different city.
 */
export function tonightText(stay) {
  const { choice, city } = stay;
  if (!choice || stay.plan_changed) return null;
  if (choice.choice === 'hotel') return `your hotel in ${city}`;
  if (choice.choice === 'own') return choice.custom_name;
  return choice.skip_reason === 'have_place' ? `your own place in ${city}` : 'no hotel needed';
}

/** The status pill on a stay's header: what's been decided for it. */
export function stayStatus(stay) {
  const { choice } = stay;
  if (stay.plan_changed) return { kind: 'check', text: 'Check your choice' };
  if (!choice) return { kind: 'open', text: 'Not chosen yet' };
  if (choice.choice === 'skip') return { kind: 'done', text: SKIP_LABELS[choice.skip_reason] };
  const label = choice.choice === 'hotel' ? 'Hotel chosen' : 'Your own place';
  return { kind: 'done', text: `${label} · ${formatCurrency(choice.total)}` };
}

// Mirrors lodging.SLIGHTLY_OVER_SHARE and budget_fit() on the server.
const SLIGHTLY_OVER_SHARE = 0.1;
const FIT_ORDER = { fits: 0, slightly_over: 1, over: 2 };

function cents(amount) {
  return Math.round(amount * 100);
}

export function budgetFit(total, left) {
  if (total == null || left == null) return null;
  if (cents(total) <= cents(left)) return 'fits';
  if (left > 0 && cents(total) <= cents(left * (1 + SLIGHTLY_OVER_SHARE))) return 'slightly_over';
  return 'over';
}

/**
 * A stay's suggestions judged against what's left for it now. Choosing a hotel for another stay
 * changes that, and searching again just to re-score would be billed, so the fit, order, best fit
 * and note are worked out here the way the server does it. Unchanged budget: the server's answer.
 */
export function rescore(page, left) {
  if (left === page.stay.budget_left) return { suggestions: page.suggestions, fitNote: page.fit_note };
  const scored = page.suggestions.map((hotel) => ({ ...hotel, fit: budgetFit(hotel.stay_total, left), best_fit: false }));
  if (left != null) {
    const order = (fit) => FIT_ORDER[fit] ?? 3;
    scored.sort(
      (a, b) =>
        order(a.fit) - order(b.fit) ||
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (a.stay_total ?? Infinity) - (b.stay_total ?? Infinity),
    );
    if (scored[0]?.fit === 'fits') scored[0] = { ...scored[0], best_fit: true };
  }
  let fitNote = null;
  if (left == null) fitNote = 'no_budget';
  else if (scored.some((hotel) => hotel.fit) && !scored.some((hotel) => hotel.fit === 'fits')) fitNote = 'none_fit';
  return { suggestions: scored, fitNote };
}

function sameName(name) {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The place ID of the suggestion that is the chosen hotel, or null.
 * By place ID first. If Google now lists the hotel under a different ID, fall back to its name
 * (from the fresh details in GET /lodging): compared here only, nothing is saved.
 */
export function chosenSuggestionId(choice, suggestions) {
  if (choice?.choice !== 'hotel') return null;
  if (suggestions.some((hotel) => hotel.place_id === choice.place_id)) return choice.place_id;
  const name = sameName(choice.hotel?.name);
  if (!name) return null;
  return suggestions.find((hotel) => sameName(hotel.name) === name)?.place_id ?? null;
}

/** The chosen hotel's name for messages: Google's (fresh), the traveler's own, or a fallback. */
export function choiceName(choice, hotel) {
  return hotel?.name || choice.custom_name || 'Your hotel';
}
