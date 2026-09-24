import { useId, useState } from 'react';
import './Input.css';

/**
 * Labeled input with inline error + optional hint.
 * Password inputs get a Show/Hide toggle automatically.
 *
 *   <Input label="Email" type="email" name="email" value={email}
 *          onChange={(e) => setEmail(e.target.value)} error={errors.email} />
 *
 * Any extra props (autoComplete, required, ref, …) go straight to the <input>.
 */
export default function Input({ label, error, hint, id, type = 'text', className = '', children, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`}>
      <label htmlFor={inputId} className="field__label">
        {label}
      </label>
      <div className="field__control">
        <input
          id={inputId}
          type={isPassword && showPassword ? 'text' : type}
          className="field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            className="field__toggle"
            onClick={() => setShowPassword((s) => !s)}
            aria-pressed={showPassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} className="field__error">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M8 4.5v4M8 11v.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
