import './EmptyState.css';

/**
 * Friendly "nothing here yet" block.
 *   <EmptyState title="No saved trips yet" description="…" action={<Button to="/trips/new">Plan one</Button>} />
 *   <EmptyState illustration="construction" title="Under construction" />
 */
export default function EmptyState({ title, description, action, illustration = 'suitcase', headingLevel = 2 }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className="empty-state">
      <div className="empty-state__art" aria-hidden="true">
        {illustration === 'construction' ? <ConstructionArt /> : <SuitcaseArt />}
      </div>
      <Heading className="empty-state__title">{title}</Heading>
      {description && <p className="empty-state__desc">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

function SuitcaseArt() {
  return (
    <svg viewBox="0 0 200 140" width="200" height="140">
      <ellipse cx="100" cy="128" rx="70" ry="8" fill="#f4e9d8" />
      <circle cx="152" cy="34" r="16" fill="#f29f4b" opacity="0.85" />
      <path d="M20 40 q20 -18 40 0 t40 0" stroke="#e8683f" strokeWidth="2" strokeDasharray="3 6" fill="none" strokeLinecap="round" />
      <g className="empty-state__bob">
        <rect x="80" y="36" width="40" height="18" rx="8" fill="none" stroke="#1f3864" strokeWidth="5" />
        <rect x="52" y="50" width="96" height="72" rx="14" fill="#1f3864" />
        <rect x="52" y="74" width="96" height="10" fill="#e8683f" />
        <circle cx="72" cy="122" r="5" fill="#172b4f" />
        <circle cx="128" cy="122" r="5" fill="#172b4f" />
        <rect x="112" y="92" width="24" height="16" rx="3" fill="#fbf5ec" transform="rotate(-8 124 100)" />
      </g>
    </svg>
  );
}

function ConstructionArt() {
  return (
    <svg viewBox="0 0 200 140" width="200" height="140">
      <ellipse cx="100" cy="128" rx="70" ry="8" fill="#f4e9d8" />
      <path d="M100 24 L150 120 H50 Z" fill="#f29f4b" />
      <path d="M100 24 L150 120 H50 Z" fill="none" stroke="#1f3864" strokeWidth="4" strokeLinejoin="round" />
      <rect x="66" y="92" width="68" height="10" fill="#1f3864" />
      <rect x="75" y="72" width="50" height="8" fill="#1f3864" />
      <g className="empty-state__bob">
        <path d="M150 40 l14 -8 l4 7 l-14 8 z" fill="#e8683f" />
        <circle cx="40" cy="40" r="10" fill="none" stroke="#e8683f" strokeWidth="3" strokeDasharray="4 4" />
      </g>
    </svg>
  );
}
