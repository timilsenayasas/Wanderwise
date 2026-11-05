import { useEffect, useId, useRef, useState } from 'react';
import Button from './Button';
import Input from './Input';
import { BUDGET_CATEGORIES } from '../lib/budget';
import './CostLineForm.css';

/**
 * A3: add or edit one of the traveler's own cost lines.
 *   <CostLineForm trip={trip} line={line} onSave={save} onCancel={close} />   // no `line` = add
 * onSave(values) sends them to the server. If it throws, the server's message (e.g. a 422) is shown.
 */
export default function CostLineForm({ trip, line, onSave, onCancel }) {
  const id = useId();
  const categoryRef = useRef(null);
  const [values, setValues] = useState({
    category: line?.category ?? '',
    amount: line ? String(line.amount) : '',
    description: line?.description ?? '',
    trip_date: line?.trip_date ?? '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    categoryRef.current?.focus();
  }, []);

  function update(field) {
    return (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  }

  function validate() {
    const found = {};
    if (!values.category) found.category = 'Choose a category.';
    const amount = Number(values.amount);
    if (values.amount.trim() === '' || Number.isNaN(amount)) found.amount = 'Enter an amount.';
    else if (amount < 0) found.amount = "The amount can't be negative.";
    if (values.trip_date && (values.trip_date < trip.start_date || values.trip_date > trip.end_date)) {
      found.trip_date = 'Pick a date within the trip.';
    }
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
        category: values.category,
        amount: Number(values.amount),
        description: values.description.trim() || null,
        trip_date: values.trip_date || null,
      });
    } catch (err) {
      setServerError(err.message || 'Could not save this cost. Please try again.');
      setSaving(false);
    }
  }

  return (
    <form className="cost-line-form" onSubmit={handleSubmit} noValidate aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>{line ? 'Edit cost' : 'Add a cost'}</h4>

      <div className="cost-line-form__fields">
        {/* Input only renders <input>, so the select uses the same field classes by hand. */}
        <div className={`field ${errors.category ? 'field--error' : ''}`}>
          <label htmlFor={`${id}-category`} className="field__label">
            Category
          </label>
          <div className="field__control">
            <select
              ref={categoryRef}
              id={`${id}-category`}
              className="field__input"
              value={values.category}
              onChange={update('category')}
              aria-invalid={errors.category ? true : undefined}
              aria-describedby={errors.category ? `${id}-category-error` : undefined}
            >
              <option value="">Choose a category</option>
              {BUDGET_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
          {errors.category && (
            <p id={`${id}-category-error`} className="field__error">
              {errors.category}
            </p>
          )}
        </div>

        <Input
          label="Amount (USD)"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={values.amount}
          onChange={update('amount')}
          error={errors.amount}
        />

        <Input
          label="Description (optional)"
          value={values.description}
          onChange={update('description')}
          maxLength={200}
          className="cost-line-form__wide"
        />

        <Input
          label="Date (optional)"
          type="date"
          min={trip.start_date}
          max={trip.end_date}
          value={values.trip_date}
          onChange={update('trip_date')}
          error={errors.trip_date}
          hint="Adds the cost to that day's total."
        />
      </div>

      {serverError && (
        <p className="cost-line-form__alert" role="alert">
          {serverError}
        </p>
      )}

      <div className="cost-line-form__actions">
        <Button type="submit" loading={saving} loadingText="Saving…">
          {line ? 'Save cost' : 'Add cost'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
