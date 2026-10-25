import Card from './Card';
import { categoryLabel } from '../lib/budget';
import { formatCurrency, formatShortDay } from '../lib/format';
import './BudgetBreakdown.css';

/**
 * A3: a trip's costs by category (each with a bar for its share of the total) and by day.
 *   <BudgetBreakdown budget={budget} />   // budget = GET /trips/{id}/budget
 * Lines not on a plan day get their own row, so the day rows add up to the total.
 */
export default function BudgetBreakdown({ budget }) {
  const { categories, per_day: perDay, not_by_day: notByDay, total } = budget;

  return (
    <div className="budget-breakdown">
      <Card as="section" padding="lg" aria-labelledby="budget-categories-title">
        <h3 id="budget-categories-title">By category</h3>
        <ul className="budget-breakdown__categories">
          {categories.map(({ category, amount }) => {
            const share = total > 0 ? (amount / total) * 100 : 0;
            return (
              <li key={category} className="budget-breakdown__category">
                <span className="budget-breakdown__name">{categoryLabel(category)}</span>
                <span className="budget-breakdown__amount">
                  {formatCurrency(amount)}
                  <span className="budget-breakdown__share"> · {Math.round(share)}%</span>
                </span>
                {/* The percentage above says the same thing for screen readers. */}
                <span className="budget-breakdown__bar" aria-hidden="true">
                  <span style={{ '--share': `${share}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card as="section" padding="lg" aria-labelledby="budget-days-title">
        <h3 id="budget-days-title">By day</h3>
        {perDay.length === 0 && <p className="text-muted">Day totals appear once you generate a plan.</p>}
        <table className="budget-breakdown__days">
          <thead className="visually-hidden">
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Estimated cost</th>
            </tr>
          </thead>
          <tbody>
            {perDay.map((day) => (
              <tr key={day.day_number}>
                <th scope="row">
                  Day {day.day_number} <span className="text-muted">· {formatShortDay(day.date)}</span>
                </th>
                <td>{formatCurrency(day.amount)}</td>
              </tr>
            ))}
            {notByDay > 0 && (
              <tr>
                <th scope="row">Not on a day</th>
                <td>{formatCurrency(notByDay)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{formatCurrency(total)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}
