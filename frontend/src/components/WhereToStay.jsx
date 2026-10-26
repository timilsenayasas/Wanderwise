/*
 * Where to stay tab: the traveler's choice ("Your stay") and hotel suggestions near the destination,
 * from GET /trips/{id}/lodging. Searching Google is billed, so this loads when the tab is first
 * opened and again only on Refresh. Choosing, adding their own hotel, skipping and removing go
 * through PUT/DELETE /trips/{id}/lodging, which keep one Lodging line in the budget.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import Button from './Button';
import Card from './Card';
import HotelCard, { HotelCardSkeleton } from './HotelCard';
import Icon from './Icon';
import OwnHotelForm from './OwnHotelForm';
import StayChoice, { CHANGE_BUTTON_ID, STAY_TITLE_ID } from './StayChoice';
import { formatCurrency, formatDateRange } from '../lib/format';
import {
  choiceName,
  chosenSuggestionId,
  fitNoteText,
  lodgingLeftText,
  nightsText,
  SKIP_LABELS,
  tripNights,
} from '../lib/lodging';
import { usePrefersReducedMotion } from '../lib/motion';
import './WhereToStay.css';

const SKELETON_COUNT = 3;
const SUGGESTIONS_TITLE_ID = 'stay-suggestions-title';
const ADD_OWN_ID = 'stay-add-own';

export default function WhereToStay({ trip }) {
  const reducedMotion = usePrefersReducedMotion();
  const [page, setPage] = useState(null);
  const [choice, setChoice] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [panel, setPanel] = useState(null); // null | 'own' | 'edit'
  const [choosing, setChoosing] = useState(null); // place_id being saved
  const [chooseError, setChooseError] = useState({ placeId: null, message: '' });
  const [skipping, setSkipping] = useState(null); // skip reason being saved
  const [actionError, setActionError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState(null); // element id to focus after the next render
  const latestRequest = useRef(0);
  const nights = page?.nights ?? tripNights(trip);

  const load = useCallback(
    async ({ fresh = false } = {}) => {
      const request = ++latestRequest.current;
      if (fresh) setRefreshing(true);
      else setStatus('loading');
      setRefreshError('');
      try {
        const data = fresh
          ? await api.post(`/trips/${trip.id}/lodging/refresh`)
          : await api.get(`/trips/${trip.id}/lodging`);
        if (request !== latestRequest.current) return;
        setPage(data);
        setChoice(data.choice);
        setStatus('ready');
        if (fresh) setAnnouncement('Suggestions refreshed.');
      } catch (err) {
        if (request !== latestRequest.current) return;
        if (fresh) {
          setRefreshError(err.message || "Couldn't refresh suggestions. Please try again.");
        } else {
          setLoadError(err.message || 'Could not load hotel suggestions.');
          setStatus('error');
        }
      } finally {
        if (fresh && request === latestRequest.current) setRefreshing(false);
      }
    },
    [trip.id],
  );

  useEffect(() => {
    load();
    return () => {
      latestRequest.current++; // ignore a response that arrives after the tab is gone
    };
  }, [load]);

  // Move focus once the element exists, so keyboard and screen reader users follow the change.
  useEffect(() => {
    if (!focusTarget) return;
    const element = document.getElementById(focusTarget);
    element?.focus();
    if (focusTarget === STAY_TITLE_ID) {
      element?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
    setFocusTarget(null);
  }, [focusTarget, reducedMotion]);

  const suggestions = page?.suggestions ?? [];
  const chosenId = chosenSuggestionId(choice, suggestions);
  const chosenSuggestion = suggestions.find((hotel) => hotel.place_id === chosenId) ?? null;
  // PUT answers don't repeat Google's details, so a picked hotel's come from the suggestions.
  const chosenHotel = choice?.choice === 'hotel' ? choice.hotel ?? chosenSuggestion : null;
  const chosenEstimate = chosenSuggestion?.nightly_estimate;

  async function saveChoice(body) {
    const saved = await api.put(`/trips/${trip.id}/lodging`, body);
    setChoice(saved);
    return saved;
  }

  function stayMessage(saved, hotel) {
    if (saved.choice === 'skip') return `Saved: ${SKIP_LABELS[saved.skip_reason].toLowerCase()}.`;
    return `${choiceName(saved, hotel)} is now your stay. ${formatCurrency(saved.total)} is in your budget.`;
  }

  async function choose(hotel, nightlyPrice) {
    setChoosing(hotel.place_id);
    setChooseError({ placeId: null, message: '' });
    try {
      const saved = await saveChoice({
        choice: 'hotel',
        place_id: hotel.place_id,
        ...(nightlyPrice != null ? { nightly_price: nightlyPrice } : {}),
      });
      setPanel(null);
      setAnnouncement(stayMessage(saved, hotel));
      setFocusTarget(STAY_TITLE_ID);
    } catch (err) {
      setChooseError({ placeId: hotel.place_id, message: err.message || 'Could not choose this hotel. Please try again.' });
    } finally {
      setChoosing(null);
    }
  }

  async function saveOwn(values) {
    const saved = await saveChoice({ choice: 'own', ...values });
    setPanel(null);
    setAnnouncement(stayMessage(saved));
    setFocusTarget(STAY_TITLE_ID);
  }

  async function saveEdit(values) {
    const body =
      choice.choice === 'hotel' ? { choice: 'hotel', place_id: choice.place_id, ...values } : { choice: 'own', ...values };
    const saved = await saveChoice(body);
    setPanel(null);
    setAnnouncement(`Your stay is updated. ${formatCurrency(saved.total)} is in your budget.`);
    setFocusTarget(CHANGE_BUTTON_ID);
  }

  async function skip(reason) {
    setSkipping(reason);
    setActionError('');
    try {
      const saved = await saveChoice({ choice: 'skip', reason });
      setPanel(null);
      setAnnouncement(stayMessage(saved));
      setFocusTarget(STAY_TITLE_ID);
    } catch (err) {
      setActionError(err.message || 'Could not save that. Please try again.');
    } finally {
      setSkipping(null);
    }
  }

  async function remove() {
    await api.delete(`/trips/${trip.id}/lodging`);
    setChoice(null);
    setPanel(null);
    setAnnouncement('Your stay was removed, along with its Lodging cost.');
    setFocusTarget(SUGGESTIONS_TITLE_ID);
  }

  function openOwn() {
    setPanel('own');
    setActionError('');
  }

  function closePanel() {
    setFocusTarget(panel === 'edit' ? CHANGE_BUTTON_ID : ADD_OWN_ID);
    setPanel(null);
  }

  const editForm =
    panel === 'edit' && choice && choice.choice !== 'skip' ? (
      <OwnHotelForm
        title="Change your stay"
        withName={choice.choice === 'own'}
        initial={choice}
        maxNights={nights}
        saveLabel="Save changes"
        onSave={saveEdit}
        onCancel={closePanel}
      />
    ) : null;

  return (
    <section className="stay" aria-labelledby="stay-title">
      <header className="stay__header">
        <div className="stay__heading">
          <h2 id="stay-title">Where to stay in {trip.destination}</h2>
          <p className="stay__facts">
            {formatDateRange(trip.start_date, trip.end_date)} · {nightsText(nights)}
            {page && <> · {lodgingLeftText(page.lodging_budget_left)}</>}
          </p>
        </div>
        {status === 'ready' && page.suggestions_status === 'ok' && (
          <Button variant="secondary" size="sm" onClick={() => load({ fresh: true })} loading={refreshing} loadingText="Refreshing…">
            <Icon name="refresh" size={18} /> Refresh suggestions
          </Button>
        )}
      </header>

      <p className="visually-hidden" role="status">
        {announcement}
      </p>

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
        <>
          {choice && (
            <StayChoice
              key={`${choice.choice}-${choice.place_id ?? choice.custom_name ?? choice.skip_reason}`}
              choice={choice}
              hotel={chosenHotel}
              estimate={chosenEstimate}
              tripNights={nights}
              editForm={editForm}
              onChange={() => setPanel('edit')}
              onRemove={remove}
              onShowSuggestions={() => setFocusTarget(SUGGESTIONS_TITLE_ID)}
            />
          )}

          <section className="stay__suggestions" aria-labelledby={SUGGESTIONS_TITLE_ID}>
            <div className="stay__bar">
              <h3 id={SUGGESTIONS_TITLE_ID} tabIndex={-1}>
                Suggested hotels
              </h3>
              {page?.fit_note === null && suggestions.length > 0 && (
                <span className="text-muted stay__sort">Sorted by best fit for your budget</span>
              )}
            </div>

            {page?.fit_note && suggestions.length > 0 && (
              <p className={`stay__note stay__note--${page.fit_note}`}>
                {fitNoteText(page.fit_note, page.lodging_budget_left)}
              </p>
            )}
            {refreshError && (
              <p className="stay__alert" role="alert">
                {refreshError}
              </p>
            )}

            <Suggestions
              status={status}
              page={page}
              refreshing={refreshing}
              destination={trip.destination}
              nights={nights}
              chosenId={chosenId}
              choosing={choosing}
              chooseError={chooseError}
              onChoose={choose}
              onAddOwn={openOwn}
            />
          </section>

          <Card tone="sand" padding="md" className="stay__elsewhere" as="section" aria-labelledby="stay-elsewhere-title">
            <h3 id="stay-elsewhere-title">Staying somewhere else?</h3>
            {panel === 'own' ? (
              <OwnHotelForm
                title="Add my own hotel"
                maxNights={nights}
                saveLabel="Save my hotel"
                onSave={saveOwn}
                onCancel={closePanel}
              />
            ) : (
              <div className="stay__elsewhere-actions">
                <Button id={ADD_OWN_ID} variant="secondary" onClick={openOwn}>
                  Add my own hotel
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => skip('have_place')}
                  loading={skipping === 'have_place'}
                  loadingText="Saving…"
                  aria-pressed={choice?.skip_reason === 'have_place'}
                >
                  I already have a place
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => skip('not_needed')}
                  loading={skipping === 'not_needed'}
                  loadingText="Saving…"
                  aria-pressed={choice?.skip_reason === 'not_needed'}
                >
                  No hotel needed
                </Button>
              </div>
            )}
            {actionError && (
              <p className="stay__alert" role="alert">
                {actionError}
              </p>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

function Suggestions({ status, page, refreshing, destination, nights, chosenId, choosing, chooseError, onChoose, onAddOwn }) {
  if (status === 'loading' || refreshing) {
    const count = refreshing ? Math.max(page?.suggestions.length ?? 0, 1) : SKELETON_COUNT;
    return (
      <>
        <p className="visually-hidden" role="status">
          Finding hotels in {destination}…
        </p>
        <ul className="stay__grid" role="list">
          {Array.from({ length: count }, (_, i) => (
            <li key={i}>
              <HotelCardSkeleton />
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (page.suggestions_status !== 'ok' || page.suggestions.length === 0) {
    const reason = {
      not_configured: "MAPS_API_KEY isn't set in backend/.env.",
      unavailable: "Google Places didn't answer. Check the server log.",
    }[page.suggestions_status];
    return (
      <div className="stay__empty">
        <Icon name="bed" size={32} />
        <p>
          {page.suggestions_status === 'ok'
            ? `We couldn't find hotels in ${destination}. You can still add your own.`
            : "We can't suggest hotels right now. You can still add your own."}
          {/* Only in development, for whoever is setting up the keys. */}
          {import.meta.env.DEV && reason && <span className="stay__dev-hint"> {reason}</span>}
        </p>
        <Button variant="secondary" onClick={onAddOwn}>
          Add my own hotel
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* role="list" because Safari drops list semantics when list-style is none. */}
      <ul className="stay__grid" role="list">
        {page.suggestions.map((hotel, index) => (
          <li key={hotel.place_id}>
            <HotelCard
              hotel={hotel}
              nights={nights}
              index={index}
              chosen={hotel.place_id === chosenId}
              saving={choosing === hotel.place_id}
              error={chooseError.placeId === hotel.place_id ? chooseError.message : ''}
              onChoose={(price) => onChoose(hotel, price)}
            />
          </li>
        ))}
      </ul>
      {/* Google's attribution for Places content shown outside a Google map. */}
      <p className="stay__attribution">Google Maps</p>
    </>
  );
}
