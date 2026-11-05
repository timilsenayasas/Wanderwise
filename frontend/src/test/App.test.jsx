import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import App from '../App';
import { ToastProvider } from '../components/Toast';
import { AuthContext } from '../context/AuthContext';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const USER = { id: 1, name: 'Ada', email: 'ada@example.com' };

function renderAt(path) {
  render(
    <AuthContext.Provider value={{ user: USER, loading: false, login() {}, register() {}, logout() {} }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom doesn't implement it; the layout scrolls up on navigation
  api.get.mockReset();
  api.get.mockResolvedValue([]); // Home's recent trips
});

describe('One planning flow', () => {
  it('sends the old /plan link to New Trip', async () => {
    renderAt('/plan');

    expect(await screen.findByRole('heading', { name: 'New Trip' })).toBeInTheDocument();
  });

  it('has no separate AI Plan page in the navbar or on Home', async () => {
    renderAt('/home');

    expect(await screen.findByRole('heading', { name: /where to next/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AI Plan' })).not.toBeInTheDocument();
    expect(screen.queryByText('AI trip plan')).not.toBeInTheDocument();
  });
});
