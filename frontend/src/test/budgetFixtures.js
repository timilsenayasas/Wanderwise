/** Test data shaped like the API: GET /api/trips/7 and GET /api/trips/7/budget (A2). */

export const TRIP = {
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

export const PLAN_FOOD = { id: 1, category: 'food', description: '2 activities', amount: 65, source: 'plan', trip_date: null };
export const PLAN_ACTIVITIES = { id: 2, category: 'activities', description: '2 activities', amount: 32, source: 'plan', trip_date: null };
export const HOTEL = { id: 3, category: 'lodging', description: 'Hotel, 1 night', amount: 300, source: 'user', trip_date: '2026-11-05' };
export const TRAIN = { id: 4, category: 'transport', description: 'Airport train', amount: 45.5, source: 'user', trip_date: null };

/** A trip with a 2-day plan plus two user lines (one on day 1, one not on a day). Total $442.50. */
export function budgetResponse(overrides = {}) {
  return {
    trip_id: 7,
    currency: 'USD',
    estimated: true,
    categories: [
      { category: 'food', amount: 65 },
      { category: 'activities', amount: 32 },
      { category: 'transport', amount: 45.5 },
      { category: 'lodging', amount: 300 },
      { category: 'other', amount: 0 },
    ],
    per_day: [
      { day_number: 1, date: '2026-11-05', amount: 357 },
      { day_number: 2, date: '2026-11-06', amount: 40 },
    ],
    not_by_day: 45.5,
    total: 442.5,
    budget: 1200,
    remaining: 757.5,
    over_budget: false,
    items: [PLAN_FOOD, PLAN_ACTIVITIES, HOTEL, TRAIN],
    ...overrides,
  };
}
