import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import BudgetTab from '../components/BudgetTab';
import { formatCurrency } from '../lib/format';
import { budgetResponse, TRIP } from './budgetFixtures';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

function renderTab(trip = TRIP) {
  render(<BudgetTab trip={trip} />);
}

/** Load the tab with this budget response and wait for it to show. */
async function openWith(budget = budgetResponse(), trip = TRIP) {
  api.get.mockResolvedValue(budget);
  renderTab(trip);
  await screen.findByRole('heading', { name: 'Budget' });
}

/** Each category row as "Food | $65 · 15%". */
function categoryRows() {
  const section = screen.getByRole('region', { name: 'By category' });
  return within(section)
    .getAllByRole('listitem')
    .map((item) => [...item.children].map((part) => part.textContent).filter(Boolean).join(' | '));
}

/** Each per-day table row as "Day 1 · Thu, Nov 5 | $357". */
function dayRows() {
  const section = screen.getByRole('region', { name: 'By day' });
  return within(section)
    .getAllByRole('row')
    .filter((row) => !row.closest('thead'))
    .map((row) => [...row.cells].map((cell) => cell.textContent).join(' | '));
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('Budget tab loading', () => {
  it('loads the budget when opened', async () => {
    api.get.mockResolvedValue(budgetResponse());
    renderTab();

    expect(screen.getByRole('status')).toHaveTextContent(/loading your budget/i);
    expect(await screen.findByRole('heading', { name: 'Budget' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/trips/7/budget');
  });

  it('shows the error with a retry button when loading fails', async () => {
    api.get.mockRejectedValueOnce(new ApiError("Can't reach the server. Check your connection and try again.", 0));
    api.get.mockResolvedValueOnce(budgetResponse());
    renderTab();

    expect(await screen.findByRole('alert')).toHaveTextContent(/can't reach the server/i);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { name: 'Budget' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});

describe('Budget breakdown', () => {
  it('shows every category subtotal with its share of the total', async () => {
    await openWith();

    expect(categoryRows()).toEqual([
      'Food | $65 · 15%',
      'Activities | $32 · 7%',
      'Transport | $45.50 · 10%',
      'Lodging | $300 · 68%',
      'Other | $0 · 0%',
    ]);
  });

  it('shows the cost per day, lines not on a day, and the total', async () => {
    await openWith();

    expect(dayRows()).toEqual([
      'Day 1 · Thu, Nov 5 | $357',
      'Day 2 · Fri, Nov 6 | $40',
      'Not on a day | $45.50',
      'Total | $442.50',
    ]);
  });

  it('leaves out the "not on a day" row when every line is on a day', async () => {
    await openWith(budgetResponse({ not_by_day: 0, total: 397 }));

    expect(dayRows()).toEqual(['Day 1 · Thu, Nov 5 | $357', 'Day 2 · Fri, Nov 6 | $40', 'Total | $397']);
  });

  it('explains that day totals need a plan', async () => {
    await openWith(budgetResponse({ per_day: [], not_by_day: 300, total: 300 }));

    expect(screen.getByText(/day totals appear once you generate a plan/i)).toBeInTheDocument();
    expect(dayRows()).toEqual(['Not on a day | $300', 'Total | $300']);
  });
});

describe('Costs labeled as estimates', () => {
  it('labels the total as an estimate in USD', async () => {
    await openWith();

    expect(screen.getByText('Estimated total')).toBeInTheDocument();
    expect(screen.getByText('$442.50', { selector: '.budget-status__amount' })).toBeInTheDocument();
    expect(screen.getByText(/estimated costs in USD/i)).toBeInTheDocument();
  });

  it('formats amounts as US dollars, with cents only when there are some', () => {
    expect(formatCurrency(1320)).toBe('$1,320');
    expect(formatCurrency(45.5)).toBe('$45.50');
    expect(formatCurrency(0.1 + 0.2)).toBe('$0.30');
    expect(formatCurrency(0)).toBe('$0');
    expect(formatCurrency(-47)).toBe('-$47');
  });
});

describe('Compared to the budget', () => {
  it('warns when over budget, with how much over', async () => {
    await openWith(budgetResponse({ total: 1320, remaining: -120, over_budget: true }));

    expect(screen.getByRole('alert')).toHaveTextContent('Over budget by $120 (budget $1,200, estimate $1,320)');
  });

  it('shows how much is left when under budget', async () => {
    await openWith();

    expect(screen.getByRole('status')).toHaveTextContent('$757.50 left of your $1,200 budget');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats exactly on budget as not over', async () => {
    await openWith(budgetResponse({ total: 1200, remaining: 0, over_budget: false }));

    expect(screen.getByRole('status')).toHaveTextContent(/right on budget/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/over budget/i)).not.toBeInTheDocument();
  });

  it('says when the trip has no budget yet', async () => {
    await openWith(budgetResponse({ budget: null, remaining: null, over_budget: null }));

    expect(screen.getByRole('status')).toHaveTextContent(/this trip has no budget yet/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/left of your/i)).not.toBeInTheDocument();
  });
});
