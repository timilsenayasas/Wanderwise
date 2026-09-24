import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';

/**
 * Shared scaffold for pages that teammates haven't built yet.
 * Delete the <UnderConstruction> usage in a page when you start work on it.
 */
export default function UnderConstruction({ screen, title, description, features, children }) {
  return (
    <div className="page container">
      <header className="page-header fade-up">
        <span className="eyebrow">{screen}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
      <Card padding="lg" className="fade-up">
        <EmptyState
          illustration="construction"
          title="Under construction"
          description={`This screen is being built. Planned features: ${features}.`}
          action={
            <Button to="/home" variant="secondary">
              Back to home
            </Button>
          }
        />
      </Card>
    </div>
  );
}
