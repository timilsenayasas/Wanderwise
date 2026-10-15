
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';

export default function Itinerary() {
  const { tripId } = useParams();

  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadTrip() {
      setLoading(true);
      setError('');

      try {
        const data = await api.get(`/trips/${tripId}`);
        if (active) setTrip(data);
      } catch (err) {
        if (active) {
          setError(err.message || 'Unable to load trip.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadTrip();

    return () => {
      active = false;
    };
  }, [tripId]);

  return (
    <main className="page container">
      <header className="page-header fade-up">
        <span className="eyebrow">S4 · Itinerary</span>

        <Link to="/trips" className="btn btn--secondary btn--md">
          ← Back to My Trips
        </Link>

        {loading && <p>Loading your trip...</p>}

        {error && <p role="alert">{error}</p>}

        {!loading && !error && trip && (
          <>
            <h1>{trip.destination}</h1>
            <p>From {trip.origin}</p>

            <div className="card card--pad-lg">
              <p>
                <strong>Travel dates:</strong>{' '}
                {trip.start_date} to {trip.end_date}
              </p>

              <p>
                <strong>Travelers:</strong> {trip.travelers}
              </p>

              <p>
                <strong>Budget:</strong>{' '}
                {trip.budget != null
                  ? `$${trip.budget}`
                  : 'Not specified'}
              </p>
            </div>
          </>
        )}
      </header>

      {!loading && !error && trip && (
        <section className="card card--pad-lg">
          <h2>Day-by-day itinerary</h2>
          <p>
            Detailed activities and budget breakdown will appear
            here when those features are implemented.
          </p>
        </section>
      )}
    </main>
  );
}
