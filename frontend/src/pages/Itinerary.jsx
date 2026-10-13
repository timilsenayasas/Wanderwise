/*
 * S4 Trip page: trip details plus an AI-generated day-by-day plan (F3/F5).
 * The plan isn't saved yet; storing it in trip_days/activities is Sprint 2.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import ItineraryView from '../components/ItineraryView';
import Spinner from '../components/Spinner';
import { formatBudget, formatDateRange, tripLength } from '../lib/format';
import './MyTrips.css'; // interest tags
import './Itinerary.css';

export default function Itinerary() {
  const { tripId } = useParams();
  const [trip, setTrip] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | notfound | error
  const [loadError, setLoadError] = useState('');
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setPlan(null);
    api
      .get(`/trips/${tripId}`)
      .then((data) => {
        if (cancelled) return;
        setTrip(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 404 || err.status === 422) {
          setStatus('notfound');
        } else {
          setLoadError(err.message || 'Could not load this trip.');
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // The AI planner needs a budget above 0 and at least one interest.
  const missingForPlan = [];
  if (trip && !(trip.budget > 0)) missingForPlan.push('a budget');
  if (trip && trip.interests.length === 0) missingForPlan.push('at least one interest');

  async function generatePlan() {
    setPlanning(true);
    setPlanError('');
    try {
      const result = await api.post('/trips/plan', {
        origin: trip.origin,
        destination: trip.destination,
        start_date: trip.start_date,
        end_date: trip.end_date,
        travelers: trip.travelers,
        budget: trip.budget,
        interests: trip.interests,
      });
      setPlan(result);
    } catch (err) {
      setPlanError(err.message || 'Could not generate a plan. Please try again.');
    } finally {
      setPlanning(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="page container">
        <div className="page-loading">
          <Spinner size="lg" label="Loading your trip" />
        </div>
      </div>
    );
  }

  if (status === 'notfound' || status === 'error') {
    return (
      <div className="page container">
        <Card padding="lg">
          <EmptyState
            title={status === 'notfound' ? 'Trip not found' : 'Something went wrong'}
            description={status === 'notfound' ? "This trip doesn't exist or isn't yours." : loadError}
            action={
              <Button to="/trips" variant="secondary">
                Back to my trips
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const days = tripLength(trip.start_date, trip.end_date);

  return (
    <div className="page container trip-page">
      <header className="page-header fade-up">
        <span className="eyebrow">
          {trip.origin} → {trip.destination}
        </span>
        <h1>Your trip to {trip.destination}</h1>
        <dl className="trip-page__facts">
          <div>
            <dt>Dates</dt>
            <dd>{formatDateRange(trip.start_date, trip.end_date)}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>
              {days} {days === 1 ? 'day' : 'days'}
            </dd>
          </div>
          <div>
            <dt>Travelers</dt>
            <dd>{trip.travelers}</dd>
          </div>
          <div>
            <dt>Budget</dt>
            <dd>{formatBudget(trip.budget)}</dd>
          </div>
        </dl>
        {trip.interests.length > 0 && (
          <ul className="trip-card__tags trip-page__tags" aria-label="Interests">
            {trip.interests.map((interest) => (
              <li key={interest}>{interest}</li>
            ))}
          </ul>
        )}
      </header>

      {!plan && (
        <Card as="section" padding="lg" className="trip-page__plan-cta" aria-labelledby="plan-cta-title">
          <h2 id="plan-cta-title">Day-by-day plan</h2>
          {missingForPlan.length > 0 ? (
            <p className="text-muted">
              Add {missingForPlan.join(' and ')} to this trip to generate an AI itinerary.
            </p>
          ) : (
            <>
              <p className="text-muted">
                Let AI draft a day-by-day itinerary with times, costs and travel between stops.
              </p>
              {planError && (
                <p className="trip-page__alert" role="alert">
                  {planError}
                </p>
              )}
              <div className="trip-page__actions">
                <Button variant="accent" size="lg" onClick={generatePlan} loading={planning} loadingText="Planning your trip…">
                  Generate AI itinerary
                </Button>
                {planning && <span className="text-muted">This usually takes 5 to 20 seconds.</span>}
              </div>
            </>
          )}
        </Card>
      )}

      {plan && <ItineraryView itinerary={plan} />}
    </div>
  );
}
