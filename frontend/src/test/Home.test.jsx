import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import Home from '../pages/Home';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn() } };
});

const USER = { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' };

const TRIP = {
  id: 7,
  origin: 'Dallas, TX',
  destination: 'New York, NY',
  start_date: '2026-11-05',
  end_date: '2026-11-08',
  travelers: 2,
  budget: 1500,
  interests: ['food', 'museums'],
  created_at: '2026-10-13T16:00:00',
};

function renderHome() {
  render(
    <AuthContext.Provider value={{ user: USER, loading: false, login() {}, register() {}, logout() {} }}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function actionLinks() {
  const section = screen.getByRole('region', { name: 'What you can do' });
  return {
    plan: within(section).getByRole('link', { name: /plan a trip/i }),
    budget: within(section).getByRole('link', { name: /see your budget/i }),
    map: within(section).getByRole('link', { name: /see it on a map/i }),
  };
}

beforeEach(() => {
  api.get.mockReset();
});

describe('Home', () => {
  it('opens the newest trip’s budget and map tabs', async () => {
    api.get.mockResolvedValue([TRIP, { ...TRIP, id: 3, destination: 'Austin, TX' }]);
    renderHome();

    expect(await screen.findByRole('heading', { name: 'New York, NY' })).toBeInTheDocument();
    const links = actionLinks();
    expect(links.plan).toHaveAttribute('href', '/trips/new');
    expect(links.budget).toHaveAttribute('href', '/trips/7?tab=budget');
    expect(links.map).toHaveAttribute('href', '/trips/7?tab=map');
  });

  it('sends budget and map to My Trips when there are no trips', async () => {
    api.get.mockResolvedValue([]);
    renderHome();

    expect(await screen.findByText(/no saved trips yet/i)).toBeInTheDocument();
    const links = actionLinks();
    expect(links.plan).toHaveAttribute('href', '/trips/new');
    expect(links.budget).toHaveAttribute('href', '/trips');
    expect(links.map).toHaveAttribute('href', '/trips');
  });

  it('shows trip dates and budget, and caps interest tags at three', async () => {
    api.get.mockResolvedValue([{ ...TRIP, interests: ['food', 'museums', 'parks', 'music', 'shopping'] }]);
    renderHome();

    expect(await screen.findByRole('link', { name: 'New York, NY' })).toHaveAttribute('href', '/trips/7');
    expect(screen.getByText(/4 days/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,500 · 2 travelers/)).toBeInTheDocument();
    const tags = within(screen.getByRole('list', { name: 'Interests' })).getAllByRole('listitem');
    expect(tags.map((tag) => tag.textContent)).toEqual(['food', 'museums', 'parks', '+2 more']);
  });

  it('lists only unbuilt features under Coming soon', async () => {
    api.get.mockResolvedValue([]);
    renderHome();

    const soon = screen.getByRole('region', { name: 'Coming soon' });
    expect(within(soon).getByRole('heading', { name: 'AI travel chat' })).toBeInTheDocument();
    expect(within(soon).getByRole('heading', { name: 'Weather' })).toBeInTheDocument();
    expect(within(soon).queryByText(/budget/i)).not.toBeInTheDocument();
    expect(within(soon).queryByText(/map/i)).not.toBeInTheDocument();
    expect(within(soon).queryAllByRole('link')).toHaveLength(0);
    await screen.findByText(/no saved trips yet/i); // let the trips request settle
  });
});
