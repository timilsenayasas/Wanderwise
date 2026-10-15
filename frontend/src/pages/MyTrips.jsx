
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function MyTrips() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [success, setSuccess] = useState('');

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

  async function handleDelete(id) {
    setDeleting(true);
    setDeleteError('');
    setSuccess('');

    try {
      await api.delete(`/trips/${id}`);

      setTrips((current) =>
        current.filter((trip) => trip.id !== id)
      );

      setDeleteId(null);
      setSuccess('Trip deleted successfully.');
    } catch (err) {
      setDeleteError(
        err.message || 'Unable to delete trip. Please try again.'
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page container">
      <header className="page-header fade-up">
        <span className="eyebrow">S5 · My Trips</span>
        <h1>My trips</h1>
        <p>All your saved trips in one place.</p>
      </header>

      {loading && <p>Loading your trips...</p>}

      {error && <p role="alert">{error}</p>}

      {success && (
        <p role="status">{success}</p>
      )}

      {deleteError && (
        <p role="alert">{deleteError}</p>
      )}

      {!loading && !error && trips.length === 0 && (
        <div className="card card--pad-lg">
          <h2>No trips yet</h2>
          <p>Start planning your first adventure!</p>

          <Link
            to="/home"
            className="btn btn--primary btn--md"
          >
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
                Budget:{' '}
                {trip.budget != null
                  ? `$${trip.budget}`
                  : 'Not specified'}
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                  marginTop: '16px',
                }}
              >
                <Link
                  to={`/trips/${trip.id}`}
                  className="btn btn--secondary btn--md"
                >
                  View trip
                </Link>

                <button
                  type="button"
                  className="btn btn--secondary btn--md"
                  disabled={deleting}
                  onClick={() => {
                    setDeleteId(trip.id);
                    setDeleteError('');
                    setSuccess('');
                  }}
                >
                  Delete trip
                </button>
              </div>

              {deleteId === trip.id && (
                <div
                  role="group"
                  aria-label="Confirm deletion"
                  style={{
                    marginTop: '20px',
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '12px',
                  }}
                >
                  <p>
                    Are you sure you want to delete your
                    trip to {trip.destination}?
                  </p>

                  <p>This action cannot be undone.</p>

                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      marginTop: '12px',
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn--primary btn--md"
                      disabled={deleting}
                      onClick={() => handleDelete(trip.id)}
                    >
                      {deleting
                        ? 'Deleting...'
                        : 'Yes, delete'}
                    </button>

                    <button
                      type="button"
                      className="btn btn--secondary btn--md"
                      disabled={deleting}
                      onClick={() => setDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
