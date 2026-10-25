import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import BudgetTab from '../components/BudgetTab';
import { budgetResponse, TRIP } from './budgetFixtures';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

function renderTab(trip = TRIP) {
  render(<BudgetTab trip={trip} />);
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
