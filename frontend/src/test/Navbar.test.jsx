import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navbar from '../components/Navbar';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    logout: vi.fn(),
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

function renderNavbar() {
  return render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>
  );
}

describe('Navbar dark and light mode', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('switches between dark and light mode and saves the choice', () => {
    localStorage.setItem('theme', 'light');

    renderNavbar();

    // Starts in light mode
    expect(document.documentElement).toHaveAttribute(
      'data-theme',
      'light'
    );

    // Switch to dark mode
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to dark mode' })
    );

    expect(document.documentElement).toHaveAttribute(
      'data-theme',
      'dark'
    );

    expect(localStorage.getItem('theme')).toBe('dark');

    // Switch back to light mode
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to light mode' })
    );

    expect(document.documentElement).toHaveAttribute(
      'data-theme',
      'light'
    );

    expect(localStorage.getItem('theme')).toBe('light');
  });
});