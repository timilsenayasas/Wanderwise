import Card from './Card';
import './ItineraryView.css';

/**
 * Day-by-day itinerary, in the shape returned by POST /api/trips/plan.
 *
 *   <ItineraryView itinerary={plan} />
 *
 * Reuse this on the Itinerary page once plans are saved to a trip.
 */
export function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    // The AI may return a currency code Intl doesn't know.
    return `${Math.round(amount)} ${currency}`;
  }
}

function formatDay(isoDate) {
  // Parse as local midnight so the date doesn't shift by timezone.
  return new Date(`${isoDate}T00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export default function ItineraryView({ itinerary }) {
  const { destination, currency, total_estimated_cost: total, days } = itinerary;

  return (
    <div className="itinerary">
      <Card tone="navy" padding="lg" className="itinerary__summary">
        <div>
          <span className="itinerary__label">Your trip to</span>
          <h2 className="itinerary__destination">{destination}</h2>
        </div>
        <dl className="itinerary__stats">
          <div>
            <dt>Days</dt>
            <dd>{days.length}</dd>
          </div>
          <div>
            <dt>Estimated total</dt>
            <dd>{formatMoney(total, currency)}</dd>
          </div>
        </dl>
      </Card>

      <ol className="itinerary__days">
        {days.map((day, i) => (
          <li key={day.date}>
            <Card as="section" padding="md" aria-labelledby={`day-${i}`}>
              <h3 id={`day-${i}`} className="itinerary__day-title">
                <span className="itinerary__day-num">Day {i + 1}</span> {formatDay(day.date)}
              </h3>
              <ol className="itinerary__activities">
                {day.activities.map((a, j) => (
                  <li key={`${a.start_time}-${j}`} className="activity">
                    <time className="activity__time">{a.start_time}</time>
                    <div className="activity__body">
                      <div className="activity__head">
                        <h4 className="activity__name">{a.name}</h4>
                        <span className="activity__cost">
                          {a.estimated_cost > 0 ? formatMoney(a.estimated_cost, currency) : 'Free'}
                        </span>
                      </div>
                      <p className="activity__meta">
                        <span className="activity__category">{a.category}</span>
                        {a.location} · {formatDuration(a.duration_minutes)}
                      </p>
                      <p className="activity__desc">{a.description}</p>
                      {a.travel_time_to_next_minutes > 0 && j < day.activities.length - 1 && (
                        <p className="activity__travel">{formatDuration(a.travel_time_to_next_minutes)} to next stop</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </li>
        ))}
      </ol>
      <p className="itinerary__note text-muted">Costs and times are AI estimates, not quotes. Check before you book.</p>
    </div>
  );
}
