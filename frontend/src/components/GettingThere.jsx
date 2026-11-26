import { useState } from 'react';
import { api } from '../api/client';
import Button from './Button';
import Card from './Card';

export default function GettingThere({ trip }) {
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function checkRoutes() {
    if (loading) return;

    setLoading(true);
    setMessage('');
    setOptions(null);

    try {
      const result = await api.get(
        `/trips/${trip.id}/getting-there`,
      );

      setOptions(result.options);
      setMessage(result.message || '');
    } catch {
      setMessage(
        'Transportation estimates are unavailable right now.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card as="section" padding="lg" className="getting-there">
      <h2>Getting there</h2>

      <p className="text-muted">
        {trip.origin} → {trip.destination}
      </p>

      <Button
        variant="secondary"
        size="sm"
        onClick={checkRoutes}
        disabled={loading}
      >
        {loading ? 'Checking routes…' : 'Check travel options'}
      </Button>

      {message && <p role="status">{message}</p>}

      {options && options.length > 0 && (
        <div className="getting-there__results">
          {options.map((option) => (
            <div
              key={option.mode}
              className="getting-there__option"
            >
              <strong>
                {option.mode === 'DRIVE'
                  ? 'Driving'
                  : 'Public transit (bus/train)'}
              </strong>

              {option.available === false ? (
                <p>
                  {option.message || 'Estimate unavailable.'}
                </p>
              ) : (
                <>
                  <p>
                    About {option.duration_minutes} minutes
                    {' · '}
                    {option.distance_km} km
                  </p>

                  <p>
                    {option.mode === 'TRANSIT'
                      ? option.transit_fare != null
                        ? `${option.transit_currency} ${option.transit_fare.toFixed(2)} estimated`
                        : 'Fare unavailable'
                      : option.estimated_cost_usd != null
                        ? `$${option.estimated_cost_usd.toFixed(2)} estimated fuel cost`
                        : 'Cost unavailable'}
                  </p>

                  {option.cost_basis && (
                    <p className="text-muted">
                      {option.cost_basis}
                    </p>
                  )}
                </>
              )}
            </div>
          ))}

          <p className="text-muted">
            Estimates reflect current route availability and
            may change before your trip.
          </p>
        </div>
      )}
    </Card>
  );
}
