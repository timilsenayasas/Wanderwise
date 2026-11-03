/*
 * S4 Itinerary, with "Day by day" and "Budget" tabs.
 * TODO(owner): F5 day-by-day itinerary, F6 activities, F7 transport, F8 budget,
 * F9 weather, F10 packing tips, F11 map, F4 AI chat. The trip id is in the URL.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import { useToast } from '../components/Toast';

export default function Itinerary() {
  const { tripId } = useParams();
  const toast = useToast();

  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadTrip() {
      setLoading(true);
      setError('');

      try {
        const data = await api.get(`/trips/${tripId}`);
        setTrip(data);
      } catch (err) {
        setError(err.message || 'Unable to load this trip.');
      } finally {
        setLoading(false);
      }
    }

    loadTrip();
  }, [tripId]);

  if (loading) {
    return <main className="page container"><p>Loading trip...</p></main>;
  }

  if (error) {
    return (
      <main className="page container">
        <p role="alert">{error}</p>
        <Button onClick={() => window.location.reload()}>
          Try again
        </Button>
      </main>
    );
  }

  if (!trip) return null;

  return (
    <main className="page container">
      <section className="page__header">
        <p className="eyebrow">Your adventure</p>
        <h1>{trip.origin} → {trip.destination}</h1>
        <p>
          {trip.start_date} – {trip.end_date}
        </p>
      </section>

      <Card>
        <h2>Trip details</h2>

        <p><strong>Origin:</strong> {trip.origin}</p>
        <p><strong>Destination:</strong> {trip.destination}</p>
        <p><strong>Travelers:</strong> {trip.travelers}</p>
        <p>
          <strong>Budget:</strong>{' '}
          {trip.budget == null ? 'Not specified' : `$${trip.budget}`}
        </p>
        <p>
          <strong>Interests:</strong>{' '}
          {trip.interests?.join(', ') || 'None specified'}
        </p>

        <Button to={`/trips/${tripId}/edit`}>
          Edit Trip
        </Button>
      </Card>
    </main>
  );
}