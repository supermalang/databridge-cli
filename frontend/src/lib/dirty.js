import { createContext, useContext } from 'react';

// Shared mutable ref tracking whether the active page has unsaved edits, so the
// shell (App) can warn before a tab switch / project switch discards them.
// Mirrors the RunProvider / PermsProvider pattern. Value is a React ref object
// ({ current: boolean }); pages write to it via useUnsavedGuard.
const DirtyContext = createContext({ current: false });

export const DirtyProvider = DirtyContext.Provider;

export function useDirtyRef() {
  return useContext(DirtyContext);
}
