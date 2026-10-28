/*
 * Where to stay: splitting a stay so one city has more than one hotel, and merging it back.
 * PUT /trips/{id}/splits/{night} starts a second part on that night; DELETE merges it back. Both
 * answer with the overview. Neither calls Google: only opening the new part searches (like any stay).
 *
 * Split: the first part keeps its choice, cut to its nights (and its Lodging line with it).
 * Merge: the first part's choice stays; if only the second part has one, it's stretched over the
 * whole stay; if both have one, the second part's goes, with its line. The confirm says which.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api/client';
import Button from './Button';
import { formatCurrency, formatShortDay } from '../lib/format';
import { choiceName, nightsText, SKIP_LABELS, stayIds, stayKey, stayTotal } from '../lib/lodging';
import './StayParts.css';

/** YYYY-MM-DD plus `days`, as YYYY-MM-DD (local dates, so no timezone shift). */
function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Hotel Thamel", "Lake House", "No hotel needed": a choice as the traveler knows it. */
function choiceLabel(choice, hotel) {
  return choice.choice === 'skip' ? SKIP_LABELS[choice.skip_reason] : choiceName(choice, hotel);
}

/** What merging will do, from both parts' choices. */
export function mergeMessage(stay, previous, hotel) {
  const mine = stay.choice;
  const theirs = previous.choice;
  const merged = previous.nights + stay.nights;
  const ask = 'Merge back into one stay?';
  if (theirs && mine) {
    const line = mine.total != null ? ` and its ${formatCurrency(mine.total)} Lodging line` : '';
    return `${ask} Part ${previous.part}'s choice stays. Part ${stay.part}'s choice (${choiceLabel(mine, hotel)})${line} will be removed.`;
  }
  if (mine) {
    const cost = mine.nightly_price != null ? ` (${formatCurrency(stayTotal(mine.nightly_price, merged))})` : '';
    return `${ask} ${choiceLabel(mine, hotel)} will cover all ${nightsText(merged)}${cost}.`;
  }
  if (theirs) return `${ask} Part ${previous.part}'s choice (${choiceLabel(theirs, null)}) stays as it is.`;
  return ask;
}

export default function StayParts({ trip, stay, previousStay, level, hotel, onOverview, onOpenSection, announce }) {
  const id = useId();
  const [panel, setPanel] = useState(null); // null | 'split' | 'merge'
  const [wanted, setSplitAfter] = useState(Math.floor(stay.nights / 2)); // nights in part 1
  // Within the stay as it is now (a merge or new plan can change its nights).
  const splitAfter = Math.min(Math.max(wanted, 1), Math.max(stay.nights - 1, 1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focusTarget, setFocusTarget] = useState(null);
  const firstFieldRef = useRef(null);
  const cancelMergeRef = useRef(null);
  const splitButtonId = `${id}-split`;
  const Title = `h${level}`;

  useEffect(() => {
    if (panel === 'split') firstFieldRef.current?.focus();
    if (panel === 'merge') cancelMergeRef.current?.focus(); // a second Enter can't merge by accident
  }, [panel]);

  // Move focus once the element exists (e.g. the new part's section after a split).
  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  function close(focusId = splitButtonId) {
    setPanel(null);
    setError('');
    setFocusTarget(focusId);
  }

  const choice = stay.choice;
  const shortened = choice && choice.nights != null && choice.nights > splitAfter;

  async function split(event) {
    event.preventDefault();
    const night = addDays(stay.check_in, splitAfter);
    setSaving(true);
    setError('');
    try {
      const overview = await api.put(`/trips/${trip.id}/splits/${night}`);
      onOverview(overview);
      const second = overview.stays.find((s) => s.merge_night === night);
      if (second) onOpenSection(stayKey(second));
      announce(
        `${stay.city} is now two stays: ${nightsText(splitAfter)} and ${nightsText(stay.nights - splitAfter)}.` +
          (shortened ? ` ${choiceLabel(choice, hotel)} is now set to ${nightsText(splitAfter)}.` : ''),
      );
      setPanel(null);
      // After the render: splitting a one-stay trip swaps its layout for sections, replacing this
      // component, so focus can't wait for an effect here.
      const target = second ? stayIds(second.number).section : splitButtonId;
      setTimeout(() => document.getElementById(target)?.focus(), 0);
    } catch (err) {
      setError(err.message || 'Could not split this stay. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function merge() {
    setSaving(true);
    setError('');
    try {
      const overview = await api.delete(`/trips/${trip.id}/splits/${stay.merge_night}`);
      // This part's section goes away: focus the merged stay's (or the one-stay tab's heading).
      const target = stayIds(previousStay.number).section;
      onOverview(overview);
      announce(`${stay.city} is one stay again.`);
      setTimeout(() => (document.getElementById(target) ?? document.getElementById('stay-title'))?.focus(), 0);
    } catch (err) {
      setError(err.message || 'Could not merge this stay. Please try again.');
      setSaving(false);
    }
  }

  const canMerge = Boolean(stay.merge_night && previousStay);
  if (!stay.can_split && !canMerge) return null;

  return (
    <div className="stay-parts">
      {panel === null && (
        <div className="stay-parts__actions">
          {stay.can_split && (
            <Button id={splitButtonId} variant="secondary" size="sm" onClick={() => setPanel('split')}>
              Split this stay
            </Button>
          )}
          {canMerge && (
            <Button id={`${id}-merge`} variant="ghost" size="sm" onClick={() => setPanel('merge')}>
              Merge with part {previousStay.part}
            </Button>
          )}
        </div>
      )}

      {panel === 'split' && (
        <form className="stay-parts__panel" onSubmit={split} aria-labelledby={`${id}-split-title`}>
          <Title id={`${id}-split-title`}>Split this stay</Title>
          <p className="text-muted">Stay in a second hotel in {stay.city} for the rest of this stay.</p>
          <fieldset className="stay-parts__nights">
            <legend>Second hotel from</legend>
            {Array.from({ length: stay.nights - 1 }, (_, i) => i + 1).map((first) => (
              <label key={first} className="stay-parts__night">
                <input
                  ref={first === splitAfter ? firstFieldRef : undefined}
                  type="radio"
                  name={`${id}-night`}
                  value={first}
                  checked={splitAfter === first}
                  onChange={() => setSplitAfter(first)}
                />
                <span>
                  <strong>{formatShortDay(addDays(stay.check_in, first))}</strong>:{' '}
                  {nightsText(first)} + {nightsText(stay.nights - first)}
                </span>
              </label>
            ))}
          </fieldset>
          {shortened && (
            <p className="stay-parts__note" aria-live="polite">
              {choiceLabel(choice, hotel)} will be set to {nightsText(splitAfter)}
              {choice.nightly_price != null && ` (${formatCurrency(stayTotal(choice.nightly_price, splitAfter))})`}, and
              its Lodging line with it.
            </p>
          )}
          {error && (
            <p className="stay-parts__alert" role="alert">
              {error}
            </p>
          )}
          <div className="stay-parts__actions">
            <Button type="submit" size="sm" loading={saving} loadingText="Splitting…">
              Split
            </Button>
            <Button variant="ghost" size="sm" onClick={() => close()} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {panel === 'merge' && (
        <div className="stay-parts__panel">
          <p>{mergeMessage(stay, previousStay, hotel)}</p>
          {error && (
            <p className="stay-parts__alert" role="alert">
              {error}
            </p>
          )}
          <div className="stay-parts__actions">
            <Button variant="accent" size="sm" onClick={merge} loading={saving} loadingText="Merging…">
              Merge
            </Button>
            <Button ref={cancelMergeRef} variant="ghost" size="sm" onClick={() => close(`${id}-merge`)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
