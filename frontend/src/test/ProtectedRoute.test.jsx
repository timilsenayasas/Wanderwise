import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../context/AuthContext';
import ProtectedRoute from '../components/ProtectedRoute';

function renderAt(path, auth) {
  render(
    <AuthContext.Provider value={{ login() {}, register() {}, logout() {}, ...auth }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<h1>Login page</h1>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/trips" element={<h1>My trips page</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects to /login when logged out', () => {
    renderAt('/trips', { user: null, loading: false });
    expect(screen.getByRole('heading', { name: 'Login page' })).toBeInTheDocument();
    expect(screen.queryByText('My trips page')).not.toBeInTheDocument();
  });

  it('renders the page when logged in', () => {
    renderAt('/trips', { user: { id: 1, name: 'Ada', email: 'ada@example.com' }, loading: false });
    expect(screen.getByRole('heading', { name: 'My trips page' })).toBeInTheDocument();
  });

  it('shows a spinner while the session is loading', () => {
    renderAt('/trips', { user: null, loading: true });
    expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i);
  });
});
