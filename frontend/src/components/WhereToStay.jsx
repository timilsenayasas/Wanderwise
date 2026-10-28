/*
 * Where to stay tab. GET /trips/{id}/lodging gives the trip's stays (runs of nights in one base city,
 * from the plan) and their choices, without any Google calls. Each stay is a StaySection that searches
 * its city only when it's first opened. A one-city trip has one stay and looks as it always has;
 * a multi-city trip opens its first stay and lists the others as sections to open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import Button from './Button';
import Card from './Card';
import StaySection, { StayHeader, SuggestionSkeletons } from './StaySection';
import { formatCurrency, formatDateRange } from '../lib/format';
import { lodgingLeftText, nightsText, SKIP_LABELS, stayKey, tripNights } from '../lib/lodging';
import './WhereToStay.css';

const TITLE_ID = 'stay-title';

export default function WhereToStay({ trip, nightsVersion = 0, hotelNames, onHotelNames }) {
  const [overview, setOverview] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState('');
  // Open sections, by stayKey() so a split's renumbering doesn't move them. null: just the first stay.
  const [opened, setOpened] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const latestRequest = useRef(0);
  const announce = useCallback((message) => setAnnouncement(message), []);
  // A result worth seeing, not just hearing (e.g. which hotel a merge kept and removed).
  const [notice, setNotice] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    const request = ++latestRequest.current;
    if (!quiet) setStatus('loading');
    try {
      const data = await api.get(`/trips/${trip.id}/lodging`);
      if (request !== latestRequest.current) return;
      setOverview(data);
      setStatus('ready');
    } catch (err) {
      if (request !== latestRequest.current) return;
      setLoadError(err.message || 'Could not load where you are staying.');
      setStatus('error');
    }
  }, [trip.id]);

  useEffect(() => {
    load();
    return () => {
      latestRequest.current++; // ignore a response that arrives after the tab is gone
    };
  }, [load]);

  // A night switched on the Itinerary changes the stays: reload them (free), without a spinner.
  useEffect(() => {
    if (nightsVersion > 0) load({ quiet: true });
  }, [nightsVersion, load]);

  const firstKey = overview?.stays[0] ? stayKey(overview.stays[0]) : null;
  const openKeys = opened ?? new Set(firstKey ? [firstKey] : []);

  function toggle(key) {
    setOpened((current) => {
      const next = new Set(current ?? openKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // A new part from a split opens (and searches) straight away.
  const openSection = useCallback(
    (key) => setOpened((current) => new Set([...(current ?? (firstKey ? [firstKey] : [])), key])),
    [firstKey],
  );

  if (status !== 'ready') {
    // Until the overview arrives, look like the one-stay tab (most trips have one stay).
    return (
      <section className="stay" aria-labelledby={TITLE_ID}>
        <StayHeader trip={trip} nights={tripNights(trip)} />
        {status === 'error' ? (
          <Card padding="lg" className="stay__error">
            <p role="alert">{loadError}</p>
            <div>
              <Button variant="secondary" onClick={() => load()}>
                Try again
              </Button>
            </div>
          </Card>
        ) : (
          <SuggestionSkeletons destination={trip.destination} />
        )}
      </section>
    );
  }

  const { stays, earlier_choices: earlier } = overview;
  const oneStay = stays.length === 1;

  return (
    <section className="stay" aria-labelledby={TITLE_ID}>
      {!oneStay && (
        <header className="stay__header">
          <div className="stay__heading">
            <h2 id={TITLE_ID} tabIndex={-1}>
              Where to stay
            </h2>
            <p className="stay__facts">
              {formatDateRange(trip.start_date, trip.end_date)} · {nightsText(tripNights(trip))} ·{' '}
              {lodgingLeftText(overview.lodging_budget_left)}
            </p>
            <p className="text-muted">
              {stays.length > 1
                ? `Your trip has ${stays.length} stays. Each has its own hotel and its own Lodging line in your budget.`
                : 'Every night of this trip is spent travelling, so there is nowhere to book. ' +
                  'If that is wrong, switch a night off on the Itinerary.'}
            </p>
          </div>
        </header>
      )}

      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      {/* Its own live region, so it's read out as well as shown. */}
      <div className="stay__notice" role="status" hidden={!notice}>
        {notice && (
          <>
            <p>{notice}</p>
            <Button variant="ghost" size="sm" onClick={() => setNotice('')}>
              Dismiss
            </Button>
          </>
        )}
      </div>

      {stays.map((stay, index) => (
        <StaySection
          // By city and first night: a new plan or switched night that changes those is a new section
          // (no stale hotels), while a split's renumbering keeps the others as they are (no new search).
          key={stayKey(stay)}
          trip={trip}
          stay={stay}
          previousStay={stays[index - 1] ?? null}
          lodgingLeft={overview.lodging_budget_left}
          oneStay={oneStay}
          open={oneStay || openKeys.has(stayKey(stay))}
          onToggle={() => toggle(stayKey(stay))}
          onOpenSection={openSection}
          onOverview={setOverview}
          hotelNames={hotelNames}
          onHotelNames={onHotelNames}
          onNotice={setNotice}
          announce={announce}
        />
      ))}

      {earlier.length > 0 && (
        <EarlierChoices trip={trip} earlier={earlier} onOverview={setOverview} announce={announce} />
      )}
    </section>
  );
}

/** Choices for stays a regenerated plan no longer has. Their Lodging lines stay until removed here. */
function EarlierChoices({ trip, earlier, onOverview, announce }) {
  const [confirming, setConfirming] = useState(null); // stay number
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  async function remove(number) {
    setRemoving(true);
    setError('');
    try {
      onOverview(await api.delete(`/trips/${trip.id}/lodging/stays/${number}`));
      setConfirming(null);
      announce('Removed, along with its Lodging cost.');
      document.getElementById(TITLE_ID)?.focus();
    } catch (err) {
      setError(err.message || 'Could not remove it. Please try again.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card as="section" tone="sand" padding="md" className="stay__earlier" aria-labelledby="stay-earlier-title">
      <h3 id="stay-earlier-title">No longer in your plan</h3>
      <p className="text-muted">
        Your new plan doesn&apos;t have these stays. Their costs are still in your budget until you remove them.
      </p>
      <ul className="stay__earlier-list" role="list">
        {earlier.map(({ number, city, choice }) => {
          const what =
            choice.choice === 'skip'
              ? SKIP_LABELS[choice.skip_reason]
              : `${choice.choice === 'hotel' ? 'Hotel' : choice.custom_name} · ${formatCurrency(choice.total)}`;
          const label = `${city ?? `Stay ${number}`}: ${what}`;
          return (
            <li key={number} className="stay__earlier-item">
              <span>{label}</span>
              {confirming === number ? (
                <span className="stay__earlier-actions">
                  <Button variant="accent" size="sm" onClick={() => remove(number)} loading={removing} loadingText="Removing…">
                    Remove
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={removing}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirming(number)} aria-label={`Remove ${label}`}>
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="stay__alert" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
