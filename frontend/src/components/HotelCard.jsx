/*
 * Where to stay: one suggested hotel. Google's name, rating, photo and link are shown as
 * fetched (never stored); the photo credits its authors, as Google requires.
 * A hotel without a price estimate asks for a nightly price before it can be chosen.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Button from './Button';
import Card from './Card';
import Icon from './Icon';
import Input from './Input';
import { formatCurrency } from '../lib/format';
import { ESTIMATE_NOTE, FIT_LABELS, nightsText, ratingLabel } from '../lib/lodging';
import './HotelCard.css';

export default function HotelCard({ hotel, nights, chosen, saving, error, onChoose, index = 0 }) {
  const id = useId();
  const [askingPrice, setAskingPrice] = useState(false);
  const priced = hotel.nightly_estimate != null;

  return (
    <Card
      as="article"
      padding="sm"
      interactive
      className={[
        'hotel-card',
        hotel.best_fit && 'hotel-card--best',
        chosen && 'hotel-card--chosen',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--stagger-index': index }}
      aria-labelledby={`${id}-name`}
    >
      <HotelPhoto hotel={hotel} />
      {hotel.best_fit && <span className="hotel-card__ribbon">Best fit for your budget</span>}
      {chosen && (
        <span className="hotel-card__check">
          <Icon name="check" size={18} strokeWidth={2.6} title="Chosen" />
        </span>
      )}

      <div className="hotel-card__body">
        <h4 id={`${id}-name`} className="hotel-card__name">
          {hotel.name}
        </h4>
        <HotelMeta hotel={hotel} />

        <div className="hotel-card__money">
          {hotel.fit ? <FitBadge fit={hotel.fit} /> : <span />}
          <div className="hotel-card__price">
            {priced ? (
              <>
                <span className="hotel-card__nightly">{formatCurrency(hotel.nightly_estimate)} / night</span>
                <span>
                  {formatCurrency(hotel.stay_total)} total, {nightsText(nights)}
                </span>
                <span className="hotel-card__estimated" title={ESTIMATE_NOTE}>
                  Estimated
                </span>
              </>
            ) : (
              <span className="hotel-card__estimated">No estimate</span>
            )}
          </div>
        </div>

        {askingPrice && !chosen ? (
          <PriceForm
            hotel={hotel}
            saving={saving}
            onSave={(price) => onChoose(price)}
            onCancel={() => setAskingPrice(false)}
          />
        ) : (
          <div className="hotel-card__actions">
            <MapsLink hotel={hotel} />
            {chosen ? (
              <Button variant="secondary" size="sm" disabled>
                <Icon name="check" size={18} /> Chosen
              </Button>
            ) : (
              <Button
                size="sm"
                loading={saving}
                loadingText="Choosing…"
                onClick={() => (priced ? onChoose() : setAskingPrice(true))}
                aria-label={`Choose ${hotel.name}`}
              >
                Choose
              </Button>
            )}
          </div>
        )}

        {error && (
          <p className="hotel-card__alert" role="alert">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

export function HotelPhoto({ hotel }) {
  if (!hotel.photo) {
    return (
      <div className="hotel-photo hotel-photo--empty">
        <Icon name="bed" size={40} />
      </div>
    );
  }
  const authors = hotel.photo.authors;
  return (
    <div className="hotel-photo">
      {/* The name is right below, so the photo itself adds nothing for screen readers. */}
      <img src={hotel.photo.uri} alt="" loading="lazy" width={800} height={600} />
      {authors.length > 0 && (
        <p className="hotel-photo__credit">
          Photo:{' '}
          {authors.map((author, i) => (
            <span key={`${author.name}-${i}`}>
              {i > 0 && ', '}
              {author.uri ? (
                <a href={author.uri} target="_blank" rel="noopener noreferrer">
                  {author.name}
                </a>
              ) : (
                author.name
              )}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** "Near North Side · ★ 4.6 (1,284)". */
export function HotelMeta({ hotel }) {
  return (
    <p className="hotel-meta">
      <span>{hotel.area}</span>
      {hotel.rating != null && (
        <span className="hotel-meta__rating" role="img" aria-label={ratingLabel(hotel.rating, hotel.review_count)}>
          <Icon name="star" size={16} className="hotel-meta__star" />
          {hotel.rating.toFixed(1)}
          {hotel.review_count != null && <span className="hotel-meta__reviews">({hotel.review_count.toLocaleString()})</span>}
        </span>
      )}
    </p>
  );
}

export function MapsLink({ hotel }) {
  if (!hotel.google_maps_uri) return <span />;
  return (
    <a
      className="maps-link"
      href={hotel.google_maps_uri}
      target="_blank"
      rel="noopener noreferrer"
      // Every card has this link, so its name says which hotel (and that it opens a new tab).
      aria-label={`View ${hotel.name} on Google Maps (opens in a new tab)`}
    >
      View on Google Maps
      <Icon name="external" size={16} />
    </a>
  );
}

export function FitBadge({ fit }) {
  return <span className={`fit-badge fit-badge--${fit}`}>{FIT_LABELS[fit]}</span>;
}

/** A nightly price for a hotel with no estimate, asked for right in the card. */
function PriceForm({ hotel, saving, onSave, onCancel }) {
  const inputRef = useRef(null);
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(event) {
    event.preventDefault();
    const value = Number(price);
    if (price.trim() === '' || Number.isNaN(value)) return setError('Enter a nightly price.');
    if (value < 0) return setError("The price can't be negative.");
    setError('');
    onSave(value);
  }

  return (
    <form className="hotel-card__price-form" onSubmit={handleSubmit} noValidate>
      <Input
        ref={inputRef}
        label={`Nightly price for ${hotel.name} (USD)`}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        error={error}
      />
      <div className="hotel-card__actions">
        <Button type="submit" size="sm" loading={saving} loadingText="Choosing…">
          Choose
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Same shape as a card, so nothing jumps when the real ones arrive. */
export function HotelCardSkeleton() {
  return (
    <Card padding="sm" className="hotel-card hotel-card--skeleton" aria-hidden="true">
      <div className="hotel-photo skeleton" />
      <div className="hotel-card__body">
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--line" />
        <div className="hotel-card__money">
          <span className="skeleton skeleton--pill" />
          <span className="skeleton skeleton--price" />
        </div>
        <div className="hotel-card__actions">
          <span className="skeleton skeleton--line" />
          <span className="skeleton skeleton--button" />
        </div>
      </div>
    </Card>
  );
}
