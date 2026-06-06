import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

// Module-level stack so nested modals behave: only the topmost dialog responds
// to Escape and traps focus, and scroll stays locked until the last one closes.
const modalStack = [];

// Reusable accessible modal. Click backdrop or press Esc to dismiss.
// Traps focus while open, restores focus to the trigger on close, and locks
// background scroll. Pass `danger` to style the primary action as destructive.
export default function Modal({ title, onClose, onSave, saveLabel = 'Save', danger = false, children, width = 520 }) {
  const dialogRef = useRef(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    const token = {};
    modalStack.push(token);
    const isTop = () => modalStack[modalStack.length - 1] === token;

    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog (first focusable, else the dialog itself).
    const node = dialogRef.current;
    const first = node?.querySelector(FOCUSABLE);
    (first || node)?.focus();

    const onKey = (e) => {
      if (!isTop()) return;   // only the topmost modal handles keys
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const idx = modalStack.indexOf(token);
      if (idx !== -1) modalStack.splice(idx, 1);
      if (modalStack.length === 0) document.body.style.overflow = prevOverflow;
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h3 id={titleId.current}>{title}</h3>
          <button onClick={onClose} aria-label="Close dialog">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          {onSave && (
            <button className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onSave}>{saveLabel}</button>
          )}
        </div>
      </div>
    </div>
  );
}
