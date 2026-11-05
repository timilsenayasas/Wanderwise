import Card from './Card';
import Icon from './Icon';
import { formatCurrency } from '../lib/format';
import './BudgetStatus.css';

/**
 * A3: the trip's estimated total, labeled as an estimate, and how it compares to the budget.
 *   <BudgetStatus budget={budget} />   // budget = GET /trips/{id}/budget
 */
export default function BudgetStatus({ budget }) {
  return (
    <Card padding="lg" className="budget-status">
      <div className="budget-status__total">
        <span className="budget-status__label">Estimated total</span>
        <span className="budget-status__amount">{formatCurrency(budget.total)}</span>
        <span className="budget-status__note">Estimated costs in {budget.currency}. Actual prices may vary.</span>
      </div>
      <Comparison budget={budget} />
    </Card>
  );
}

/**
 * Over budget is an alert, so it's announced as soon as a change tips the trip over.
 * The other messages are a polite status, announced after a change without interrupting.
 * Each one has an icon and words as well as its color.
 */
function Comparison({ budget }) {
  const { budget: limit, remaining, over_budget: over, total } = budget;

  if (limit == null) {
    return (
      <div className="budget-status__message" role="status">
        <Icon name="wallet" />
        <p>This trip has no budget yet. Once it has one, you&apos;ll see here how your estimate compares.</p>
      </div>
    );
  }

  if (over) {
    return (
      <div className="budget-status__message budget-status__message--over" role="alert">
        <Icon name="alert" />
        <p>
          <strong>Over budget by {formatCurrency(-remaining)}</strong> (budget {formatCurrency(limit)}, estimate{' '}
          {formatCurrency(total)})
        </p>
      </div>
    );
  }

  return (
    <div className="budget-status__message budget-status__message--under" role="status">
      <Icon name="check" />
      {remaining === 0 ? (
        <p>
          <strong>Right on budget:</strong> your estimate is exactly your {formatCurrency(limit)} budget.
        </p>
      ) : (
        <p>
          <strong>{formatCurrency(remaining)} left</strong> of your {formatCurrency(limit)} budget
        </p>
      )}
    </div>
  );
}
