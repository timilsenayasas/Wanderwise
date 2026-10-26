/** Test data shaped like the API: GET /api/trips/7/lodging and PUT /api/trips/7/lodging. */

/** Nov 5 – 9: 4 nights, $2,000 budget. */
export const STAY_TRIP = {
  id: 7,
  origin: 'Dallas, TX',
  destination: 'Chicago, IL',
  start_date: '2026-11-05',
  end_date: '2026-11-09',
  travelers: 2,
  budget: 2000,
  interests: ['food', 'museums'],
  created_at: '2026-10-24T12:00:00Z',
};

export function suggestion(placeId, name, nightly, overrides = {}) {
  return {
    place_id: placeId,
    name,
    area: 'Near North Side',
    address: `1 ${name} St, Chicago, IL 60611, USA`,
    rating: 4.6,
    review_count: 1284,
    google_maps_uri: `https://maps.google.com/?cid=${placeId}`,
    photo: {
      uri: `https://lh3.googleusercontent.com/${placeId}`,
      authors: [{ name: 'Sam Lee', uri: 'https://maps.google.com/maps/contrib/1' }],
    },
    nightly_estimate: nightly,
    stay_total: nightly == null ? null : nightly * 4,
    fit: nightly == null ? null : 'fits',
    best_fit: false,
    ...overrides,
  };
}

export const DRAKE = suggestion('p1', 'The Drake', 140, { best_fit: true });
export const LUX = suggestion('p2', 'Hotel Lux', 300, { rating: 4.2, review_count: 310, fit: 'slightly_over' });

export function lodgingPage(overrides = {}) {
  return {
    trip_id: 7,
    currency: 'USD',
    nights: 4,
    lodging_budget_left: 1600,
    choice: null,
    suggestions: [DRAKE, LUX],
    suggestions_status: 'ok',
    fit_note: null,
    ...overrides,
  };
}

/** A PUT answer: hotel details aren't repeated (the page already has them). */
export function hotelChoice(placeId, nightly, nights = 4, overrides = {}) {
  return {
    choice: 'hotel',
    skip_reason: null,
    place_id: placeId,
    hotel: null,
    custom_name: null,
    nightly_price: nightly,
    nights,
    total: nightly * nights,
    nights_exceed_trip: false,
    ...overrides,
  };
}

export function ownChoice(name, nightly, nights = 4) {
  return { ...hotelChoice(null, nightly, nights), choice: 'own', place_id: null, custom_name: name };
}

export function skipChoice(reason) {
  return {
    ...hotelChoice(null, 0, 0),
    choice: 'skip',
    skip_reason: reason,
    place_id: null,
    nightly_price: null,
    nights: null,
    total: null,
  };
}
