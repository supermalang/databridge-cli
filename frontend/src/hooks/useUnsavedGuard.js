import { useEffect } from 'react';
import { useDirtyRef } from '../lib/dirty.js';

// Warn before unsaved edits are lost. Covers two paths:
//  1. Browser close/refresh/navigate-away via `beforeunload`.
//  2. In-app tab / project switch — publishes `dirty` into the shared DirtyRef
//     so the shell (App) can confirm before discarding.
// No-op for #1 when `dirty` is false; the ref is always kept in sync.
export function useUnsavedGuard(dirty) {
  const dirtyRef = useDirtyRef();

  useEffect(() => {
    dirtyRef.current = dirty;
    return () => { dirtyRef.current = false; };
  }, [dirty, dirtyRef]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
