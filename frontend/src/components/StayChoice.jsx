/*
 * Where to stay: the traveler's current choice ("Your stay"), at the top of the Stay tab.
 * A picked hotel shows its fresh Google details; their own hotel and skips show what they told us.
 * Change opens the edit panel (passed in as editForm); Remove asks first, starting on Cancel.
 */
import { useEffect, useRef, useState } from 'react';
import Button from './Button';
import Card from './Card';
import { FitBadge, HotelMeta, HotelPhoto, MapsLink } from './HotelCard';
import Icon from './Icon';
import { formatCurrency } from '../lib/format';
import { choiceName, ESTIMATE_NOTE, nightsText, SKIP_LABELS } from '../lib/lodging';
import './StayChoice.css';

export const STAY_TITLE_ID = 'stay-choice-title';
export const CHANGE_BUTTON_ID = 'stay-change';

/**
 * What the stay's nightly price is: still our estimate, an estimate that has since changed
 * (Refresh re-prices hotels, but the stay keeps the price it was chosen at), or the traveler's own.
 */
function stayPriceLabel(choice, estimate) {
  if (choice.choice !== 'hotel' || estimate == null) return 'Your price';
  return estimate === choice.nightly_price ? 'Estimated' : 'Price when you chose it';
}

export default function StayChoice({ choice, hotel, estimate, tripNights, editForm, onChange, onRemove, onShowSuggestions }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [focusRemove, setFocusRemove] = useState(false);
  const cancelRef = useRef(null);
  const removeRef = useRef(null);

  // The Remove button is replaced by the confirm: start on Cancel so a second Enter can't remove.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (!focusRemove) return;
    removeRef.current?.focus();
    setFocusRemove(false);
  }, [focusRemove]);

  function cancelRemove() {
    setConfirming(false);
    setRemoveError('');
    setFocusRemove(true);
  }

  async function remove() {
    setRemoving(true);
    setRemoveError('');
    try {
      await onRemove(); // this card goes away
    } catch (err) {
      setRemoveError(err.message || 'Could not remove your stay. Please try again.');
      setRemoving(false);
    }
  }

  const isSkip = choice.choice === 'skip';
  const name = choiceName(choice, hotel);

  const actions = confirming ? (
    <div className="stay-choice__confirm">
      <p>
        {isSkip
          ? 'Remove your answer?'
          : `Remove your stay? This also removes its ${formatCurrency(choice.total)} Lodging line from your budget.`}
      </p>
      {removeError && (
        <p className="stay-choice__alert" role="alert">
          {removeError}
        </p>
      )}
      <div className="stay-choice__actions">
        <Button variant="accent" size="sm" onClick={remove} loading={removing} loadingText="Removing…">
          Remove
        </Button>
        <Button ref={cancelRef} variant="ghost" size="sm" onClick={cancelRemove} disabled={removing}>
          Cancel
        </Button>
      </div>
    </div>
  ) : (
    <div className="stay-choice__actions">
      <Button
        id={CHANGE_BUTTON_ID}
        variant="secondary"
        size="sm"
        onClick={isSkip ? onShowSuggestions : onChange}
        aria-expanded={isSkip ? undefined : Boolean(editForm)}
      >
        Change
      </Button>
      <Button ref={removeRef} variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    </div>
  );

  const shownName = isSkip ? SKIP_LABELS[choice.skip_reason] : name;
  const title = (
    // Named in full: the two lines would otherwise run together ("Your stayThe Drake").
    <h3 id={STAY_TITLE_ID} tabIndex={-1} className="stay-choice__title" aria-label={`Your stay: ${shownName}`}>
      <span className="eyebrow">Your stay</span>
      <span className="stay-choice__name">{shownName}</span>
    </h3>
  );

  if (isSkip) {
    return (
      <Card as="section" padding="md" className="stay-choice stay-choice--skip" aria-labelledby={STAY_TITLE_ID}>
        <span className="stay-choice__icon">
          <Icon name="check" />
        </span>
        <div className="stay-choice__body">
          {title}
          <p className="text-muted">Hotel suggestions stay below if your plans change.</p>
          {actions}
        </div>
      </Card>
    );
  }

  const priceLabel = stayPriceLabel(choice, estimate);

  return (
    <Card as="section" padding="sm" className="stay-choice" aria-labelledby={STAY_TITLE_ID}>
      <div className="stay-choice__media">
        {hotel ? (
          <HotelPhoto hotel={hotel} />
        ) : (
          <div className="hotel-photo hotel-photo--empty">
            <Icon name="bed" size={40} />
          </div>
        )}
      </div>

      <div className="stay-choice__body">
        <div className="stay-choice__top">
          <div className="stay-choice__about">
            {title}
            {hotel && <HotelMeta hotel={hotel} />}
            {choice.choice === 'own' && <p className="text-muted">Your own place</p>}
            {hotel && <MapsLink hotel={hotel} />}
          </div>
          <div className="stay-choice__price">
            <span className="stay-choice__nightly">{formatCurrency(choice.nightly_price)} / night</span>
            <span>
              {formatCurrency(choice.total)} total, {nightsText(choice.nights)}
            </span>
            <span className="stay-choice__label" title={priceLabel === 'Estimated' ? ESTIMATE_NOTE : undefined}>
              {priceLabel}
            </span>
            {choice.fit && <FitBadge fit={choice.fit} />}
          </div>
        </div>

        {choice.nights_exceed_trip && (
          <div className="stay-choice__note">
            <Icon name="alert" />
            <p>
              Your trip is now {nightsText(tripNights)}, but your stay is set for {choice.nights}. Update it so your
              budget is right.
            </p>
            <Button variant="secondary" size="sm" onClick={onChange}>
              Update
            </Button>
          </div>
        )}

        {actions}
      </div>

      {editForm && <div className="stay-choice__edit">{editForm}</div>}
    </Card>
  );
}
