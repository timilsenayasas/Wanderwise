import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setUnauthorizedHandler } from '../api/client';
import { AuthProvider } from '../context/AuthContext';
import ProtectedRoute, { GuestRoute } from '../components/ProtectedRoute';
import { ToastProvider } from '../components/Toast';
import Login from '../pages/Login';

const ADA = { id: 1, name: 'Ada', email: 'ada@example.com' };

/** Fake backend: GET /auth/me returns `me` (or 401 if null); everything else is 401. */
function mockServer({ me }) {
  const fetch = vi.fn(async (url) => {
    const ok = url.endsWith('/auth/me') && me !== null;
    return {
      ok,
      status: ok ? 200 : 401,
      headers: { get: () => 'application/json' },
      json: async () => (ok ? me : { detail: 'Not authenticated' }),
    };
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function TripsPage() {
  return <button onClick={() => api.get('/trips').catch(() => {})}>Load trips</button>;
}

function renderApp() {
  render(
    <MemoryRouter initialEntries={['/trips']}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/trips" element={<TripsPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe('Session expiry', () => {
  it('sends the user to /login with a message when a request gets a 401', async () => {
    mockServer({ me: ADA });
    renderApp();

    await userEvent.click(await screen.findByRole('button', { name: /load trips/i }));

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/your session expired/i);
  });

  it('does not say "expired" to a visitor who was never logged in', async () => {
    mockServer({ me: null });
    renderApp();

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
  });
});

describe('api client 401 handling', () => {
  it('calls the handler for 401s outside /auth, but not for a failed login', async () => {
    mockServer({ me: null });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(api.post('/auth/login', { email: 'a@b.c', password: 'x' })).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();

    await expect(api.get('/trips')).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
