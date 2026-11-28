/*
 * S4 Trip page: trip details plus its saved day-by-day plan (F3/F5, A1).
 * POST /trips/{id}/plan generates and saves the plan; GET loads it with the trip.
 * Arriving from New Trip (location state `generate`) starts generating right away.
 * Itinerary, Budget (A3), Stay (where to stay) and Map (A12) are tabs; ?tab=budget, ?tab=stay or
 * ?tab=map keeps a tab open on refresh.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import BudgetTab from '../components/BudgetTab';
import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import ErrorBoundary from '../components/ErrorBoundary';
import ItineraryView from '../components/ItineraryView';
import Skeleton from '../components/Skeleton';
import Spinner from '../components/Spinner';
import Tabs, { TabPanel, tabId } from '../components/Tabs';
import { formatBudget, formatDateRange, tripLength } from '../lib/format';
import './MyTrips.css'; // interest tags
import './Itinerary.css';
import WeatherTab from '../components/WeatherTab';

// The map and hotel code is only downloaded when someone opens its tab.
const TripMap = lazy(() => import('../components/TripMap'));
const WhereToStay = lazy(() => import('../components/WhereToStay'));

const TRIP_TABS = [
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'budget', label: 'Budget' },
  { id: 'stay', label: 'Stay' },
  { id: 'map', label: 'Map' },
  { id: 'weather', label: 'Weather' },
];

export default function Itinerary() {
  const { tripId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = searchParams.get('tab');
  const tab = TRIP_TABS.some(({ id }) => id === requestedTab)
    ? requestedTab
    : 'itinerary';

  const [trip, setTrip] = useState(null);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [alternative, setAlternative] = useState(null);
  const [alternativeBusy, setAlternativeBusy] = useState(false);
  const [alternativeError, setAlternativeError] = useState('');
  const [comparisonView, setComparisonView] = useState('original');
  // Stay searches Google (billed), so it mounts on first open and then stays, hidden, until the page closes.
  const [stayOpened, setStayOpened] = useState(tab === 'stay');
  if (tab === 'stay' && !stayOpened) setStayOpened(true);
  const autoGenerate = useRef(Boolean(location.state?.generate));
  const regenerateRef = useRef(null);
  // Where the traveler sleeps each night (GET /lodging: no Google calls), for the day cards.
  const [lodging, setLodging] = useState(null);
  // The Budget tab's total and its parts, for the summary (undefined: loading; null: failed).
  const [budget, setBudget] = useState(undefined);
  // Bumped when a night is switched here, so the Stay tab (if open) reloads its stays.
  const [nightsVersion, setNightsVersion] = useState(0);
  // Google's hotel names (place_id -> name) for this page visit only: in memory, never in
  // localStorage or sessionStorage (Google's terms), gone on reload. The Stay tab fills it for free.
  const hotelNames = useRef(new Map());
  const pendingNames = useRef(new Set());
  const [, setNamesVersion] = useState(0);
  const rememberHotelNames = useCallback((hotels) => {
    let added = false;
    for (const { place_id: placeId, name } of hotels) {
      if (placeId && name && hotelNames.current.get(placeId) !== name) {
        hotelNames.current.set(placeId, name);
        added = true;
      }
    }
    if (added) setNamesVersion((version) => version + 1);
  }, []);

  const showingPlan = status === 'ready' && tab === 'itinerary' && Boolean(plan);
  useEffect(() => {
    if (!showingPlan) return undefined;
    let cancelled = false;
    api
      .get(`/trips/${tripId}/lodging`)
      .then((overview) => {
        if (!cancelled) setLodging(overview);
      })
      .catch(() => {
        if (!cancelled) setLodging(null);
      });
    api
      .get(`/trips/${tripId}/budget`)
      .then((data) => {
        if (!cancelled) setBudget(data);
      })
      .catch(() => {
        if (!cancelled) setBudget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showingPlan, plan, tripId]);

  useEffect(() => {
    if (!showingPlan || !lodging) return undefined;
    const missing = lodging.stays
      .filter((stay) => stay.choice?.choice === 'hotel' && !stay.plan_changed && stay.choice.place_id)
      .filter(({ choice }) => !hotelNames.current.has(choice.place_id) && !pendingNames.current.has(choice.place_id));
    if (missing.length === 0) return undefined;

    let cancelled = false;
    const placeIds = missing.map(({ choice }) => choice.place_id);
    placeIds.forEach((placeId) => pendingNames.current.add(placeId));
    const release = () => placeIds.forEach((placeId) => pendingNames.current.delete(placeId));
    const query = missing.map((stay) => `stays=${stay.number}`).join('&');
    api
      .get(`/trips/${tripId}/lodging/names?${query}`)
      .then((names) => {
        if (!cancelled) rememberHotelNames(names);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) release();
      });
    return () => {
      cancelled = true;
      release();
    };
  }, [showingPlan, lodging, tripId, rememberHotelNames]);

  async function setNight(date, inTransit) {
    const path = `/trips/${tripId}/nights/${date}`;
    setLodging(inTransit === null ? await api.delete(path) : await api.put(path, { in_transit: inTransit }));
    setNightsVersion((version) => version + 1);
  }

  useEffect(() => {
    let cancelled = false;

    setStatus('loading');
    setPlan(null);
    setAlternative(null);
    setAlternativeError('');

    Promise.all([
      api.get(`/trips/${tripId}`),
      api.get(`/trips/${tripId}/plan`),
      api.get(`/trips/${tripId}/plan/alternative`),
    ])
      .then(([tripData, savedPlan, pendingAlternative]) => {
        if (cancelled) return;

        setTrip(tripData);
        setPlan(savedPlan);
        setAlternative(pendingAlternative);
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

  if (trip && !(trip.budget > 0)) {
    missingForPlan.push('a budget');
  }

  if (trip && trip.interests.length === 0) {
    missingForPlan.push('at least one interest');
  }

  async function generatePlan() {
    setPlanning(true);
    setPlanError('');

    try {
      setPlan(await api.post(`/trips/${tripId}/plan`));
      setAlternative(null);
    } catch (err) {
      setPlanError(
        err.message || 'Could not generate a plan. Please try again.',
      );
    } finally {
      setPlanning(false);
    }
  }

  // Coming from New Trip: generate once, after the trip has loaded.
  useEffect(() => {
    if (status !== 'ready' || !autoGenerate.current) return;

    autoGenerate.current = false;

    // Clear the flag so reloading doesn't generate again.
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
      },
      {
        replace: true,
        state: null,
      },
    );

    if (!plan && missingForPlan.length === 0) {
      generatePlan();
    }
  }, [status]);

  function selectTab(id) {
    const params = new URLSearchParams(searchParams);

    if (id === 'itinerary') {
      params.delete('tab');
    } else {
      params.set('tab', id);
    }

    setSearchParams(params, { replace: true });
  }

  // From another tab's button: the button that was focused is about to be hidden.
  function showTab(id) {
    selectTab(id);
    document.getElementById(tabId('trip', id))?.focus();
  }

  const showItinerary = () => showTab('itinerary');

  async function generateAlternative() {
    setAlternativeBusy(true);
    setAlternativeError('');
    try {
      const result = await api.post(`/trips/${tripId}/plan/alternative`);
      setAlternative(result);
    } catch (err) {
      setAlternativeError(err.message || 'Could not generate an alternative.');
    } finally {
      setAlternativeBusy(false);
    }
  }

  async function acceptAlternative() {
    if (!alternative) return;
    setAlternativeBusy(true);
    setAlternativeError('');
    try {
      const saved = await api.post(`/trips/${tripId}/plan/alternative/${alternative.id}/accept`);
      setPlan(saved);
      setAlternative(null);
    } catch (err) {
      setAlternativeError(err.message || 'Could not save the alternative.');
    } finally {
      setAlternativeBusy(false);
    }
  }

  async function rejectAlternative() {
    if (!alternative) return;
    setAlternativeBusy(true);
    setAlternativeError('');
    try {
      await api.delete(`/trips/${tripId}/plan/alternative/${alternative.id}`);
      setAlternative(null);
    } catch (err) {
      setAlternativeError(err.message || 'Could not discard the alternative.');
    } finally {
      setAlternativeBusy(false);
    }
  }

  // B2: Skeleton loading screen for trip details and itinerary.
  if (status === 'loading') {
    return (
      <div
        className="page container trip-page"
        role="status"
        aria-label="Loading your trip"
      >
        <span className="visually-hidden">
          Loading your trip...
        </span>

        <header className="page-header">
          <Skeleton width="35%" height="14px" />
          <Skeleton width="65%" height="36px" />

          <div className="trip-page__facts">
            {[1, 2, 3, 4].map((item) => (
              <div key={item}>
                <Skeleton width="75px" height="12px" />
                <Skeleton width="110px" height="20px" />
              </div>
            ))}
          </div>
        </header>

        <div className="trip-page__sections">
          <Skeleton
            width="100%"
            height="48px"
            rounded
          />

          {[1, 2].map((item) => (
            <Card key={item} padding="lg">
              <Skeleton width="40%" height="26px" />
              <Skeleton width="85%" height="16px" />
              <Skeleton width="70%" height="16px" />
              <Skeleton width="55%" height="16px" />
            </Card>
          ))}
        </div>
              </div>
    );
  }

  if (status === 'notfound' || status === 'error') {
    return (
      <div className="page container">
        <Card padding="lg">
          <EmptyState
            title={
              status === 'notfound'
                ? 'Trip not found'
                : 'Something went wrong'
            }
            description={
              status === 'notfound'
                ? "This trip doesn't exist or isn't yours."
                : loadError
            }
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
            <dd>
              {formatDateRange(
                trip.start_date,
                trip.end_date,
              )}
            </dd>
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
                <Button to={`/trips/${tripId}/edit`} variant="secondary">
          Edit Trip
        </Button>

        {trip.interests.length > 0 && (
          <ul
            className="trip-card__tags trip-page__tags"
            aria-label="Interests"
          >
            {trip.interests.map((interest) => (
              <li key={interest}>
                {interest}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="trip-page__sections">
        <Tabs
          label="Trip sections"
          idPrefix="trip"
          tabs={TRIP_TABS}
          selected={tab}
          onSelect={selectTab}
        />

        <TabPanel
          idPrefix="trip"
          id="itinerary"
          selected={tab}
        >
          {!plan && (
            <Card
              as="section"
              padding="lg"
              className="trip-page__plan-cta"
              aria-labelledby="plan-cta-title"
            >
              <h2 id="plan-cta-title">
                Day-by-day plan
              </h2>

              {missingForPlan.length > 0 ? (
                <p className="text-muted">
                  Add {missingForPlan.join(' and ')} to this
                  trip to generate an AI itinerary.
                </p>
              ) : (
                <>
                  <p className="text-muted">
                    Let AI draft a day-by-day itinerary
                    with times, costs and travel between
                    stops.
                  </p>

                  {planError && (
                    <p
                      className="trip-page__alert"
                      role="alert"
                    >
                      {planError}
                    </p>
                  )}

                  <div className="trip-page__actions">
                    <Button
                      variant="accent"
                      size="lg"
                      onClick={generatePlan}
                      loading={planning}
                      loadingText="Planning your trip…"
                    >
                      Generate AI itinerary
                    </Button>

                    {planning && (
                      <span className="text-muted">
                        This usually takes 5 to 20 seconds.
                      </span>
                    )}
                  </div>
                </>
              )}
            </Card>
          )}

          {plan && (
            <section
              className="trip-page__plan"
              aria-labelledby="plan-title"
            >
              <div className="trip-page__plan-bar">
                <h2 id="plan-title">Day-by-day plan</h2>
                <Button
                  ref={regenerateRef}
                  variant="secondary"
                  size="sm"
                  onClick={generateAlternative}
                  loading={alternativeBusy}
                  loadingText="Generating alternative…"
                  disabled={alternativeBusy}
                >
                  {alternative ? 'Try another alternative' : 'Generate alternative'}
                </Button>
              </div>

              {alternativeError && (
                <p className="trip-page__alert" role="alert">{alternativeError}</p>
              )}

              {alternative && (
                <Card padding="lg" className="trip-page__confirm">
                  <h3>Compare your itineraries</h3>
                                    <p className="text-muted">
                    Your original plan is still saved. Review both options before choosing.
                  </p>

                  <div className="trip-page__comparison-switch">
                    <Button
                      variant={comparisonView === 'original' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setComparisonView('original')}
                      aria-pressed={comparisonView === 'original'}
                    >
                      Original plan
                    </Button>
                    <Button
                      variant={comparisonView === 'alternative' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setComparisonView('alternative')}
                      aria-pressed={comparisonView === 'alternative'}
                    >
                      Alternative plan
                    </Button>
                  </div>

                  <div className="trip-page__comparison-grid">
                    {[
                      { label: 'Original plan', itinerary: plan },
                      { label: 'Alternative plan', itinerary: alternative.itinerary },
                    ].map(({ label, itinerary }) => (
                      <div
                        key={label}
                        className={`trip-page__comparison-card ${comparisonView === (label === 'Original plan' ? 'original' : 'alternative') ? 'trip-page__comparison-card--active' : ''}`}
                      >
                        <h4>{label}</h4>
                        <p>
                          <strong>Estimated plan cost: </strong>
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: itinerary.currency || 'USD',
                          }).format(itinerary.total_estimated_cost ?? 0)}
                        </p>

                        {itinerary.days.map((day, index) => (
                          <div
                            key={`${day.date}-${index}`}
                            style={{ marginTop: '1rem' }}
                          >
                            <strong>Day {index + 1} — {day.date}</strong>
                            <ul>
                              {day.activities.map((activity, activityIndex) => (
                                <li key={`${activity.name}-${activityIndex}`}>
                                  {activity.start_time} — {activity.name}
                                  {activity.location ? ` (${activity.location})` : ''}
                                  {' — '}
                                  {new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: itinerary.currency || 'USD',
                                  }).format(activity.estimated_cost ?? 0)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  <div
                    className="trip-page__actions"
                    style={{ marginTop: '1rem' }}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={rejectAlternative}
                      disabled={alternativeBusy}
                    >
                      Keep Original
                    </Button>

                    <Button
                      variant="accent"
                      size="sm"
                      onClick={acceptAlternative}
                      disabled={alternativeBusy}
                    >
                      Use Alternative
                    </Button>
                  </div>
                </Card>
              )}

              {planError && (
                <p className="trip-page__alert" role="alert">
                  {planError}
                </p>
              )}

              {planning && (
                <p className="text-muted trip-page__wait">
                  Planning a new version. This usually
                  takes 5 to 20 seconds.
                </p>
              )}

              <ItineraryView
                itinerary={plan}
                tripId={trip.id}
                budget={budget}
                hotelNames={hotelNames.current}
                lodging={lodging}
                onShowStay={() => showTab('stay')}
                onSetNight={setNight}
              />
            </section>
          )}
        </TabPanel>

        <TabPanel idPrefix="trip" id="budget" selected={tab}>
          {tab === 'budget' && (
            <BudgetTab
              trip={trip}
              onShowItinerary={showItinerary}
              onShowStay={() => showTab('stay')}
            />
          )}
        </TabPanel>

        <TabPanel idPrefix="trip" id="stay" selected={tab}>
          {stayOpened && (
            <ErrorBoundary
              fallback={
                <Card padding="lg">
                  <p role="status">
                    Hotel suggestions can&apos;t load right now.
                    The rest of your trip still works.
                  </p>
                </Card>
              }
            >
              <Suspense
                fallback={<Spinner size="lg" label="Loading where to stay" />}
              >
                <WhereToStay
                  key={trip.id}
                  trip={trip}
                  nightsVersion={nightsVersion}
                  hotelNames={hotelNames.current}
                  onHotelNames={rememberHotelNames}
                />
              </Suspense>
            </ErrorBoundary>
          )}
        </TabPanel>

        <TabPanel idPrefix="trip" id="map" selected={tab}>
          {tab === 'map' && (
            <ErrorBoundary
              fallback={
                <Card padding="lg">
                  <p role="status">
                    The map can&apos;t load right now.
                    The rest of your trip still works.
                  </p>
                </Card>
              }
            >
              <Suspense
                fallback={<Spinner size="lg" label="Loading the map" />}
              >
                <TripMap
                  plan={plan}
                  tripId={trip.id}
                  onShowItinerary={showItinerary}
                />
              </Suspense>
            </ErrorBoundary>
          )}
        </TabPanel>

        <TabPanel idPrefix="trip" id="weather" selected={tab}>
          {tab === 'weather' && <WeatherTab trip={trip} />}
        </TabPanel>
      </div>
    </div>
  );
}