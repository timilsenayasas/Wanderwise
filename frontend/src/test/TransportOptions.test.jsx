import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import TransportOptions from '../components/TransportOptions';
import GettingThere from '../components/GettingThere';

vi.mock('../api/client', () => ({
  api: { get: vi.fn() },
}));

const ORIGIN = {
  latitude: 33.0,
  longitude: -97.0,
};

const DESTINATION = {
  latitude: 33.1,
  longitude: -97.1,
};

const TRIP = {
  id: 7,
  origin: 'Dallas, TX',
  destination: 'Austin, TX',
};

const DRIVE = {
  mode: 'DRIVE',
  duration_minutes: 15,
  distance_km: 8,
  estimated_cost_usd: 0.60,
};

const WALK = {
  mode: 'WALK',
  duration_minutes: 100,
  distance_km: 8,
  estimated_cost_usd: 0,
};

const TRANSIT = {
  mode: 'TRANSIT',
  duration_minutes: 30,
  distance_km: 8,
  estimated_cost_usd: 2.50,
  transit_fare: 2.50,
  transit_currency: 'USD',
};

const NO_TRANSIT = {
  mode: 'TRANSIT',
  available: false,
  message: 'No public transit route available.',
};

beforeEach(() => {
  vi.resetAllMocks();
});

function renderTransport() {
  return render(
    <TransportOptions
      tripId={7}
      origin={ORIGIN}
      destination={DESTINATION}
    />,
  );
}

describe('A22: Compare transport options', () => {
  it('displays driving, walking and public transit', async () => {
    api.get.mockResolvedValue({
      options: [DRIVE, WALK, TRANSIT],
    });

    renderTransport();

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Compare transport options',
      }),
    );

    expect(await screen.findByText('Driving')).toBeInTheDocument();
    expect(screen.getByText('Walking')).toBeInTheDocument();
    expect(screen.getByText('Public transit (bus/train)')).toBeInTheDocument();
    expect(screen.getByText(/USD 2.50 estimated/)).toBeInTheDocument();

    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/trips/7/transport?'),
    );
  });

  it('handles missing transit fares', async () => {
    api.get.mockResolvedValue({
      options: [{
        ...TRANSIT,
        estimated_cost_usd: null,
        transit_fare: null,
        transit_currency: null,
      }],
    });

    renderTransport();

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Compare transport options',
      }),
    );

    expect(await screen.findByText(/Fare unavailable/))
      .toBeInTheDocument();
  });

  it('displays a message when no transit route exists', async () => {
    api.get.mockResolvedValue({
      options: [DRIVE, WALK, NO_TRANSIT],
    });

    renderTransport();

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Compare transport options',
      }),
    );

    expect(await screen.findByText('No public transit route available.'))
      .toBeInTheDocument();
    expect(screen.getByText('Driving')).toBeInTheDocument();
  });
});

describe('A22: Getting there', () => {
  it('displays the starting city and destination', () => {
    render(<GettingThere trip={TRIP} />);

    expect(screen.getByRole('heading', { name: 'Getting there' }))
      .toBeInTheDocument();
    expect(screen.getByText('Dallas, TX → Austin, TX'))
      .toBeInTheDocument();

    expect(api.get).not.toHaveBeenCalled();
  });

  it('displays driving and public transit results', async () => {
    api.get.mockResolvedValue({
      options: [DRIVE, TRANSIT],
    });

    render(<GettingThere trip={TRIP} />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Check travel options',
      }),
    );

    expect(await screen.findByText('Driving')).toBeInTheDocument();
    expect(screen.getByText('Public transit (bus/train)')).toBeInTheDocument();
    expect(screen.getByText(/About 15 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/USD 2.50 estimated/)).toBeInTheDocument();

    expect(api.get).toHaveBeenCalledWith('/trips/7/getting-there');
  });

  it('preserves driving results when transit is unavailable', async () => {
    api.get.mockResolvedValue({
      options: [DRIVE, NO_TRANSIT],
    });

    render(<GettingThere trip={TRIP} />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Check travel options',
      }),
    );

    expect(await screen.findByText('No public transit route available.'))
      .toBeInTheDocument();
    expect(screen.getByText('Driving')).toBeInTheDocument();
  });

  it('handles failed city lookups', async () => {
    api.get.mockResolvedValue({
      options: [],
      message: 'Could not locate the starting city or destination.',
    });

    render(<GettingThere trip={TRIP} />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Check travel options',
      }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not locate the starting city or destination.',
    );
  });

  it('handles API failures gracefully', async () => {
    api.get.mockRejectedValue(new Error('Network failure'));

    render(<GettingThere trip={TRIP} />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Check travel options',
      }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Transportation estimates are unavailable right now.',
    );
  });
});
