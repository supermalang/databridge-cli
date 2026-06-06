import { useEffect } from 'react';

// Warn before the page is closed/refreshed/navigated-away while there are
// unsaved edits. Browsers show their own generic prompt; the returned string is
// required by some engines but not displayed. No-op when `dirty` is false.
export function useUnsavedGuard(dirty) {
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
