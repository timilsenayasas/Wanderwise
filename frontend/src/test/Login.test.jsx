import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { ToastProvider } from '../components/Toast';
import Login from '../pages/Login';

function renderLogin(authOverrides = {}, routeState = null) {
  const auth = { user: null, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn(), ...authOverrides };
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: routeState }]}>
      <ToastProvider>
        <AuthContext.Provider value={auth}>
          <Login />
        </AuthContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  );
  return auth;
}

describe('Login page', () => {
  it('renders the form', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/register');
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
  });

  it('says the session expired when sent here by an expired session', () => {
    renderLogin({}, { sessionExpired: true });
    expect(screen.getByRole('status')).toHaveTextContent(/your session expired\. please log in again/i);
  });

  it('shows inline errors on empty submit and does not call login', async () => {
    const auth = renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/enter your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/email/i)).toHaveFocus();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('keeps typed values and shows the server error on bad credentials', async () => {
    const err = Object.assign(new Error('Invalid email or password'), { status: 401 });
    const auth = renderLogin({ login: vi.fn().mockRejectedValue(err) });

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect email or password/i);
    expect(screen.getByLabelText(/email/i)).toHaveValue('ada@example.com');
    expect(auth.login).toHaveBeenCalledWith('ada@example.com', 'wrong-password');
  });

  async function submitAndGetAlert(err) {
    renderLogin({ login: vi.fn().mockRejectedValue(err) });
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    return screen.findByRole('alert');
  }

  it('shows the server message when there are too many login attempts', async () => {
    const message = 'Too many login attempts. Try again in 15 minutes.';
    const alert = await submitAndGetAlert(new ApiError(message, 429, { detail: message }));
    expect(alert).toHaveTextContent(message);
  });

  it('still explains a 429 if the server sent no message', async () => {
    const alert = await submitAndGetAlert(new ApiError('Request failed. Please try again.', 429, null));
    expect(alert).toHaveTextContent(/too many login attempts/i);
  });
});
