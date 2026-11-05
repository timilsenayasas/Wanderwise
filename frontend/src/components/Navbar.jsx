import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import Button from './Button';
import Logo from './Logo';
import './Navbar.css';

/** Links shown to logged-in users. Add new top-level pages here. */
const APP_LINKS = [
  { to: '/home', label: 'Home' },
  { to: '/trips/new', label: 'New Trip' },
  { to: '/trips', label: 'My Trips', end: true },
  { to: '/profile', label: 'Profile' },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);

  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');

    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const toggleRef = useRef(null);

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [location.pathname]);

  // Apply and remember the selected theme.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Escape closes the menu and returns focus to the hamburger button.
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function handleLogout() {
    try {
      await logout();
      toast.info('You have been logged out. Safe travels!');
    } catch {
      toast.error(
        'Could not reach the server, but you have been logged out on this device.'
      );
    }

    navigate('/');
  }

  function handleThemeToggle() {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  }

  return (
    <header className="navbar">
      <nav className="navbar__inner container" aria-label="Main">
        <Link
          to={user ? '/home' : '/'}
          className="navbar__brand"
          aria-label="WanderWise home"
        >
          <Logo />
        </Link>

        <button
          type="button"
          className="navbar__theme-toggle"
          onClick={handleThemeToggle}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          <span aria-hidden="true">
            {theme === 'light' ? '🌙' : '☀️'}
          </span>
        </button>

        <button
          ref={toggleRef}
          type="button"
          className={`navbar__toggle ${open ? 'is-open' : ''}`}
          aria-expanded={open}
          aria-controls="primary-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="visually-hidden">
            {open ? 'Close menu' : 'Open menu'}
          </span>

          <span className="navbar__burger" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>

        <div
          id="primary-menu"
          className={`navbar__menu ${open ? 'is-open' : ''}`}
        >
          {user ? (
            <>
              <ul className="navbar__links">
                {APP_LINKS.map((link) => (
                  <li key={link.to}>
                    <NavLink
                      to={link.to}
                      end={link.end}
                      className="navbar__link"
                    >
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>

              <div className="navbar__actions">
                <span className="navbar__user" title={user.email}>
                  <span className="navbar__avatar" aria-hidden="true">
                    {user.name?.[0]?.toUpperCase() || '?'}
                  </span>

                  <span className="navbar__username">{user.name}</span>
                </span>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleLogout}
                >
                  Log out
                </Button>
              </div>
            </>
          ) : (
            <div className="navbar__actions">
              <Button variant="ghost" size="sm" to="/login">
                Log in
              </Button>

              <Button variant="accent" size="sm" to="/register">
                Sign up free
              </Button>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}