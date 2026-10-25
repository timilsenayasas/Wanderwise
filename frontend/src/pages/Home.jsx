/* Home dashboard for logged-in users. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import { TripCard } from './MyTrips';
import './MyTrips.css';
import './Home.css';

/**
 * Built features. Budget and map open that tab on the newest trip, or My Trips
 * when there isn't one yet (or trips are still loading).
 */
function actions(latestTrip) {
  const tripTab = (tab) => (latestTrip ? `/trips/${latestTrip.id}?tab=${tab}` : '/trips');
  return [
    { icon: 'plane', title: 'Plan a trip', text: 'Pick a place, dates and budget.', to: '/trips/new' },
    { icon: 'wallet', title: 'See your budget', text: 'Every cost, tallied against your budget.', to: tripTab('budget') },
    { icon: 'map', title: 'See it on a map', text: 'Every stop, pinned in order.', to: tripTab('map') },
  ];
}

/** Features still being built. Move one into actions() when it ships. */
const UPCOMING = [
  { icon: 'chat', title: 'AI travel chat', text: 'Ask for changes in plain English.' },
  { icon: 'sun', title: 'Weather', text: 'Forecasts for each day of your trip.' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] || 'traveler';
  const [recentTrips, setRecentTrips] = useState(null); // null = still loading

  useEffect(() => {
    let cancelled = false;
    api
      .get('/trips')
      .then((trips) => !cancelled && setRecentTrips(trips.slice(0, 3)))
      .catch(() => !cancelled && setRecentTrips([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page container home">
      <header className="home__header fade-up">
        <span className="eyebrow">{greeting()}</span>
        <h1 className="home__title">
          Where to next, <span className="home__name">{firstName}</span>?
        </h1>
        <p className="home__lede">Plan a trip, see what it costs, and pack like a pro, all in one place.</p>
      </header>

      <Card as="section" tone="navy" padding="lg" className="plan-card fade-up" aria-labelledby="plan-title">
        <div className="plan-card__body">
          <h2 id="plan-title" className="plan-card__title">
            Plan a new trip
          </h2>
          <p className="plan-card__text">
            Tell us where, when, who&apos;s coming and your budget. We&apos;ll build a day-by-day itinerary around your
            interests.
          </p>
          <Button to="/trips/new" variant="accent" size="lg">
            Start planning
            <Icon name="arrowRight" size={20} />
          </Button>
        </div>
        <div className="plan-card__art" aria-hidden="true">
          <svg viewBox="0 0 220 160">
            <circle className="plan-card__sun" cx="160" cy="60" r="34" />
            <path className="plan-card__route" d="M10 140 C 60 80, 110 150, 200 40" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" fill="none" />
            <g transform="translate(200 40) rotate(-50)">
              <path className="plan-card__plane" d="M14 0 L-6 -3 L-11 -14 L-15 -14 L-11 -3 L-16 -2 L-19 -6 L-22 -6 L-20 0 L-22 6 L-19 6 L-16 2 L-11 3 L-15 14 L-11 14 L-6 3 Z" />
            </g>
            <circle className="plan-card__start" cx="10" cy="140" r="6" strokeWidth="2" />
          </svg>
        </div>
      </Card>

      <section className="home__section" aria-labelledby="trips-title">
        <div className="home__section-head">
          <h2 id="trips-title">Your trips</h2>
          <Button to="/trips" variant="ghost">
            View all
          </Button>
        </div>
        {recentTrips && recentTrips.length > 0 && (
          <ul className="my-trips__grid">
            {recentTrips.map((trip) => (
              <li key={trip.id}>
                <TripCard trip={trip} />
              </li>
            ))}
          </ul>
        )}
        {recentTrips && recentTrips.length === 0 && (
          <Card padding="sm">
            <EmptyState
              headingLevel={3}
              title="No saved trips yet"
              description="Your adventures will live here. Plan your first trip and save it to see it on your dashboard."
              action={
                <Button to="/trips/new" variant="secondary">
                  Plan your first trip
                </Button>
              }
            />
          </Card>
        )}
      </section>

      <section className="home__section" aria-labelledby="actions-title">
        <div className="home__section-head">
          <h2 id="actions-title">What you can do</h2>
        </div>
        <ul className="action-grid">
          {actions(recentTrips?.[0]).map((a, i) => (
            <li key={a.title} className="fade-up" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <Card as={Link} to={a.to} padding="sm" interactive className="action-card">
                <span className="action-card__icon" aria-hidden="true">
                  <Icon name={a.icon} size={22} />
                </span>
                <div>
                  <h3 className="action-card__title">{a.title}</h3>
                  <p className="action-card__text">{a.text}</p>
                </div>
                <Icon name="arrowRight" size={20} className="action-card__arrow" />
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="home__section" aria-labelledby="soon-title">
        <div className="home__section-head">
          <h2 id="soon-title">Coming soon</h2>
        </div>
        <ul className="soon-grid">
          {UPCOMING.map((f) => (
            <li key={f.title}>
              <Card tone="sand" padding="sm" className="soon-card">
                <span className="soon-card__icon" aria-hidden="true">
                  <Icon name={f.icon} size={22} />
                </span>
                <div>
                  <h3 className="soon-card__title">{f.title}</h3>
                  <p className="soon-card__text">{f.text}</p>
                  <span className="badge">Coming soon</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
