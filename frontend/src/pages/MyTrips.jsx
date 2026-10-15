
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function MyTrips() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadTrips() {
      try {
        const data = await api.get('/trips');

        if (active) {
          setTrips(data);
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Unable to load trips.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadTrips();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page container">
      <header className="page-header fade-up">
        <span className="eyebrow">S5 · My Trips</span>
        <h1>My trips</h1>
        <p>All your saved trips in one place.</p>
      </header>

      {loading && <p>Loading your trips...</p>}

      {error && <p role="alert">{error}</p>}

      {!loading && !error && trips.length === 0 && (
        <div className="card card--pad-lg">
          <h2>No trips yet</h2>
          <p>Start planning your first adventure!</p>
          <Link to="/home" className="btn btn--primary btn--md">
            Plan a trip
          </Link>
        </div>
      )}

      {!loading && !error && trips.length > 0 && (
        <div className="trips-list">
          {trips.map((trip) => (
            <div
              key={trip.id}
              className="card card--pad-lg fade-up"
            >
              <h2>{trip.destination}</h2>

              <p>From: {trip.origin}</p>
              <p>
                Dates: {trip.start_date} to {trip.end_date}
              </p>
              <p>Travelers: {trip.travelers}</p>
              <p>
                Budget: {trip.budget != null
                  ? `$${trip.budget}`
                  : 'Not specified'}
              </p>

              <Link
                to={`/trips/${trip.id}`}
                className="btn btn--secondary btn--md"
              >
                View trip
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
