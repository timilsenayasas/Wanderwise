import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import Input from '../components/Input';
import { useToast } from '../components/Toast';
import { validateTrip } from '../lib/validation';

import './NewTrip.css';

const INITIAL_FORM = {
  origin: '',
  destination: '',
  startDate: '',
  endDate: '',
  travelers: '1',
  budget: '',
  interests: '',
};

export default function NewTrip() {
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    if (errors[name]) {
      setErrors((current) => ({
        ...current,
        [name]: '',
      }));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = validateTrip(form);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    const payload = {
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      start_date: form.startDate,
      end_date: form.endDate,
      travelers: Number(form.travelers),
      budget: Number(form.budget),
      interests: form.interests
        .split(',')
        .map((interest) => interest.trim())
        .filter(Boolean),
    };

    setSubmitting(true);

    try {
      const response = await api.post('/trips', payload);

      const tripId = response?.id ?? response?.data?.id;

      if (!tripId) {
        throw new Error('Trip was created without an ID.');
      }

      toast.success('Trip saved!');
      navigate(`/trips/${tripId}`);
    } catch (error) {
      console.error('Failed to create trip:', error);
      toast.error('Unable to save trip. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <section className="page__header new-trip__header">
        <p className="eyebrow">Plan your next adventure</p>

        <h1>New Trip</h1>

        <p>
          Tell us where you're going and what you want to experience.
        </p>
      </section>

      <Card className="new-trip__card">
        <form
          className="new-trip__form"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="new-trip__grid">
            <Input
              id="origin"
              name="origin"
              label="Origin"
              value={form.origin}
              onChange={handleChange}
              error={errors.origin}
              placeholder="Dallas, TX"
              required
            />

            <Input
              id="destination"
              name="destination"
              label="Destination"
              value={form.destination}
              onChange={handleChange}
              error={errors.destination}
              placeholder="New York, NY"
              required
            />

            <Input
              id="startDate"
              name="startDate"
              type="date"
              label="Start date"
              value={form.startDate}
              onChange={handleChange}
              error={errors.startDate}
              required
            />

            <Input
              id="endDate"
              name="endDate"
              type="date"
              label="End date"
              value={form.endDate}
              onChange={handleChange}
              error={errors.endDate}
              required
            />

            <Input
              id="travelers"
              name="travelers"
              type="number"
              label="Travelers"
              value={form.travelers}
              onChange={handleChange}
              error={errors.travelers}
              min="1"
              step="1"
              required
            />

            <Input
              id="budget"
              name="budget"
              type="number"
              label="Budget"
              value={form.budget}
              onChange={handleChange}
              error={errors.budget}
              min="0"
              step="1"
              placeholder="1500"
              required
            />

            <div className="new-trip__interests">
              <Input
                id="interests"
                name="interests"
                label="Interests"
                value={form.interests}
                onChange={handleChange}
                error={errors.interests}
                placeholder="food, museums, hiking"
                hint="Separate interests with commas."
                required
              />
            </div>
          </div>

          {errors.form && (
            <p className="new-trip__alert" role="alert">
              {errors.form}
            </p>
          )}

          <div className="new-trip__actions">
            <Button
              type="submit"
              loading={submitting}
              loadingText="Saving..."
            >
              Create Trip
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}