/** Display helpers shared by trip pages. */

/** "Nov 5 – Nov 8, 2026". Dates come from the API as YYYY-MM-DD. */
export function formatDateRange(start, end) {
  const s = new Date(`${start}T00:00`);
  const e = new Date(`${end}T00:00`);
  const short = { month: 'short', day: 'numeric' };
  const startText = s.toLocaleDateString(undefined, short);
  const endText = e.toLocaleDateString(undefined, { ...short, year: 'numeric' });
  return start === end ? endText : `${startText} – ${endText}`;
}

/** Number of days in a trip, counting both ends. */
export function tripLength(start, end) {
  const ms = new Date(`${end}T00:00`) - new Date(`${start}T00:00`);
  return Math.round(ms / 86_400_000) + 1;
}

/** Budget amounts (always USD, A2): "$1,320", or "$45.50" when there are cents. */
export function formatCurrency(amount) {
  const digits = Math.round(amount * 100) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

export function formatBudget(amount) {
  if (amount == null) return 'No budget set';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}
