import Card from './Card';
import { formatCurrency } from '../lib/format';
import './BudgetStatus.css';

/**
 * A3: the trip's estimated total, labeled as an estimate.
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
    </Card>
  );
}
