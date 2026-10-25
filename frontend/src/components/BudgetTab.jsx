/*
 * A3 Budget tab: the trip's costs from GET /trips/{id}/budget (A2).
 * Loads when the tab opens. load({ quiet: true }) refreshes without the spinner,
 * for reloading the totals after a cost line changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import BudgetBreakdown from './BudgetBreakdown';
import BudgetStatus from './BudgetStatus';
import Button from './Button';
import Card from './Card';
import Spinner from './Spinner';
import './BudgetTab.css';

export default function BudgetTab({ trip }) {
  const [budget, setBudget] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState('');
  const latestRequest = useRef(0);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const request = ++latestRequest.current;
      if (!quiet) setStatus('loading');
      try {
        const data = await api.get(`/trips/${trip.id}/budget`);
        if (request !== latestRequest.current) return; // a newer load, or the tab closed
        setBudget(data);
        setStatus('ready');
      } catch (err) {
        if (request !== latestRequest.current) return;
        setLoadError(err.message || 'Could not load the budget.');
        setStatus('error');
      }
    },
    [trip.id],
  );

  useEffect(() => {
    load();
    return () => {
      latestRequest.current++; // ignore a response that arrives after the tab closes
    };
  }, [load]);

  if (status === 'loading') {
    return (
      <div className="budget-tab__loading">
        <Spinner size="lg" label="Loading your budget" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <Card padding="lg" className="budget-tab__error">
        <p role="alert">{loadError}</p>
        <div>
          <Button variant="secondary" onClick={() => load()}>
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <section className="budget-tab" aria-labelledby="budget-title">
      <h2 id="budget-title">Budget</h2>
      <BudgetStatus budget={budget} />
      <BudgetBreakdown budget={budget} />
    </section>
  );
}
