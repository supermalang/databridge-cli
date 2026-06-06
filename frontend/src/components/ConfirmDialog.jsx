import { useCallback, useState } from 'react';
import Modal from './Modal.jsx';

// Promise-based confirmation built on the accessible Modal — a styled,
// keyboard-trapping replacement for the native window.confirm().
//
//   const { confirm, confirmDialog } = useConfirm();
//   if (!await confirm({ title: 'Delete?', message: '…' })) return;
//   …
//   return (<>…{confirmDialog}</>);
export function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setState({ confirmLabel: 'Delete', danger: true, ...opts, resolve });
  }), []);

  const close = (result) => {
    setState((s) => { s?.resolve(result); return null; });
  };

  const confirmDialog = state ? (
    <Modal
      title={state.title}
      danger={state.danger}
      saveLabel={state.confirmLabel}
      width={state.width || 420}
      onClose={() => close(false)}
      onSave={() => close(true)}
    >
      <p style={{ color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>{state.message}</p>
    </Modal>
  ) : null;

  return { confirm, confirmDialog };
}
