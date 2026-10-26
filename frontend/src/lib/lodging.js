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
