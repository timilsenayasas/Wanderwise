
/* S5 My Trips (F12): the user's saved trips, newest first. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import Skeleton from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { formatBudget, formatDateRange, tripLength } from '../lib/format';
import './MyTrips.css';

/**
 * One saved trip. The whole card opens the trip; Open/Delete sit above that link.
 * `maxTags` trims long interest lists (Home shows 3 plus "+N more").
 */
export function TripCard({ trip, onDelete, deleting, maxTags }) {
  const [confirming, setConfirming] = useState(false);
  const days = tripLength(trip.start_date, trip.end_date);
  const tags = maxTags ? trip.interests.slice(0, maxTags) : trip.interests;
  const hiddenTags = trip.interests.length - tags.length;

  return (
    <Card as="article" padding="md" interactive className="trip-card">
      <p className="trip-card__from">From {trip.origin}</p>

      <h3 className="trip-card__title">
        <Link to={`/trips/${trip.id}`} className="trip-card__link">
          {trip.destination}
        </Link>
      </h3>

      <ul className="trip-card__facts">
        <li>
          <Icon name="calendar" size={18} />
          <span className="visually-hidden">Dates: </span>
          {formatDateRange(trip.start_date, trip.end_date)} · {days}{' '}
          {days === 1 ? 'day' : 'days'}
        </li>

        <li>
          <Icon name="wallet" size={18} />
          <span className="visually-hidden">Budget: </span>
          {formatBudget(trip.budget)} · {trip.travelers}{' '}
          {trip.travelers === 1 ? 'traveler' : 'travelers'}
        </li>
      </ul>

      {tags.length > 0 && (
        <ul className="trip-card__tags" aria-label="Interests">
          {tags.map((interest) => (
            <li key={interest}>{interest}</li>
          ))}

          {hiddenTags > 0 && (
            <li className="trip-card__more">+{hiddenTags} more</li>
          )}
        </ul>
      )}

      {onDelete && (
        <div className="trip-card__actions">
          {confirming ? (
            <>
              <span className="trip-card__confirm">
                Delete this trip?
              </span>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Cancel
              </Button>

              <Button
                size="sm"
                variant="accent"
                onClick={() => onDelete(trip)}
                loading={deleting}
                loadingText="Deleting…"
              >
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                to={`/trips/${trip.id}`}
              >
                Open
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(true)}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * B2: Skeleton placeholder for a saved trip card.
 * Displays while trip data is being fetched.
 */
function TripCardSkeleton() {
  return (
    <Card
      as="article"
      padding="md"
      className="trip-card"
      aria-hidden="true"
    >
      <Skeleton width="45%" height="14px" />
      <Skeleton width="70%" height="26px" />
      <Skeleton width="85%" height="16px" />
      <Skeleton width="65%" height="16px" />
      <Skeleton width="55%" height="24px" rounded />
      <Skeleton width="40%" height="34px" rounded />
    </Card>
  );
}

export default function MyTrips() {
  const toast = useToast();

  const [trips, setTrips] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  async function loadTrips() {
    setStatus('loading');

    try {
      setTrips(await api.get('/trips'));
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Could not load your trips.');
      setStatus('error');
    }
  }

  useEffect(() => {
    loadTrips();
  }, []);

  async function handleDelete(trip) {
    setDeletingId(trip.id);

    try {
      await api.delete(`/trips/${trip.id}`);

      setTrips((current) =>
        current.filter((t) => t.id !== trip.id)
      );

      toast.success(`Deleted your trip to ${trip.destination}.`);
    } catch (err) {
      toast.error(err.message || 'Could not delete the trip.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="page container my-trips">
      <header className="page-header my-trips__header fade-up">
        <div>
          <span className="eyebrow">S5 · My trips</span>
          <h1>My trips</h1>
          <p>All your saved trips in one place.</p>
        </div>

        {status === 'ready' && trips.length > 0 && (
          <Button to="/trips/new" variant="accent">
            Plan a new trip
          </Button>
        )}
      </header>

      {/* B2: Skeleton loading cards */}
      {status === 'loading' && (
        <div role="status" aria-label="Loading your trips">
          <span className="visually-hidden">
            Loading your trips...
          </span>

          <ul className="my-trips__grid">
            {[1, 2, 3].map((item) => (
              <li key={item}>
                <TripCardSkeleton />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <Card padding="lg">
          <p className="my-trips__alert" role="alert">
            {error}
          </p>

          <Button variant="secondary" onClick={loadTrips}>
            Try again
          </Button>
        </Card>
      )}

      {/* Empty state */}
      {status === 'ready' && trips.length === 0 && (
        <Card padding="lg">
          <EmptyState
            title="No saved trips yet"
            description="Plan your first trip and it will show up here."
            action={
              <Button to="/trips/new" variant="accent">
                Plan your first trip
              </Button>
            }
          />
        </Card>
      )}

      {/* Saved trips */}
      {status === 'ready' && trips.length > 0 && (
        <ul className="my-trips__grid">
          {trips.map((trip) => (
            <li key={trip.id}>
              <TripCard
                trip={trip}
                onDelete={handleDelete}
                deleting={deletingId === trip.id}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
