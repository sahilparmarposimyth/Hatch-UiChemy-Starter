import React from 'react';
import * as Icon from './icons.jsx';

/**
 * Single in-flight notification. App.jsx owns the `toast` state and
 * renders <Toast /> at the root; falsy `toast` renders nothing.
 *
 * Shape: { message: string, variant: 'success' | 'error' | 'info' }
 */
export default function Toast({ toast }) {
  if (!toast) return null;

  const variant = toast.variant || 'success';
  const IconEl =
    variant === 'error' ? Icon.InfoBare  :
    variant === 'info'  ? Icon.Info  :
                          Icon.Check;

  return (
    <div className={`nd-toast nd-toast--${variant}`} role="status" aria-live="polite">
      <span className="nd-toast__icon"><IconEl size={13}/></span>
      <span className="nd-toast__msg">{toast.message}</span>
    </div>
  );
}
