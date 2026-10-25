import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import BudgetTab from '../components/BudgetTab';
import { formatCurrency } from '../lib/format';
import { budgetResponse, emptyBudget, HOTEL, PLAN_ACTIVITIES, PLAN_FOOD, TRAIN, TRIP } from './budgetFixtures';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

function renderTab(trip = TRIP, onShowItinerary = vi.fn()) {
  render(<BudgetTab trip={trip} onShowItinerary={onShowItinerary} />);
  return onShowItinerary;
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

describe('No plan and no cost lines', () => {
  it('shows an empty state that points to generating the plan', async () => {
    api.get.mockResolvedValue(emptyBudget());
    const onShowItinerary = renderTab();

    expect(await screen.findByRole('heading', { name: 'No costs yet' })).toBeInTheDocument();
    expect(screen.getByText(/generate your day-by-day plan/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'By category' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /go to itinerary/i }));

    expect(onShowItinerary).toHaveBeenCalledTimes(1);
  });

  it('shows the breakdown once the trip has any cost line', async () => {
    await openWith(budgetResponse({ per_day: [], items: [HOTEL], total: 300, not_by_day: 300 }));

    expect(screen.queryByRole('heading', { name: 'No costs yet' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'By category' })).toBeInTheDocument();
  });
});

describe('Cost lines', () => {
  const SHOP = { id: 5, category: 'other', description: 'Museum shop', amount: 12.5, source: 'user', trip_date: '2026-11-06' };

  function lineItem(name) {
    const list = within(screen.getByRole('region', { name: 'Cost lines' }));
    return list.getByText(name).closest('li');
  }

  async function fillRequired(category = 'Food', amount = '20') {
    await userEvent.selectOptions(screen.getByLabelText('Category'), category);
    await userEvent.type(screen.getByLabelText('Amount (USD)'), amount);
  }

  it('shows plan lines as read-only and user lines with edit and delete', async () => {
    await openWith();

    const food = lineItem('Food');
    expect(food).toHaveTextContent('2 activities');
    expect(food).toHaveTextContent('From your plan');
    expect(within(food).queryByRole('button')).not.toBeInTheDocument();
    expect(within(lineItem('Activities')).queryByRole('button')).not.toBeInTheDocument();

    const hotel = lineItem('Hotel, 1 night');
    expect(hotel).toHaveTextContent('Lodging · Thu, Nov 5');
    expect(hotel).toHaveTextContent('$300');
    expect(hotel).not.toHaveTextContent('From your plan');
    expect(within(hotel).getByRole('button', { name: 'Edit Hotel, 1 night' })).toBeInTheDocument();
    expect(within(hotel).getByRole('button', { name: 'Delete Hotel, 1 night' })).toBeInTheDocument();
  });

  it('adds a line and reloads the totals', async () => {
    await openWith();
    api.post.mockResolvedValue(SHOP);
    api.get.mockResolvedValue(budgetResponse({ items: [PLAN_FOOD, PLAN_ACTIVITIES, HOTEL, TRAIN, SHOP], total: 455 }));

    await userEvent.click(screen.getByRole('button', { name: 'Add a cost' }));
    expect(screen.getByLabelText('Category')).toHaveFocus();
    await fillRequired('Other', '12.5');
    await userEvent.type(screen.getByLabelText('Description (optional)'), '  Museum shop ');
    fireEvent.change(screen.getByLabelText('Date (optional)'), { target: { value: '2026-11-06' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add cost' }));

    expect(api.post).toHaveBeenCalledWith('/trips/7/cost-items', {
      category: 'other',
      amount: 12.5,
      description: 'Museum shop',
      trip_date: '2026-11-06',
    });
    expect(await screen.findByText('Museum shop')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2); // the first load, then the reload after adding
    expect(screen.getByText('$455', { selector: '.budget-status__amount' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a cost' })).toHaveFocus();
  });

  it('sends an empty description and date as null', async () => {
    await openWith();
    api.post.mockResolvedValue(SHOP);

    await userEvent.click(screen.getByRole('button', { name: 'Add a cost' }));
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Add cost' }));

    expect(api.post).toHaveBeenCalledWith('/trips/7/cost-items', { category: 'food', amount: 20, description: null, trip_date: null });
  });

  it('checks the form before sending it', async () => {
    await openWith();

    await userEvent.click(screen.getByRole('button', { name: 'Add a cost' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add cost' }));

    expect(screen.getByText('Choose a category.')).toBeInTheDocument();
    expect(screen.getByText('Enter an amount.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Amount (USD)'), '-5');
    fireEvent.change(screen.getByLabelText('Date (optional)'), { target: { value: '2026-11-09' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add cost' }));

    expect(screen.getByText("The amount can't be negative.")).toBeInTheDocument();
    expect(screen.getByText('Pick a date within the trip.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the server's message when it rejects a line", async () => {
    await openWith();
    api.post.mockRejectedValue(new ApiError("The date must be within the trip's dates.", 422));

    await userEvent.click(screen.getByRole('button', { name: 'Add a cost' }));
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Add cost' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("The date must be within the trip's dates.");
    expect(screen.getByRole('button', { name: 'Add cost' })).toBeEnabled(); // the form stays open to fix it
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('edits a line and reloads the totals', async () => {
    await openWith();
    const cheaper = { ...HOTEL, amount: 280 };
    api.put.mockResolvedValue(cheaper);
    api.get.mockResolvedValue(budgetResponse({ items: [PLAN_FOOD, PLAN_ACTIVITIES, cheaper, TRAIN] }));

    await userEvent.click(screen.getByRole('button', { name: 'Edit Hotel, 1 night' }));
    expect(screen.getByLabelText('Category')).toHaveValue('lodging');
    expect(screen.getByLabelText('Description (optional)')).toHaveValue('Hotel, 1 night');
    expect(screen.getByLabelText('Date (optional)')).toHaveValue('2026-11-05');
    await userEvent.clear(screen.getByLabelText('Amount (USD)'));
    await userEvent.type(screen.getByLabelText('Amount (USD)'), '280');
    await userEvent.click(screen.getByRole('button', { name: 'Save cost' }));

    expect(api.put).toHaveBeenCalledWith('/trips/7/cost-items/3', {
      category: 'lodging',
      amount: 280,
      description: 'Hotel, 1 night',
      trip_date: '2026-11-05',
    });
    expect(await screen.findByText('$280')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Edit Hotel, 1 night' })).toHaveFocus();
  });

  it('cancelling an edit sends nothing', async () => {
    await openWith();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Hotel, 1 night' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Hotel, 1 night' })).toHaveFocus();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('asks before deleting a line, then deletes it and reloads the totals', async () => {
    await openWith();
    api.delete.mockResolvedValue(null);

    await userEvent.click(screen.getByRole('button', { name: 'Delete Airport train' }));
    expect(screen.getByText(/delete .airport train.\? this can't be undone/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit Airport train' })).toHaveFocus();

    api.get.mockResolvedValue(budgetResponse({ items: [PLAN_FOOD, PLAN_ACTIVITIES, HOTEL], not_by_day: 0, total: 397 }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete Airport train' }));
    await userEvent.click(within(lineItem('Airport train')).getByRole('button', { name: 'Delete' }));

    expect(api.delete).toHaveBeenCalledWith('/trips/7/cost-items/4');
    expect(await screen.findByText('$397', { selector: '.budget-status__amount' })).toBeInTheDocument();
    expect(screen.queryByText('Airport train')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('shows the message when a delete fails', async () => {
    await openWith();
    api.delete.mockRejectedValue(new ApiError('Cost line not found', 404));

    await userEvent.click(screen.getByRole('button', { name: 'Delete Airport train' }));
    await userEvent.click(within(lineItem('Airport train')).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cost line not found');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('can add a line to a trip with no plan', async () => {
    api.get.mockResolvedValue(emptyBudget());
    renderTab();

    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a cost' })).toBeInTheDocument();
  });
});
