/**
 * Auth state for the whole app.
 *
 * On first load we ask the server who we are (GET /api/auth/me). The session
 * itself lives in an httpOnly cookie the browser manages — we never touch the
 * token in JavaScript and never store it in localStorage.
 *
 *   const { user, loading, login, register, logout } = useAuth();
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/me')
      .then((me) => !cancelled && setUser(me))
      .catch((err) => {
        // 401 just means "not logged in". Anything else is logged for debugging.
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
        if (!cancelled) setUser(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const me = await api.post('/auth/login', { email, password });
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async ({ name, email, password }) => {
    const me = await api.post('/auth/register', { name, email, password });
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// Exported so tests can render components with a fake auth state.
export { AuthContext };
