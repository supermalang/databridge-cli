import { useEffect } from 'react';

// Reusable modal overlay. Click backdrop or press Esc to dismiss.
export default function Modal({ title, onClose, onSave, saveLabel = 'Save', children, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width }}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          {onSave && <button className="btn btn-primary btn-sm" onClick={onSave}>{saveLabel}</button>}
        </div>
      </div>
    </div>
  );
}
