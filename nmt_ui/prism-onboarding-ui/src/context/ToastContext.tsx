import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  autoDismiss: boolean;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string, autoDismiss?: boolean) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// This module intentionally exports both the provider component and the
// useToast hook so consumers have a single import site; that trips the
// react-refresh "only-export-components" HMR lint rule, which is dev-only.
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};

const TYPE_CONFIG: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: { bg: 'bg-success', icon: 'check_circle', border: 'border-success' },
  error: { bg: 'bg-danger', icon: 'error', border: 'border-danger' },
  warning: { bg: 'bg-warning', icon: 'warning', border: 'border-warning' },
  info: { bg: 'bg-info', icon: 'info', border: 'border-info' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const idRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, autoDismiss = true) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, type, message, autoDismiss }]);
    if (autoDismiss) {
      setTimeout(() => removeToast(id), 5000);
    }
  }, [removeToast]);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ ...options, resolve });
    });
  }, []);

  const handleConfirmResponse = (accepted: boolean) => {
    confirmState?.resolve(accepted);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={{ addToast, confirm }}>
      {children}

      {/* Toast container */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400 }}>
        {toasts.map(toast => {
          const cfg = TYPE_CONFIG[toast.type];
          return (
            <div
              key={toast.id}
              className={`d-flex align-items-start gap-2 p-3 rounded-3 shadow border ${cfg.border} bg-white`}
              style={{ animation: 'slideInRight 0.3s ease-out', minWidth: 280 }}
            >
              <i className={`material-icons-outlined ${cfg.bg.replace('bg-', 'text-')}`} style={{ fontSize: 20, marginTop: 1 }}>
                {cfg.icon}
              </i>
              <div className="flex-grow-1 small" style={{ lineHeight: 1.4 }}>{toast.message}</div>
              <button
                className="btn-close"
                style={{ fontSize: 10, marginTop: 2 }}
                onClick={() => removeToast(toast.id)}
                aria-label="Close"
              />
            </div>
          );
        })}
      </div>

      {/* Confirm modal */}
      {confirmState && (
        <>
          <div className="modal-backdrop show" style={{ zIndex: 10000 }} />
          <div className="modal d-block" tabIndex={-1} style={{ zIndex: 10001 }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content rounded-4 shadow border-0">
                <div className="modal-header border-0 pb-0">
                  <h5 className="modal-title d-flex align-items-center gap-2">
                    <i className={`material-icons-outlined text-${confirmState.variant || 'danger'}`} style={{ fontSize: 22 }}>
                      {confirmState.variant === 'warning' ? 'warning' : confirmState.variant === 'primary' ? 'help' : 'error'}
                    </i>
                    {confirmState.title}
                  </h5>
                  <button type="button" className="btn-close" onClick={() => handleConfirmResponse(false)} />
                </div>
                <div className="modal-body pt-2">
                  <p className="text-muted mb-0">{confirmState.message}</p>
                </div>
                <div className="modal-footer border-0 pt-0">
                  <button className="btn btn-light rounded-3" onClick={() => handleConfirmResponse(false)}>
                    {confirmState.cancelLabel || 'Cancel'}
                  </button>
                  <button
                    className={`btn btn-${confirmState.variant || 'danger'} rounded-3`}
                    onClick={() => handleConfirmResponse(true)}
                  >
                    {confirmState.confirmLabel || 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
};
