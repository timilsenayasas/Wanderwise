import { Link } from 'react-router-dom';
import Spinner from './Spinner';
import './Button.css';

/**
 * Shared button. Renders a <Link> when given `to`, otherwise a <button>.
 *
 *   <Button onClick={save}>Save</Button>
 *   <Button variant="accent" size="lg" to="/trips/new">Plan a trip</Button>
 *   <Button type="submit" loading={submitting} loadingText="Saving…">Save</Button>
 *
 * variant: primary (navy) | accent (sunset) | secondary (outline) | ghost
 * size:    sm | md | lg
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  fullWidth = false,
  to,
  type = 'button',
  className = '',
  children,
  disabled,
  ...props
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    fullWidth && 'btn--full',
    loading && 'btn--loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size="sm" decorative />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}
