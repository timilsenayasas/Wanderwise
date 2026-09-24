import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../context/AuthContext';
import { ToastProvider } from '../components/Toast';
import Login from '../pages/Login';

function renderLogin(authOverrides = {}) {
  const auth = { user: null, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn(), ...authOverrides };
  render(
    <MemoryRouter>
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
});
