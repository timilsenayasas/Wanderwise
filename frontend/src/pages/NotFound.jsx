import EmptyState from '../components/EmptyState';
import Button from '../components/Button';

export default function NotFound() {
  return (
    <div className="page container">
      <EmptyState
        headingLevel={1}
        title="Looks like you took a wrong turn"
        description="We couldn't find that page. Let's get you back on the route."
        action={<Button to="/">Back to start</Button>}
      />
    </div>
  );
}
