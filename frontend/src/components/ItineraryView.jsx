import { useState } from 'react';
import Button from './Button';
import Card from './Card';
import Icon from './Icon';
import { formatCurrency } from '../lib/format';
import { dayLodging, stayHotelLabel, tonightText } from '../lib/lodging';
import TransportOptions from './TransportOptions';
import './ItineraryView.css';

/**
 * Day-by-day itinerary: a trip's saved plan from GET/POST /api/trips/{id}/plan.
 * With `budget` (GET /budget), the total is the Budget tab's (plan + lodging + other costs);
 * while it loads it's the plan's own, and null (it failed) says it's the plan's only.
 * With `lodging` (GET /lodging: its nights and stays), each day also says where the traveler
 * sleeps that night (or that they're travelling), with a switch to say so themselves, and
 * where they check out and check in on the days a stay ends or starts.
 *
 *   <ItineraryView itinerary={plan} budget={budget} lodging={overview} onShowStay={…} onSetNight={…} />
 *
 * onSetNight(date, true | false | null) answers with a promise; null goes back to the plan's say.
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

/** "plan $1,240 + lodging $480 + your other costs $45.50", leaving out parts that are $0 (but never the plan). */
function breakdownText({ plan, lodging, other }) {
  const parts = [`plan ${formatCurrency(plan)}`];
  if (lodging) parts.push(`lodging ${formatCurrency(lodging)}`);
  if (other) parts.push(`your other costs ${formatCurrency(other)}`);
  return parts.join(' + ');
}

export default function ItineraryView({ itinerary, tripId, budget, lodging, hotelNames, onShowStay, onSetNight }) {
  // Google requires attribution for Places content (here, hotel names) shown outside its map.
  const showsGoogleNames = Boolean(
    lodging?.stays.some(
      (stay) => stay.choice?.choice === 'hotel' && !stay.plan_changed && hotelNames?.has(stay.choice.place_id),
    ),
  );
  const { destination, currency, total_estimated_cost: total, days } = itinerary;
  const firstDate = days[0]?.date;
  const lastDate = days.at(-1)?.date;

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
            <dd>{budget ? formatCurrency(budget.total) : formatMoney(total, currency)}</dd>
          </div>
        </dl>
        {budget ? (
          <p className="itinerary__breakdown">{breakdownText(budget.breakdown)}</p>
        ) : (
          budget === null && <p className="itinerary__breakdown">Plan only: your other costs couldn&apos;t load.</p>
        )}
      </Card>

      <ol className="itinerary__days">
        {days.map((day, i) => {
          const { night, tonight, checkOut, checkIn, leaving, arriving } = dayLodging(
            lodging,
            day.date,
            firstDate,
            lastDate,
          );
          // A split's switch day: same city, another hotel.
          const changeHotels = Boolean(leaving && arriving?.merge_night === day.date);
          return (
            <li key={day.date}>
              <Card as="section" padding="md" aria-labelledby={`day-${i}`}>
                <h3 id={`day-${i}`} className="itinerary__day-title">
                  <span className="itinerary__day-num">Day {i + 1}</span> {formatDay(day.date)}
                </h3>
                {(checkOut || checkIn) && (
                  <ul className="itinerary__move" aria-label="Moving on today">
                    {changeHotels ? (
                      <li>
                        Change hotels in {arriving.city}: check out of {stayHotelLabel(leaving, hotelNames)}, check in
                        to {stayHotelLabel(arriving, hotelNames)}
                      </li>
                    ) : (
                      <>
                        {checkOut && <li>Check out: {checkOut}</li>}
                        {checkIn && <li>Check in: {checkIn}</li>}
                      </>
                    )}
                  </ul>
                )}
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
                        {j < day.activities.length - 1 && (
                          <TransportOptions
                            key={`${a.id}-${day.activities[j + 1].id}`}
                          tripId={tripId}
                          origin={a}
                          destination={day.activities[j + 1]}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                {(night || tonight) && (
                  <Tonight
                    date={day.date}
                    night={night}
                    stay={tonight}
                    hotelNames={hotelNames}
                    onShowStay={onShowStay}
                    onSetNight={onSetNight}
                  />
                )}
              </Card>
            </li>
          );
        })}
      </ol>
      {showsGoogleNames && <p className="itinerary__note text-muted">Hotel names: Google Maps</p>}
      <p className="itinerary__note text-muted">Costs and times are AI estimates, not quotes. Check before you book.</p>
    </div>
  );
}

/**
 * "Tonight: your hotel in Chitwan", "Tonight: in transit", or a way to settle it on the Stay tab,
 * plus the traveler's switch for the night, in case the plan got it wrong.
 */
function Tonight({ date, night, stay, hotelNames, onShowStay, onSetNight }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inTransit = Boolean(night?.in_transit);
  const text = !inTransit && stay ? tonightText(stay, hotelNames, date) : null;

  async function setNight(value) {
    setSaving(true);
    setError('');
    try {
      await onSetNight(night.date, value);
    } catch (err) {
      setError(err.message || 'Could not change that night. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="itinerary__night">
      <Icon name={inTransit ? 'plane' : 'bed'} size={18} />
      <p>
        {inTransit ? (
          <>
            <span className="itinerary__night-label">Tonight:</span> in transit
          </>
        ) : text ? (
          <>
            <span className="itinerary__night-label">Tonight:</span> {text}
          </>
        ) : (
          stay && (
            <>
              <span className="itinerary__night-label">Tonight in {stay.city}:</span>{' '}
              {stay.plan_changed ? 'check your hotel, your plan changed' : 'no hotel chosen yet'}
            </>
          )
        )}
      </p>
      {!inTransit && stay && !text && onShowStay && (
        <Button variant="ghost" size="sm" onClick={onShowStay}>
          {stay.plan_changed ? 'Check on the Stay tab' : 'Choose where to stay'}
        </Button>
      )}
      {night && onSetNight && (
        <span className="itinerary__night-switch">
          <Button
            variant="ghost"
            size="sm"
            className="itinerary__transit"
            aria-pressed={inTransit}
            disabled={saving}
            onClick={() => setNight(!inTransit)}
          >
            {inTransit && <Icon name="check" size={16} />} I&apos;m travelling this night
          </Button>
          {night.set_by === 'you' && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setNight(null)}>
              Use the plan&apos;s
            </Button>
          )}
        </span>
      )}
      {error && (
        <p className="itinerary__night-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
