/* S2 Register (user story R1). */
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import Button from '../components/Button';
import Input from '../components/Input';
import PasswordStrength from '../components/PasswordStrength';
import Spinner from '../components/Spinner';
import { validateEmail, validateName, validatePassword, MIN_PASSWORD_LENGTH } from '../lib/validation';
import './Register.css';

const SUCCESS_DELAY_MS = 1800;

export default function Register() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  // idle -> submitting -> success. While not idle we handle navigation ourselves
  // so the success screen can show before heading to Home.
  const [status, setStatus] = useState('idle');
  const fieldRefs = { name: useRef(null), email: useRef(null), password: useRef(null) };
  const alertRef = useRef(null);

  useEffect(() => {
    if (status !== 'success') return undefined;
    const t = setTimeout(() => navigate('/home', { replace: true }), SUCCESS_DELAY_MS);
    return () => clearTimeout(t);
  }, [status, navigate]);

  if (loading) {
    return (
      <div className="page-loading">
        <Spinner size="lg" label="Checking your session…" />
      </div>
    );
  }
  // Already logged in and not mid-registration -> go Home.
  if (user && status === 'idle') return <Navigate to="/home" replace />;

  function handleChange(e) {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((errs) => ({ ...errs, [name]: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError('');

    const nextErrors = {
      name: validateName(values.name),
      email: validateEmail(values.email),
      password: validatePassword(values.password),
    };
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors).find((k) => nextErrors[k]);
    if (firstInvalid) {
      fieldRefs[firstInvalid].current?.focus();
      return;
    }

    setStatus('submitting');
    try {
      await register({ name: values.name.trim(), email: values.email.trim(), password: values.password });
      setStatus('success');
    } catch (err) {
      setStatus('idle');
      if (err.status === 409) {
        setErrors((errs) => ({ ...errs, email: err.message }));
        fieldRefs.email.current?.focus();
      } else {
        setServerError(err.message);
        setTimeout(() => alertRef.current?.focus(), 0);
      }
    }
  }

  if (status === 'success') {
    return (
      <AuthLayout title="You're all set!" panelQuote="Bon voyage!">
        <div className="register-success" role="status">
          <div className="register-success__badge" aria-hidden="true">
            <svg viewBox="0 0 80 80" width="80" height="80">
              <circle cx="40" cy="40" r="36" fill="#0f766e" />
              <path className="register-success__check" d="M24 41 l11 11 l21 -23" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="register-success__text">
            Welcome aboard, <strong>{values.name.trim()}</strong>. Your passport to smarter trips is ready.
          </p>
          <p className="text-muted">Taking you to your dashboard…</p>
          <Button to="/home" variant="accent">
            Go now
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Free forever. Start planning your first trip in under a minute."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {serverError && (
          <p className="form-alert" role="alert" tabIndex={-1} ref={alertRef}>
            {serverError}
          </p>
        )}
        <Input
          ref={fieldRefs.name}
          label="Name"
          name="name"
          autoComplete="name"
          placeholder="What should we call you?"
          value={values.name}
          onChange={handleChange}
          error={errors.name}
          required
        />
        <Input
          ref={fieldRefs.email}
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={handleChange}
          error={errors.email}
          required
        >
          {errors.email?.includes('already registered') && (
            <p className="field__hint">
              <Link to="/login">Log in instead?</Link>
            </p>
          )}
        </Input>
        <Input
          ref={fieldRefs.password}
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Longer is stronger.`}
          value={values.password}
          onChange={handleChange}
          error={errors.password}
          required
        >
          <PasswordStrength password={values.password} />
        </Input>
        <Button
          type="submit"
          variant="accent"
          size="lg"
          fullWidth
          loading={status === 'submitting'}
          loadingText="Creating your account…"
        >
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
