/*
 * Where to stay: one stay's section (a run of nights in one base city). Hotel suggestions come from
 * GET /trips/{id}/lodging/stays/{n}, which searches Google (billed), so they load the first time the
 * section opens and again only on Refresh. Choosing, adding their own hotel, skipping and removing go
 * through PUT/DELETE on the same path, which answer with the whole overview (other stays' budgets change).
 *
 * oneStay: the trip has a single stay, so this is the whole tab, exactly as before multi-city trips.
 * Otherwise it's a disclosure section with a status pill, under the tab's own heading.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import Button from './Button';
import Card from './Card';
import HotelCard, { HotelCardSkeleton } from './HotelCard';
import Icon from './Icon';
import OwnHotelForm from './OwnHotelForm';
import StayChoice from './StayChoice';
import { formatCurrency, formatDateRange } from '../lib/format';
import {
  choiceName,
  chosenSuggestionId,
  fitNoteText,
  lodgingLeftText,
  nightsText,
  rescore,
  SKIP_LABELS,
  stayIds,
  stayStatus,
} from '../lib/lodging';
import { usePrefersReducedMotion } from '../lib/motion';

const SKELETON_COUNT = 3;

/** The one-stay tab's heading, also shown while the overview loads. */
export function StayHeader({ trip, nights, lodgingLeft, action }) {
  return (
    <header className="stay__header">
      <div className="stay__heading">
        <h2 id="stay-title">Where to stay in {trip.destination}</h2>
        <p className="stay__facts">
          {formatDateRange(trip.start_date, trip.end_date)} · {nightsText(nights)}
          {lodgingLeft !== undefined && <> · {lodgingLeftText(lodgingLeft)}</>}
        </p>
      </div>
      {action}
    </header>
  );
}

export function SuggestionSkeletons({ count = SKELETON_COUNT, destination }) {
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

export default function StaySection({ trip, stay, lodgingLeft, oneStay, open, onToggle, onOverview, announce }) {
  const reducedMotion = usePrefersReducedMotion();
  const ids = stayIds(stay.number);
  const level = oneStay ? 3 : 4; // under the tab's h2, or under this section's h3
  const Heading = `h${level}`;
  const [page, setPage] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [panel, setPanel] = useState(null); // null | 'own' | 'edit'
  const [choosing, setChoosing] = useState(null); // place_id being saved
  const [chooseError, setChooseError] = useState({ placeId: null, message: '' });
  const [skipping, setSkipping] = useState(null); // skip reason being saved
  const [actionError, setActionError] = useState('');
  const [focusTarget, setFocusTarget] = useState(null); // element id to focus after the next render
  const latestRequest = useRef(0);
  const choice = stay.choice;

  const load = useCallback(
    async ({ fresh = false } = {}) => {
      const request = ++latestRequest.current;
      const path = `/trips/${trip.id}/lodging/stays/${stay.number}`;
      if (fresh) setRefreshing(true);
      else setStatus('loading');
      setRefreshError('');
      try {
        const data = fresh ? await api.post(`${path}/refresh`) : await api.get(path);
        if (request !== latestRequest.current) return;
        setPage(data);
        setStatus('ready');
        if (fresh) announce('Suggestions refreshed.');
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
    [trip.id, stay.number, announce],
  );

  // Search the first time the section opens; after that only Refresh searches again.
  const searched = useRef(false);
  useEffect(() => {
    if (!open || searched.current) return;
    searched.current = true;
    load();
  }, [open, load]);

  useEffect(
    () => () => {
      latestRequest.current++; // ignore a response that arrives after the tab is gone
    },
    [],
  );

  // Move focus once the element exists, so keyboard and screen reader users follow the change.
  useEffect(() => {
    if (!focusTarget) return;
    const element = document.getElementById(focusTarget);
    element?.focus();
    if (focusTarget === ids.choiceTitle) {
      element?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
    setFocusTarget(null);
  }, [focusTarget, reducedMotion, ids.choiceTitle]);

  // Another stay's choice changes what's left for this one: judge the suggestions against it now.
  const { suggestions, fitNote } = page ? rescore(page, stay.budget_left) : { suggestions: [], fitNote: null };
  // Google's details for the chosen hotel: from this section's search (the overview has none).
  const pageHotel = page?.stay.choice?.place_id === choice?.place_id ? page?.stay.choice?.hotel : null;
  const shown = choice ? { ...choice, hotel: choice.hotel ?? pageHotel } : null;
  const chosenId = chosenSuggestionId(shown, suggestions);
  const chosenSuggestion = suggestions.find((hotel) => hotel.place_id === chosenId) ?? null;
  const chosenHotel = shown?.choice === 'hotel' ? shown.hotel ?? chosenSuggestion : null;

  async function saveChoice(body) {
    const overview = await api.put(`/trips/${trip.id}/lodging/stays/${stay.number}`, body);
    onOverview(overview);
    return overview.stays[stay.number - 1].choice;
  }

  function stayMessage(saved, hotel) {
    if (saved.choice === 'skip') return `Saved: ${SKIP_LABELS[saved.skip_reason].toLowerCase()}.`;
    const where = oneStay ? 'your stay' : `your stay in ${stay.city}`;
    return `${choiceName(saved, hotel)} is now ${where}. ${formatCurrency(saved.total)} is in your budget.`;
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
      announce(stayMessage(saved, hotel));
      setFocusTarget(ids.choiceTitle);
    } catch (err) {
      setChooseError({ placeId: hotel.place_id, message: err.message || 'Could not choose this hotel. Please try again.' });
    } finally {
      setChoosing(null);
    }
  }

  async function saveOwn(values) {
    const saved = await saveChoice({ choice: 'own', ...values });
    setPanel(null);
    announce(stayMessage(saved));
    setFocusTarget(ids.choiceTitle);
  }

  async function saveEdit(values) {
    const body =
      choice.choice === 'hotel' ? { choice: 'hotel', place_id: choice.place_id, ...values } : { choice: 'own', ...values };
    const saved = await saveChoice(body);
    setPanel(null);
    announce(`Your stay is updated. ${formatCurrency(saved.total)} is in your budget.`);
    setFocusTarget(ids.change);
  }

  async function skip(reason) {
    setSkipping(reason);
    setActionError('');
    try {
      const saved = await saveChoice({ choice: 'skip', reason });
      setPanel(null);
      announce(stayMessage(saved));
      setFocusTarget(ids.choiceTitle);
    } catch (err) {
      setActionError(err.message || 'Could not save that. Please try again.');
    } finally {
      setSkipping(null);
    }
  }

  async function remove() {
    onOverview(await api.delete(`/trips/${trip.id}/lodging/stays/${stay.number}`));
    setPanel(null);
    announce('Your stay was removed, along with its Lodging cost.');
    setFocusTarget(ids.suggestionsTitle);
  }

  function openOwn() {
    setPanel('own');
    setActionError('');
  }

  function closePanel() {
    setFocusTarget(panel === 'edit' ? ids.change : ids.addOwn);
    setPanel(null);
  }

  const lengthOf = oneStay ? 'your trip' : 'this stay';
  const editForm =
    panel === 'edit' && choice && choice.choice !== 'skip' ? (
      <OwnHotelForm
        title="Change your stay"
        level={level + 1}
        lengthOf={lengthOf}
        withName={choice.choice === 'own'}
        initial={choice}
        maxNights={stay.nights}
        saveLabel="Save changes"
        onSave={saveEdit}
        onCancel={closePanel}
      />
    ) : null;

  const refreshButton = status === 'ready' && page.suggestions_status === 'ok' && (
    <Button variant="secondary" size="sm" onClick={() => load({ fresh: true })} loading={refreshing} loadingText="Refreshing…">
      <Icon name="refresh" size={18} /> Refresh suggestions
    </Button>
  );

  const body =
    status === 'error' ? (
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
        {stay.plan_changed && (
          <p className="stay__note stay__note--none_fit">
            Your plan changed: this choice was made for {stay.choice_city}. Check it still suits your stay in{' '}
            {stay.city}, or change it.
          </p>
        )}

        {choice && (
          <StayChoice
            key={`${choice.choice}-${choice.place_id ?? choice.custom_name ?? choice.skip_reason}`}
            ids={ids}
            level={level}
            oneStay={oneStay}
            choice={choice}
            hotel={chosenHotel}
            estimate={chosenSuggestion?.nightly_estimate}
            stayNights={stay.nights}
            editForm={editForm}
            onChange={() => setPanel('edit')}
            onRemove={remove}
            onShowSuggestions={() => setFocusTarget(ids.suggestionsTitle)}
          />
        )}

        <section className="stay__suggestions" aria-labelledby={ids.suggestionsTitle}>
          <div className="stay__bar">
            <Heading id={ids.suggestionsTitle} tabIndex={-1}>
              Suggested hotels
            </Heading>
            {page && fitNote === null && suggestions.length > 0 && (
              <span className="text-muted stay__sort">Sorted by best fit for your budget</span>
            )}
            {!oneStay && refreshButton}
          </div>

          {fitNote && suggestions.length > 0 && (
            <p className={`stay__note stay__note--${fitNote}`}>{fitNoteText(fitNote, stay.budget_left)}</p>
          )}
          {refreshError && (
            <p className="stay__alert" role="alert">
              {refreshError}
            </p>
          )}

          <Suggestions
            status={status}
            page={page}
            suggestions={suggestions}
            refreshing={refreshing}
            city={oneStay ? trip.destination : stay.city}
            nights={stay.nights}
            nameLevel={level + 1}
            chosenId={chosenId}
            choosing={choosing}
            chooseError={chooseError}
            onChoose={choose}
            onAddOwn={openOwn}
          />
        </section>

        <Card tone="sand" padding="md" className="stay__elsewhere" as="section" aria-labelledby={ids.elsewhereTitle}>
          <Heading id={ids.elsewhereTitle}>Staying somewhere else?</Heading>
          {panel === 'own' ? (
            <OwnHotelForm
              title="Add my own hotel"
              level={level + 1}
              lengthOf={lengthOf}
              maxNights={stay.nights}
              saveLabel="Save my hotel"
              onSave={saveOwn}
              onCancel={closePanel}
            />
          ) : (
            <div className="stay__elsewhere-actions">
              <Button id={ids.addOwn} variant="secondary" onClick={openOwn}>
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
    );

  if (oneStay) {
    return (
      <>
        <StayHeader trip={trip} nights={stay.nights} lodgingLeft={lodgingLeft} action={refreshButton} />
        {body}
      </>
    );
  }

  const pill = stayStatus(stay);
  const when = `${formatDateRange(stay.check_in, stay.check_out)} · ${nightsText(stay.nights)}`;
  return (
    <section className={`stay-section ${open ? 'stay-section--open' : ''}`} aria-labelledby={ids.section}>
      <h3 className="stay-section__heading">
        <button
          type="button"
          id={ids.section}
          className="stay-section__toggle"
          aria-expanded={open}
          aria-controls={ids.body}
          // Spelled out: the parts below would otherwise run together ("Chitwan, NepalNov 7").
          aria-label={`${stay.city}, ${when}: ${pill.text}`}
          onClick={onToggle}
        >
          <span className="stay-section__where">
            <span className="stay-section__city">{stay.city}</span>
            <span className="stay-section__when">{when}</span>
          </span>
          <span className={`stay-status stay-status--${pill.kind}`}>{pill.text}</span>
          <Icon name="arrowRight" size={20} className="stay-section__chevron" />
        </button>
      </h3>
      <div id={ids.body} className="stay-section__body" hidden={!open}>
        {body}
      </div>
    </section>
  );
}

function Suggestions({
  status,
  page,
  suggestions,
  refreshing,
  city,
  nights,
  nameLevel,
  chosenId,
  choosing,
  chooseError,
  onChoose,
  onAddOwn,
}) {
  if (status === 'idle' || status === 'loading' || refreshing) {
    const count = refreshing ? Math.max(page?.suggestions.length ?? 0, 1) : SKELETON_COUNT;
    return <SuggestionSkeletons count={count} destination={city} />;
  }

  if (page.suggestions_status !== 'ok' || suggestions.length === 0) {
    const reason = {
      not_configured: "MAPS_API_KEY isn't set in backend/.env.",
      unavailable: "Google Places didn't answer. Check the server log.",
    }[page.suggestions_status];
    return (
      <div className="stay__empty">
        <Icon name="bed" size={32} />
        <p>
          {page.suggestions_status === 'ok'
            ? `We couldn't find hotels in ${city}. You can still add your own.`
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
        {suggestions.map((hotel, index) => (
          <li key={hotel.place_id}>
            <HotelCard
              hotel={hotel}
              nights={nights}
              index={index}
              nameLevel={nameLevel}
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
