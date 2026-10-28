/*
 * Where to stay: splitting a stay so one city has more than one hotel, and merging it back.
 * PUT /trips/{id}/splits/{night} starts a second part on that night; DELETE merges it back. Both
 * answer with the overview. Neither calls Google: only opening the new part searches (like any stay).
 *
 * Split: the first part keeps its choice, cut to its nights (and its Lodging line with it).
 * Merge: with one choice, it's kept (the second part's stretched over the whole stay, as it was
 * for the later nights; the first part's keeps its nights). With two, the traveler picks which to
 * keep (?keep=first|second), seeing both hotels and prices; the other goes, with its line. After a
 * merge, a message says what was kept and what was removed.
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

/**
 * "Hotel Thamel", "Lake House", "No hotel needed": a choice as the traveler knows it. A picked hotel's
 * name comes from its fresh details or the visit's name memory; else "your part 1 hotel".
 */
function choiceLabel(choice, hotel, names, part) {
  if (choice.choice === 'skip') return SKIP_LABELS[choice.skip_reason];
  if (choice.choice === 'hotel' && !hotel && !names?.get(choice.place_id)) return `your part ${part} hotel`;
  return choiceName(choice, hotel ?? (names?.has(choice.place_id) ? { name: names.get(choice.place_id) } : null));
}

/** " and its $240 Lodging line", or nothing for a skip. */
function lineText(choice) {
  return choice.total != null ? ` and its ${formatCurrency(choice.total)} Lodging line` : '';
}

/** The merge confirm when at most one part has a choice: what merging will do. */
export function mergeMessage(stay, previous, hotel, names) {
  const mine = stay.choice;
  const theirs = previous.choice;
  const merged = previous.nights + stay.nights;
  const ask = 'Merge back into one stay?';
  if (mine) {
    const cost = mine.nightly_price != null ? ` (${formatCurrency(stayTotal(mine.nightly_price, merged))})` : '';
    return `${ask} ${choiceLabel(mine, hotel, names, stay.part)} will cover all ${nightsText(merged)}${cost}.`;
  }
  if (theirs) return `${ask} Part ${previous.part}'s choice (${choiceLabel(theirs, null, names, previous.part)}) stays as it is.`;
  return ask;
}

/**
 * When both parts have a choice, the two options: keeping part 1's (its nights, as booked) or
 * part 2's (stretched over the whole stay), each with its name and price.
 */
export function keepOptions(stay, previous, hotel, names) {
  const first = previous.choice;
  const second = stay.choice;
  const merged = previous.nights + stay.nights;
  // "$60 a night × 3 nights = $180" (nothing for a skip).
  const price = (choice, nights) => {
    if (choice.nightly_price == null) return [];
    const total = formatCurrency(stayTotal(choice.nightly_price, nights));
    return [`${formatCurrency(choice.nightly_price)} a night × ${nightsText(nights)} = ${total}`];
  };
  const firstCovers = first.nights != null && first.nights < merged ? [`covers ${first.nights} of ${nightsText(merged)}`] : [];
  return [
    {
      keep: 'first',
      name: choiceLabel(first, null, names, previous.part),
      detail: [`part ${previous.part}`, ...price(first, first.nights ?? previous.nights), ...firstCovers].join(' · '),
      removed: choiceLabel(second, hotel, names, stay.part),
      removedLine: lineText(second),
    },
    {
      keep: 'second',
      name: choiceLabel(second, hotel, names, stay.part),
      detail: [`part ${stay.part}`, ...price(second, merged)].join(' · '), // stretched over the whole stay
      removed: choiceLabel(first, null, names, previous.part),
      removedLine: lineText(first),
    },
  ];
}

export default function StayParts({
  trip,
  stay,
  previousStay,
  level,
  hotel,
  hotelNames,
  onOverview,
  onOpenSection,
  onNotice,
  announce,
}) {
  const id = useId();
  const [panel, setPanel] = useState(null); // null | 'split' | 'merge'
  // Nights in part 1. Set to the middle each time the panel opens: this section can outlive a merge
  // or a new plan that changes its nights (a 3-night part 1 becomes the merged 6-night stay).
  const [wanted, setSplitAfter] = useState(1);
  // Within the stay as it is now (a merge or new plan can change its nights).
  const splitAfter = Math.min(Math.max(wanted, 1), Math.max(stay.nights - 1, 1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focusTarget, setFocusTarget] = useState(null);
  const [keep, setKeep] = useState(null); // 'first' | 'second': which hotel stays when both parts have one
  const firstFieldRef = useRef(null);
  const firstKeepRef = useRef(null);
  const cancelMergeRef = useRef(null);
  const splitButtonId = `${id}-split`;
  const Title = `h${level}`;
  const bothChosen = Boolean(stay.choice && previousStay?.choice);

  useEffect(() => {
    if (panel === 'split') firstFieldRef.current?.focus();
    // Merging: start on the choice of hotel (nothing picked), or on Cancel. A second Enter can't merge.
    if (panel === 'merge') (bothChosen ? firstKeepRef : cancelMergeRef).current?.focus();
  }, [panel, bothChosen]);

  // Move focus once the element exists (e.g. the new part's section after a split).
  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  function openSplit() {
    setSplitAfter(Math.floor(stay.nights / 2)); // the middle night: 3 + 3, or 2 + 3
    setPanel('split');
  }

  function openMerge() {
    setKeep(null); // always the traveler's pick, never a leftover one
    setPanel('merge');
  }

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
          (shortened ? ` ${choiceLabel(choice, hotel, hotelNames, 1)} is now set to ${nightsText(splitAfter)}.` : ''),
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

  /** After merging: which hotel was kept and which was removed (shown, and read out). */
  function mergedNotice() {
    const merged = previousStay.nights + stay.nights;
    const where = `Merged ${stay.city}`;
    const covers = (choice) =>
      choice.nights != null && choice.nights < merged ? ` (${choice.nights} of ${nightsText(merged)})` : '';
    if (bothChosen) {
      const option = keepOptions(stay, previousStay, hotel, hotelNames).find((o) => o.keep === keep);
      const kept = keep === 'first' ? covers(previousStay.choice) : ''; // part 2's is stretched over the stay
      return `${where}: kept ${option.name}${kept}. Removed ${option.removed}${option.removedLine}.`;
    }
    if (stay.choice) {
      return `${where}: ${choiceLabel(stay.choice, hotel, hotelNames, stay.part)} now covers all ${nightsText(merged)}.`;
    }
    if (previousStay.choice) {
      const first = previousStay.choice;
      return `${where}: kept ${choiceLabel(first, null, hotelNames, previousStay.part)}${covers(first)}.`;
    }
    return `${stay.city} is one stay again.`;
  }

  async function merge() {
    setSaving(true);
    setError('');
    try {
      const query = bothChosen ? `?keep=${keep}` : '';
      const overview = await api.delete(`/trips/${trip.id}/splits/${stay.merge_night}${query}`);
      // This part's section goes away: focus the merged stay's (or the one-stay tab's heading).
      const target = stayIds(previousStay.number).section;
      const notice = mergedNotice();
      onOverview(overview);
      onNotice(notice);
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
            <Button id={splitButtonId} variant="secondary" size="sm" onClick={openSplit}>
              Split this stay
            </Button>
          )}
          {canMerge && (
            <Button id={`${id}-merge`} variant="ghost" size="sm" onClick={openMerge}>
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
              {choiceLabel(choice, hotel, hotelNames, 1)} will be set to {nightsText(splitAfter)}
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
          {bothChosen ? (
            <fieldset className="stay-parts__nights">
              <legend>
                Merge back into one stay of {nightsText(previousStay.nights + stay.nights)}. Which hotel do you keep?
              </legend>
              {keepOptions(stay, previousStay, hotel, hotelNames).map((option, index) => (
                <label key={option.keep} className="stay-parts__night">
                  <input
                    ref={index === 0 ? firstKeepRef : undefined}
                    type="radio"
                    name={`${id}-keep`}
                    value={option.keep}
                    checked={keep === option.keep}
                    onChange={() => setKeep(option.keep)}
                  />
                  <span>
                    <strong>{option.name}</strong> · {option.detail}
                  </span>
                </label>
              ))}
              <p className="text-muted">The other one is removed, with its Lodging line.</p>
            </fieldset>
          ) : (
            <p>{mergeMessage(stay, previousStay, hotel, hotelNames)}</p>
          )}
          {error && (
            <p className="stay-parts__alert" role="alert">
              {error}
            </p>
          )}
          <div className="stay-parts__actions">
            <Button
              variant="accent"
              size="sm"
              onClick={merge}
              loading={saving}
              loadingText="Merging…"
              disabled={bothChosen && !keep} // never a hotel removed that the traveler didn't pick
            >
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
