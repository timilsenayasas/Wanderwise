import './Spinner.css';

/**
 * Loading indicator.
 *   <Spinner />                      inline, announces "Loading…"
 *   <Spinner size="lg" label="Loading your trips" />
 *   <Spinner decorative />           inside a button that already says what's happening
 */
export default function Spinner({ size = 'md', label = 'Loading…', decorative = false, className = '' }) {
  return (
    <span
      className={`spinner spinner--${size} ${className}`}
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative || undefined}
    >
      {!decorative && <span className="visually-hidden">{label}</span>}
    </span>
  );
}
