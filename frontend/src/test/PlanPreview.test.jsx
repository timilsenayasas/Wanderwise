import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import PlanPreview, { validatePlan } from '../pages/PlanPreview';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { post: vi.fn() } };
});

const PLAN = {
  destination: 'Chicago, IL',
  currency: 'USD',
  total_estimated_cost: 950,
  days: [
    {
      date: '2026-11-05',
      activities: [
        {
          start_time: '09:00',
          duration_minutes: 120,
          name: 'Art Institute of Chicago',
          category: 'sightseeing',
          location: '111 S Michigan Ave',
          description: 'World-class art museum.',
          estimated_cost: 32,
          travel_time_to_next_minutes: 15,
        },
        {
          start_time: '12:00',
          duration_minutes: 60,
          name: 'Deep-dish lunch',
          category: 'meal',
          location: "Lou Malnati's",
          description: 'Classic Chicago pizza.',
          estimated_cost: 25,
          travel_time_to_next_minutes: 0,
        },
      ],
    },
  ],
};

function renderPage() {
  render(
    <MemoryRouter>
      <PlanPreview />
    </MemoryRouter>,
  );
}

async function fillForm() {
  await userEvent.click(screen.getByRole('button', { name: /fill example trip/i }));
}

beforeEach(() => {
  api.post.mockReset();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('PlanPreview', () => {
  it('shows inline errors and does not call the API when the form is empty', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /generate itinerary/i }));

    expect(await screen.findByText(/enter where you are going/i)).toBeInTheDocument();
    expect(screen.getByText(/add at least one interest/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends the trip and renders the generated itinerary', async () => {
    api.post.mockResolvedValue(PLAN);
    renderPage();
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /generate itinerary/i }));

    expect(await screen.findByRole('heading', { name: 'Chicago, IL' })).toBeInTheDocument();
    expect(screen.getByText('Art Institute of Chicago')).toBeInTheDocument();
    expect(screen.getByText(/15 min to next stop/i)).toBeInTheDocument();

    const [path, body] = api.post.mock.calls[0];
    expect(path).toBe('/trips/plan');
    expect(body).toMatchObject({ destination: 'Chicago, IL', travelers: 2, budget: 1200 });
    expect(body.interests).toEqual(['food', 'museums', 'architecture']);
  });

  it('shows the server message when planning fails', async () => {
    api.post.mockRejectedValue(new ApiError("AI planning isn't configured.", 503));
    renderPage();
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /generate itinerary/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ai planning isn't configured/i);
  });
});

describe('validatePlan', () => {
  it('rejects an end date before the start date', () => {
    const errors = validatePlan({
      origin: 'A', destination: 'B', start_date: '2026-11-05', end_date: '2026-11-01',
      travelers: '1', budget: '100', interests: 'food',
    });
    expect(errors.end_date).toMatch(/on or after/i);
  });
});
