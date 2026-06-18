// Shares the single useCommand instance from App (its run + running + activeCmd) with
// any tab that needs to trigger a pipeline command and stream into the shared
// BottomTerminal. Mirrors the PermsProvider pattern in lib/perms.js.
import { createContext, useContext } from 'react';

const RunContext = createContext({
  run: async () => {},
  stop: async () => {},
  running: false,
  activeCmd: null,
});

export const RunProvider = RunContext.Provider;

export function useRun() {
  return useContext(RunContext);
}
