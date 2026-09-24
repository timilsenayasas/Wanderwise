import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from './Spinner';

/**
 * Wrap routes that need a logged-in user. Logged-out visitors are sent to
 * /login, which sends them back here after they sign in.
 *
 *   <Route element={<ProtectedRoute />}>
 *     <Route path="/trips" element={<MyTrips />} />
 *   </Route>
 */
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="page-loading">
        <Spinner size="lg" label="Checking your session…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children ?? <Outlet />;
}

/**
 * The opposite: for Login. Logged-in users are sent to /home, or back to the
 * protected page that bounced them to /login.
 */
export function GuestRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="page-loading">
        <Spinner size="lg" label="Checking your session…" />
      </div>
    );
  }

  if (user) return <Navigate to={location.state?.from?.pathname || '/home'} replace />;

  return children ?? <Outlet />;
}
