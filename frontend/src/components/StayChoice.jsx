/*
 * Where to stay: the traveler's choice for one stay ("Your stay"), at the top of its section.
 * A picked hotel shows its fresh Google details; their own hotel and skips show what they told us.
 * Change opens the edit panel (passed in as editForm); Remove asks first, starting on Cancel.
 * ids come from stayIds(), so each stay's section has its own; level is the title's heading level.
 */
import { useEffect, useRef, useState } from 'react';
import Button from './Button';
import Card from './Card';
import { FitBadge, HotelMeta, HotelPhoto, MapsLink } from './HotelCard';
import Icon from './Icon';
import { formatCurrency } from '../lib/format';
import { choiceName, ESTIMATE_NOTE, nightsText, SKIP_LABELS, stayTotal } from '../lib/lodging';
import './StayChoice.css';

/**
 * What the stay's nightly price is: still our estimate, an estimate that has since changed
 * (Refresh re-prices hotels, but the stay keeps the price it was chosen at), or the traveler's own.
 */
function stayPriceLabel(choice, estimate) {
  if (choice.choice !== 'hotel' || estimate == null) return 'Your price';
  return estimate === choice.nightly_price ? 'Estimated' : 'Price when you chose it';
}

export default function StayChoice({
  ids,
  level = 3,
  oneStay = true,
  choice,
  hotel,
  estimate,
  stayNights,
  editForm,
  onChange,
  onExtend,
  extending = false,
  extendError = '',
  onRemove,
  onShowSuggestions,
}) {
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
        id={ids.change}
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
  const Title = `h${level}`;
  const title = (
    // Named in full: the two lines would otherwise run together ("Your stayThe Drake").
    <Title id={ids.choiceTitle} tabIndex={-1} className="stay-choice__title" aria-label={`Your stay: ${shownName}`}>
      <span className="eyebrow">Your stay</span>
      <span className="stay-choice__name">{shownName}</span>
    </Title>
  );

  if (isSkip) {
    return (
      <Card as="section" padding="md" className="stay-choice stay-choice--skip" aria-labelledby={ids.choiceTitle}>
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
    <Card as="section" padding="sm" className="stay-choice" aria-labelledby={ids.choiceTitle}>
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

        {choice.nights_exceed_stay && (
          <div className="stay-choice__note">
            <Icon name="alert" />
            <p>
              {oneStay ? 'Your trip' : 'This stay'} is now {nightsText(stayNights)}, but your stay is set for{' '}
              {choice.nights}. Update it so your budget is right.
            </p>
            <Button variant="secondary" size="sm" onClick={onChange}>
              Update
            </Button>
          </div>
        )}

        {/* Booked for fewer nights than the stay (kept after a merge, or shortened): say so, and offer the rest. */}
        {choice.nights != null && choice.nights < stayNights && (
          <div className="stay-choice__note">
            <Icon name="alert" />
            <p>
              This covers {choice.nights} of {nightsText(stayNights)} of {oneStay ? 'your trip' : 'this stay'}. The other{' '}
              {nightsText(stayNights - choice.nights)} {stayNights - choice.nights === 1 ? 'has' : 'have'} no hotel yet.
            </p>
            {onExtend && (
              <Button variant="secondary" size="sm" onClick={onExtend} loading={extending} loadingText="Extending…">
                Extend to all {nightsText(stayNights)} ({formatCurrency(stayTotal(choice.nightly_price, stayNights))})
              </Button>
            )}
            {extendError && (
              <p className="stay-choice__alert" role="alert">
                {extendError}
              </p>
            )}
          </div>
        )}

        {actions}
      </div>

      {editForm && <div className="stay-choice__edit">{editForm}</div>}
    </Card>
  );
}
