
import { useState } from 'react';
import { api } from '../api/client';
import Button from './Button';

export default function TransportOptions({ tripId, origin, destination }) {
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const hasCoordinates = [origin, destination].every(
    (stop) =>
      Number.isFinite(stop?.latitude) &&
      Number.isFinite(stop?.longitude),
  );

  async function compareTransport() {
    if (!hasCoordinates || loading) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        origin_lat: origin.latitude,
        origin_lng: origin.longitude,
        destination_lat: destination.latitude,
        destination_lng: destination.longitude,
      });

      const result = await api.get(
        `/trips/${tripId}/transport?${params.toString()}`,
      );

      setOptions(result.options);
    } catch {
      setError('Transportation estimates are unavailable right now.');
    } finally {
      setLoading(false);
    }
  }

  if (!hasCoordinates) {
    return null;
  }

  return (
    <div className="transport-options">
      <Button
        variant="secondary"
        size="sm"
        onClick={compareTransport}
        disabled={loading}
      >
        {loading ? 'Checking routes…' : 'Compare transport options'}
      </Button>

      {error && <p role="status">{error}</p>}

      {options && (
        <div className="transport-options__results">
          {options.map((option) => (
            <div key={option.mode}>
              <strong>
                {{
                  DRIVE: 'Driving',
                  WALK: 'Walking',
                  TRANSIT: 'Public transit (bus/train)',
                }[option.mode] || option.mode}
              </strong>

              {option.available === false ? (
                <p>{option.message || 'Estimate unavailable.'}</p>
              ) : (
                <p>
                  About {option.duration_minutes} minutes ·{' '}
                  {option.distance_km} km ·{' '}
                  {option.mode === 'TRANSIT'
                    ? option.transit_fare != null
                      ? `${option.transit_currency} ${option.transit_fare.toFixed(2)} estimated`
                      : 'Fare unavailable'
                    : option.estimated_cost_usd != null
                      ? `$${option.estimated_cost_usd.toFixed(2)} estimated`
                      : 'Cost unavailable'}
                </p>
              )}

              {option.cost_basis && <p>{option.cost_basis}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
