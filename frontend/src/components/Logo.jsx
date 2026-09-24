import './Logo.css';

/** WanderWise wordmark: a little sun setting over a dotted route. */
export default function Logo({ className = '' }) {
  return (
    <span className={`logo ${className}`}>
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#1f3864" />
        <circle cx="22" cy="12" r="4.5" fill="#f29f4b" />
        <path d="M5 23 C11 15, 17 26, 27 17" stroke="#fbf5ec" strokeWidth="2.2" strokeDasharray="1 3.5" strokeLinecap="round" fill="none" />
      </svg>
      <span className="logo__text">
        Wander<span className="logo__accent">Wise</span>
      </span>
    </span>
  );
}
