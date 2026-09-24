import { passwordStrength } from '../lib/validation';
import './PasswordStrength.css';

/** Live strength meter shown under a password field. */
export default function PasswordStrength({ password, id }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;

  return (
    <div className={`pw-strength pw-strength--${score}`} id={id}>
      <div className="pw-strength__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= score ? 'is-on' : ''} />
        ))}
      </div>
      <p className="pw-strength__label" aria-live="polite">
        Password strength: <strong>{label}</strong>
      </p>
    </div>
  );
}
