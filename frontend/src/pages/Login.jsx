/* S1 Login (user story R2). */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import AuthLayout from '../components/AuthLayout';
import Button from '../components/Button';
import Input from '../components/Input';
import { validateEmail, validatePassword } from '../lib/validation';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fieldRefs = { email: useRef(null), password: useRef(null) };
  const alertRef = useRef(null);

  function handleChange(e) {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((errs) => ({ ...errs, [name]: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError('');

    const nextErrors = {
      email: validateEmail(values.email),
      // Don't enforce length on login — just require something.
      password: validatePassword(values.password, { checkLength: false }),
    };
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors).find((k) => nextErrors[k]);
    if (firstInvalid) {
      fieldRefs[firstInvalid].current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const user = await login(values.email.trim(), values.password);
      toast.success(`Welcome back, ${user.name}!`);
      // <GuestRoute> redirects to /home (or the page they came from) once user is set.
    } catch (err) {
      setServerError(err.status === 401 ? 'Incorrect email or password. Please try again.' : err.message);
      setSubmitting(false);
      // Move focus to the error so screen reader users hear it.
      setTimeout(() => alertRef.current?.focus(), 0);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to pick up where you left off."
      panelQuote="Your next trip is waiting."
      footer={
        <>
          New to WanderWise? <Link to="/register">Create an account</Link>
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
        />
        <Input
          ref={fieldRefs.password}
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={handleChange}
          error={errors.password}
          required
        />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} loadingText="Logging in…">
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
