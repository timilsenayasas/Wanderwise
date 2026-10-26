import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ItineraryView from '../components/ItineraryView';
import { hotelChoice, ownChoice, skipChoice, stayOut } from './lodgingFixtures';

const KATHMANDU = 'Kathmandu, Nepal';
const CHITWAN = 'Chitwan, Nepal';

/** Nov 5 – 9: five days with one activity each. */
const PLAN = {
  trip_id: 7,
  destination: KATHMANDU,
  currency: 'USD',
  total_estimated_cost: 0,
  days: ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map((date, i) => ({
    id: i + 1,
    day_number: i + 1,
    date,
    base_city: i < 2 ? KATHMANDU : CHITWAN,
    activities: [
      {
        id: i + 1,
        start_time: '09:00',
        end_time: '10:00',
        duration_minutes: 60,
        name: `Stop ${i + 1}`,
        category: 'sightseeing',
        location: 'Somewhere',
        description: '',
        estimated_cost: 0,
        travel_time_to_next_minutes: 0,
        latitude: null,
        longitude: null,
      },
    ],
  })),
  cost_items: [],
};

function twoStays(first = {}, second = {}) {
  return [
    stayOut({ number: 1, city: KATHMANDU, check_in: '2026-11-05', check_out: '2026-11-07', nights: 2, ...first }),
    stayOut({ number: 2, city: CHITWAN, check_in: '2026-11-07', check_out: '2026-11-09', nights: 2, ...second }),
  ];
}

function day(number) {
  return screen.getByRole('region', { name: new RegExp(`^Day ${number}\\b`) });
}

describe('Where you sleep on the Itinerary', () => {
  it('says where each night is, and nothing on the last day', () => {
    const stays = twoStays({ choice: hotelChoice('p1', 140, 2) }, { choice: ownChoice('Tiger Camp', 80, 2) });
    render(<ItineraryView itinerary={PLAN} stays={stays} />);

    expect(day(1)).toHaveTextContent(`Tonight: your hotel in ${KATHMANDU}`);
    expect(day(2)).toHaveTextContent(`Tonight: your hotel in ${KATHMANDU}`);
    expect(day(3)).toHaveTextContent('Tonight: Tiger Camp');
    expect(day(4)).toHaveTextContent('Tonight: Tiger Camp');
    expect(day(5)).not.toHaveTextContent('Tonight'); // the trip ends
  });

  it("never shows a Google hotel's name (it would cost a lookup on every visit)", () => {
    render(<ItineraryView itinerary={PLAN} stays={twoStays({ choice: hotelChoice('p1', 140, 2, { hotel: null }) })} />);

    expect(day(1)).toHaveTextContent(`Tonight: your hotel in ${KATHMANDU}`);
  });

  it('shows check-out and check-in on the day the city changes, and only then', () => {
    render(<ItineraryView itinerary={PLAN} stays={twoStays()} />);

    const move = within(day(3)).getByRole('list', { name: 'Moving on today' });
    expect(within(move).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `Check out: ${KATHMANDU}`,
      `Check in: ${CHITWAN}`,
    ]);
    for (const other of [1, 2, 4, 5]) {
      expect(within(day(other)).queryByRole('list', { name: 'Moving on today' })).toBeNull();
    }
  });

  it('words skips as what the traveler told us', () => {
    render(
      <ItineraryView
        itinerary={PLAN}
        stays={twoStays({ choice: skipChoice('have_place') }, { choice: skipChoice('not_needed') })}
      />,
    );

    expect(day(1)).toHaveTextContent(`Tonight: your own place in ${KATHMANDU}`);
    expect(day(3)).toHaveTextContent('Tonight: no hotel needed');
  });

  it('points to the Stay tab for a night with nothing chosen yet', async () => {
    const onShowStay = vi.fn();
    render(<ItineraryView itinerary={PLAN} stays={twoStays({ choice: hotelChoice('p1', 140, 2) })} onShowStay={onShowStay} />);

    expect(day(3)).toHaveTextContent(`Tonight in ${CHITWAN}: no hotel chosen yet`);
    expect(within(day(1)).queryByRole('button')).toBeNull();

    await userEvent.click(within(day(3)).getByRole('button', { name: 'Choose where to stay' }));
    expect(onShowStay).toHaveBeenCalledTimes(1);
  });

  it("doesn't claim a hotel when the plan changed under the choice", () => {
    const moved = { choice: ownChoice('Pokhara Inn', 70, 2), plan_changed: true, choice_city: 'Pokhara, Nepal' };
    render(<ItineraryView itinerary={PLAN} stays={twoStays({}, moved)} onShowStay={vi.fn()} />);

    expect(day(3)).toHaveTextContent(`Tonight in ${CHITWAN}: check your hotel, your plan changed`);
    expect(day(3)).not.toHaveTextContent('Pokhara Inn');
    expect(within(day(3)).getByRole('button', { name: 'Check on the Stay tab' })).toBeInTheDocument();
  });

  it('shows the days as before without stay information', () => {
    render(<ItineraryView itinerary={PLAN} />);

    expect(screen.queryByText(/Tonight/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Moving on today' })).toBeNull();
  });
});
