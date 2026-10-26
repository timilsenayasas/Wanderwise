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

/** A stay as the API describes it (StayOut). Stay 1 is the whole Nov 5 – 9 trip. */
export function stayOut(overrides = {}) {
  return {
    number: 1,
    city: 'Chicago, IL',
    check_in: '2026-11-05',
    check_out: '2026-11-09',
    nights: 4,
    budget_left: 1600,
    choice: null,
    plan_changed: false,
    choice_city: null,
    ...overrides,
  };
}

/** GET /lodging (and what PUT/DELETE answer with): the stays and their choices, without Google details. */
export function overviewOf(stays, { lodging_budget_left = 1600, earlier_choices = [], nights = [] } = {}) {
  const withoutDetails = (stay) => ({ ...stay, choice: stay.choice && { ...stay.choice, hotel: null } });
  return { trip_id: 7, currency: 'USD', lodging_budget_left, nights, stays: stays.map(withoutDetails), earlier_choices };
}

/** GET /lodging's nights: one per date, in transit when listed in `transit` (set by the plan unless `byYou`). */
export function nightsOf(dates, transit = [], byYou = []) {
  return dates.map((date) => ({
    date,
    in_transit: transit.includes(date),
    set_by: byYou.includes(date) ? 'you' : 'plan',
  }));
}

/** The overview a PUT answers with for a one-stay trip whose stay now has this choice. */
export function overviewWith(choice, stayOverrides = {}) {
  return overviewOf([stayOut({ choice, ...stayOverrides })]);
}

/**
 * A one-stay trip: { overview, page } for GET /lodging and GET /lodging/stays/1.
 * Takes the same options the single-stay tab used to get in one answer.
 */
export function lodgingPage(overrides = {}) {
  const {
    nights = 4,
    lodging_budget_left = 1600,
    choice = null,
    suggestions = [DRAKE, LUX],
    suggestions_status = 'ok',
    fit_note = null,
  } = overrides;
  const stay = stayOut({ nights, budget_left: lodging_budget_left, choice });
  return {
    overview: overviewOf([stay], { lodging_budget_left }),
    page: { trip_id: 7, currency: 'USD', lodging_budget_left, stay, suggestions, suggestions_status, fit_note },
  };
}

/** api.get answers: /lodging with the overview, /lodging/stays/{n} with pages[n]. Other paths: `other(path)`. */
export function mockLodging(api, { overview, pages }, other = () => Promise.resolve(null)) {
  api.get.mockImplementation((path) => {
    if (path.endsWith('/lodging')) return Promise.resolve(overview);
    const stay = path.match(/\/lodging\/stays\/(\d+)$/);
    if (stay) return Promise.resolve(pages[stay[1]]);
    return other(path);
  });
}

/** A choice as the API gives it. In PUT answers (the overview) there are no hotel details. */
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
    fit: 'fits',
    nights_exceed_stay: false,
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
    fit: null,
  };
}
