/*
 * Where to stay: add the traveler's own hotel, or change the current stay's price and nights.
 *   <OwnHotelForm maxNights={4} onSave={save} onCancel={close} />                       // add my own
 *   <OwnHotelForm withName={false} initial={choice} maxNights={4} onSave={…} onCancel={…} />  // change a pick
 * onSave(values) sends them to the server. If it throws, the server's message (e.g. a 422) is shown.
 * Focus moves into the form when it opens; the caller puts it back when it closes.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Button from './Button';
import Input from './Input';
import { formatCurrency } from '../lib/format';
import { nightsText, stayTotal } from '../lib/lodging';
import './OwnHotelForm.css';

export default function OwnHotelForm({ title, withName = true, initial, maxNights, saveLabel, onSave, onCancel }) {
  const id = useId();
  const firstRef = useRef(null);
  const [values, setValues] = useState({
    name: initial?.custom_name ?? '',
    nightly_price: initial?.nightly_price != null ? String(initial.nightly_price) : '',
    nights: String(Math.min(initial?.nights ?? maxNights, maxNights)),
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  function update(field) {
    return (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  }

  const price = Number(values.nightly_price);
  const nights = Number(values.nights);
  const priceOk = values.nightly_price.trim() !== '' && !Number.isNaN(price) && price >= 0;
  const nightsOk = Number.isInteger(nights) && nights >= 1 && nights <= maxNights;

  function validate() {
    const found = {};
    if (withName && !values.name.trim()) found.name = "Enter your hotel's name.";
    if (values.nightly_price.trim() === '' || Number.isNaN(price)) found.nightly_price = 'Enter a nightly price.';
    else if (price < 0) found.nightly_price = "The price can't be negative.";
    if (!nightsOk) found.nights = `Nights must be between 1 and ${maxNights}, the length of your trip.`;
    return found;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setServerError('');
    try {
      await onSave({
        ...(withName ? { name: values.name.trim() } : {}),
        nightly_price: price,
        nights,
      });
    } catch (err) {
      setServerError(err.message || 'Could not save your stay. Please try again.');
      setSaving(false);
    }
  }

  return (
    <form className="own-hotel-form" onSubmit={handleSubmit} noValidate aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>{title}</h4>

      <div className="own-hotel-form__fields">
        {withName && (
          <Input
            ref={firstRef}
            label="Hotel name"
            value={values.name}
            onChange={update('name')}
            maxLength={200}
            autoComplete="off"
            error={errors.name}
            className="own-hotel-form__wide"
          />
        )}
        <Input
          ref={withName ? undefined : firstRef}
          label="Nightly price (USD)"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={values.nightly_price}
          onChange={update('nightly_price')}
          error={errors.nightly_price}
        />
        <Input
          label="Nights"
          type="number"
          inputMode="numeric"
          min="1"
          max={maxNights}
          step="1"
          value={values.nights}
          onChange={update('nights')}
          error={errors.nights}
          hint={`Up to ${nightsText(maxNights)}.`}
        />
      </div>

      {/* Polite, so the new total doesn't interrupt what the screen reader is saying. */}
      <p className="own-hotel-form__total" aria-live="polite">
        {priceOk && nightsOk ? (
          <>
            Total: <strong>{formatCurrency(stayTotal(price, nights))}</strong> for {nightsText(nights)}
          </>
        ) : (
          'Enter a price and nights to see the total.'
        )}
      </p>

      {serverError && (
        <p className="own-hotel-form__alert" role="alert">
          {serverError}
        </p>
      )}

      <div className="own-hotel-form__actions">
        <Button type="submit" loading={saving} loadingText="Saving…">
          {saveLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
