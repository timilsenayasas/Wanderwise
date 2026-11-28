import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import Input from '../components/Input';
import { useToast } from '../components/Toast';
import { validateTrip } from '../lib/validation';

import './NewTrip.css';

export default function EditTrip() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({
    origin: '',
    destination: '',
    startDate: '',
    endDate: '',
    travelers: '1',
    budget: '',
    interests: '',
  });

  const [originalTrip, setOriginalTrip] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Load existing trip information.
  useEffect(() => {
    async function loadTrip() {
      try {
        const trip = await api.get(`/trips/${tripId}`);

        setOriginalTrip(trip);

        setForm({
          origin: trip.origin || '',
          destination: trip.destination || '',
          startDate: trip.start_date || '',
          endDate: trip.end_date || '',
          travelers: String(trip.travelers || 1),
          budget: trip.budget == null ? '' : String(trip.budget),
          interests: Array.isArray(trip.interests)
            ? trip.interests.join(', ')
            : '',
        });
      } catch (error) {
        toast.error(error.message || 'Unable to load this trip.');
      } finally {
        setLoading(false);
      }
    }

    loadTrip();
  }, [tripId]);

  // Handle changes to form fields.
  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setErrors((previous) => ({
      ...previous,
      [name]: '',
      form: '',
    }));
  }

  // Save updated trip information.
  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = validateTrip(form);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    // Check whether destination or travel dates changed.
    const itineraryChanged =
      originalTrip &&
      (
        form.destination.trim() !== originalTrip.destination ||
        form.startDate !== originalTrip.start_date ||
        form.endDate !== originalTrip.end_date
      );

    // Ask for confirmation before saving those changes.
    if (itineraryChanged) {
      const confirmed = window.confirm(
        'You changed your destination or travel dates. Your existing itinerary suggestions may no longer match your trip. You may need to regenerate your itinerary. Do you want to continue?'
      );

      if (!confirmed) {
        return;
      }
    }

    setSubmitting(true);
    setErrors({});

    const payload = {
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      start_date: form.startDate,
      end_date: form.endDate,
      travelers: Number(form.travelers),
      budget: form.budget === '' ? null : Number(form.budget),
      interests: form.interests
        .split(',')
        .map((interest) => interest.trim())
        .filter(Boolean),
    };

    try {
      await api.put(`/trips/${tripId}`, payload);

      toast.success('Trip updated successfully!');
      navigate(`/trips/${tripId}`);
    } catch (error) {
      setErrors({
        form: error.message || 'Unable to update trip. Please try again.',
      });

      toast.error(error.message || 'Unable to update trip.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="page container">
        <p>Loading trip information...</p>
      </main>
    );
  }

  if (!originalTrip) {
    return (
      <main className="page container">
        <p role="alert">Unable to load this trip.</p>

        <Button onClick={() => navigate('/trips')}>
          Back to My Trips
        </Button>
      </main>
    );
  }

  return (
    <main className="page container">
      <section className="page__header new-trip__header">
        <p className="eyebrow">Update your adventure</p>
        <h1>Edit Trip</h1>
        <p>Change your trip details below.</p>
      </section>

      <Card className="new-trip__card">
        <form
          className="new-trip__form"
          onSubmit={handleSubmit}
          noValidate
        >
          {errors.form && (
            <p className="new-trip__alert" role="alert">
              {errors.form}
            </p>
          )}

          <div className="new-trip__grid">
            <Input
              label="Origin"
              name="origin"
              value={form.origin}
              onChange={handleChange}
              error={errors.origin}
            />

            <Input
              label="Destination"
              name="destination"
              value={form.destination}
              onChange={handleChange}
              error={errors.destination}
            />

            <Input
              label="Start Date"
              name="startDate"
              type="date"
              value={form.startDate}
              onChange={handleChange}
              error={errors.startDate}
            />

            <Input
              label="End Date"
              name="endDate"
              type="date"
              value={form.endDate}
              onChange={handleChange}
              error={errors.endDate}
            />

            <Input
              label="Travelers"
              name="travelers"
              type="number"
              min="1"
              max="20"
              value={form.travelers}
              onChange={handleChange}
              error={errors.travelers}
            />

            <Input
              label="Budget ($)"
              name="budget"
              type="number"
              min="0"
              value={form.budget}
              onChange={handleChange}
              error={errors.budget}
            />
          </div>

          <div className="new-trip__interests">
            <Input
              label="Interests"
              name="interests"
              value={form.interests}
              onChange={handleChange}
              error={errors.interests}
              hint="Separate interests with commas (example: hiking, food, museums)."
            />
          </div>

          <p>
            Changing your destination or travel dates may mean your
            existing itinerary suggestions need to be regenerated.
          </p>

          <div className="new-trip__actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(`/trips/${tripId}`)}
            >
              Cancel
            </Button>

            <Button type="submit" loading={submitting}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}