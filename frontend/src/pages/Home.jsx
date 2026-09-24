/* Home dashboard for logged-in users. */
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import './Home.css';

/** Upcoming features. Flip `ready: true` (and add `to`) as each one ships. */
const UPCOMING = [
  { icon: 'sparkles', title: 'AI trip plan', text: 'A full itinerary generated from your preferences.', feature: 'F3' },
  { icon: 'wallet', title: 'Budget tracker', text: 'Every cost, tallied against your budget.', feature: 'F8' },
  { icon: 'chat', title: 'AI travel chat', text: 'Ask for changes in plain English.', feature: 'F4' },
  { icon: 'sun', title: 'Weather', text: 'Forecasts for each day of your trip.', feature: 'F9' },
  { icon: 'map', title: 'Interactive map', text: 'All your stops, pinned and connected.', feature: 'F11' },
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

  return (
    <div className="page container home">
      <header className="home__header fade-up">
        <span className="eyebrow">{greeting()}</span>
        <h1 className="home__title">
          Where to next, <span className="home__name">{firstName}</span>?
        </h1>
        <p className="text-muted">Plan a trip, see what it costs, and pack like a pro, all in one place.</p>
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
            <circle cx="160" cy="60" r="34" fill="#f29f4b" />
            <path d="M10 140 C 60 80, 110 150, 200 40" stroke="#fbf5ec" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" fill="none" />
            <g transform="translate(200 40) rotate(-50)">
              <path d="M14 0 L-6 -3 L-11 -14 L-15 -14 L-11 -3 L-16 -2 L-19 -6 L-22 -6 L-20 0 L-22 6 L-19 6 L-16 2 L-11 3 L-15 14 L-11 14 L-6 3 Z" fill="#fbf5ec" />
            </g>
            <circle cx="10" cy="140" r="6" fill="#e8683f" stroke="#fbf5ec" strokeWidth="2" />
          </svg>
        </div>
      </Card>

      <section className="home__section" aria-labelledby="trips-title">
        <div className="home__section-head">
          <h2 id="trips-title">Your trips</h2>
          <Button to="/trips" variant="ghost" size="sm">
            View all
          </Button>
        </div>
        {/* TODO(F12): replace with the user's saved trips once the trips API exists. */}
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
      </section>

      <section className="home__section" aria-labelledby="soon-title">
        <h2 id="soon-title">Coming soon</h2>
        <ul className="soon-grid">
          {UPCOMING.map((f, i) => (
            <li key={f.title} className="fade-up" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <Card className="soon-card" padding="md">
                <span className="soon-card__icon" aria-hidden="true">
                  <Icon name={f.icon} size={26} />
                </span>
                <h3 className="soon-card__title">{f.title}</h3>
                <p className="soon-card__text">{f.text}</p>
                <span className="badge">Coming soon</span>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
