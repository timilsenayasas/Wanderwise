/*
 * AI Plan Preview (F3). Sends trip details to POST /api/trips/plan and shows
 * the generated itinerary. Nothing is saved yet; that comes with the trips tables.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import Input from '../components/Input';
import ItineraryView from '../components/ItineraryView';
import './PlanPreview.css';

const EMPTY = { origin: '', destination: '', start_date: '', end_date: '', travelers: '1', budget: '', interests: '' };

function exampleTrip() {
  const start = new Date();
  start.setDate(start.getDate() + 30);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    origin: 'Denton, TX',
    destination: 'Chicago, IL',
    start_date: iso(start),
    end_date: iso(end),
    travelers: '2',
    budget: '1200',
    interests: 'food, museums, architecture',
  };
}

export function parseInterests(text) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validatePlan(v) {
  const errors = {};
  if (!v.origin.trim()) errors.origin = 'Enter where you are starting from.';
  if (!v.destination.trim()) errors.destination = 'Enter where you are going.';
  if (!v.start_date) errors.start_date = 'Pick a start date.';
  if (!v.end_date) errors.end_date = 'Pick an end date.';
  else if (v.start_date && v.end_date < v.start_date) errors.end_date = 'End date must be on or after the start date.';
  const travelers = Number(v.travelers);
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 20) errors.travelers = 'Enter 1 to 20 travelers.';
  if (!(Number(v.budget) > 0)) errors.budget = 'Enter a budget greater than 0.';
  if (parseInterests(v.interests).length === 0) errors.interests = 'Add at least one interest.';
  return errors;
}

export default function PlanPreview() {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [plan, setPlan] = useState(null);
  const resultRef = useRef(null);
  const alertRef = useRef(null);

  useEffect(() => {
    if (plan) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [plan]);

  const update = (field) => (e) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    if (errors[field]) setErrors((errs) => ({ ...errs, [field]: undefined }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError('');
    const found = validatePlan(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      document.getElementById(`plan-${Object.keys(found)[0]}`)?.focus();
      return;
    }

    setSubmitting(true);
    setPlan(null);
    try {
      const result = await api.post('/trips/plan', {
        origin: values.origin.trim(),
        destination: values.destination.trim(),
        start_date: values.start_date,
        end_date: values.end_date,
        travelers: Number(values.travelers),
        budget: Number(values.budget),
        interests: parseInterests(values.interests),
      });
      setPlan(result);
    } catch (err) {
      setServerError(err.message || 'Could not generate a plan. Please try again.');
      setTimeout(() => alertRef.current?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page container plan">
      <header className="page-header fade-up">
        <span className="eyebrow">F3 · AI trip plan · Preview</span>
        <h1>Plan a trip with AI</h1>
        <p>Tell us the basics and we&apos;ll draft a day-by-day itinerary with times, costs and travel between stops.</p>
      </header>

      <Card as="section" padding="lg" className="fade-up" aria-label="Trip details">
        <form className="plan__form" onSubmit={handleSubmit} noValidate>
          {serverError && (
            <p className="plan__alert" role="alert" tabIndex={-1} ref={alertRef}>
              {serverError}
            </p>
          )}
          <div className="plan__grid">
            <Input id="plan-origin" label="From" value={values.origin} onChange={update('origin')} error={errors.origin} placeholder="Denton, TX" />
            <Input id="plan-destination" label="To" value={values.destination} onChange={update('destination')} error={errors.destination} placeholder="Chicago, IL" />
            <Input id="plan-start_date" label="Start date" type="date" value={values.start_date} onChange={update('start_date')} error={errors.start_date} />
            <Input id="plan-end_date" label="End date" type="date" value={values.end_date} min={values.start_date || undefined} onChange={update('end_date')} error={errors.end_date} />
            <Input id="plan-travelers" label="Travelers" type="number" inputMode="numeric" min="1" max="20" value={values.travelers} onChange={update('travelers')} error={errors.travelers} />
            <Input id="plan-budget" label="Total budget (USD)" type="number" inputMode="decimal" min="1" value={values.budget} onChange={update('budget')} error={errors.budget} placeholder="1200" />
          </div>
          <Input
            id="plan-interests"
            label="Interests"
            value={values.interests}
            onChange={update('interests')}
            error={errors.interests}
            hint="Separate with commas, e.g. food, museums, hiking"
          />
          <div className="plan__actions">
            <Button type="submit" variant="accent" size="lg" loading={submitting} loadingText="Planning your trip…">
              Generate itinerary
            </Button>
            <Button variant="ghost" onClick={() => { setValues(exampleTrip()); setErrors({}); }} disabled={submitting}>
              Fill example trip
            </Button>
          </div>
          {submitting && <p className="text-muted plan__wait">This usually takes 5 to 20 seconds.</p>}
        </form>
      </Card>

      {plan && (
        <section ref={resultRef} className="plan__result" aria-label="Generated itinerary">
          <ItineraryView itinerary={plan} />
        </section>
      )}
    </div>
  );
}
