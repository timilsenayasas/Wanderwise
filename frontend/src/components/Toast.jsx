/**
 * App-wide toast notifications.
 *
 *   const toast = useToast();
 *   toast.success('Trip saved!');
 *   toast.error('Could not save trip');
 *   toast.info('Heads up…');
 *
 * Toasts are announced to screen readers via a live region and can be
 * dismissed with the close button. They auto-hide after a few seconds.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import './Toast.css';

const ToastContext = createContext(null);
const DURATION_MS = 5000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message, type = 'info') => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, type }]);
      setTimeout(() => dismiss(id), DURATION_MS);
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      show,
      dismiss,
      success: (msg) => show(msg, 'success'),
      error: (msg) => show(msg, 'error'),
      info: (msg) => show(msg, 'info'),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications">
        {/* Separate polite/assertive live regions so errors interrupt, others don't. */}
        <div aria-live="polite" className="toast-stack">
          {toasts
            .filter((t) => t.type !== 'error')
            .map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
        </div>
        <div aria-live="assertive" className="toast-stack">
          {toasts
            .filter((t) => t.type === 'error')
            .map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

const ICONS = { success: '✓', error: '!', info: 'i' };

function ToastItem({ toast, onDismiss }) {
  return (
    <div className={`toast toast--${toast.type}`}>
      <span className="toast__icon" aria-hidden="true">
        {ICONS[toast.type]}
      </span>
      <p className="toast__message">{toast.message}</p>
      <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
