// Role-based UI gating. The backend is the real authority (every mutating endpoint
// is gated server-side); this only hides/disables controls the caller can't use.
import { createContext, useContext } from 'react';

export const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, superadmin: 4 };

export function roleAtLeast(role, minimum) {
  if (!role) return false;
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minimum] || 99);
}

// PermsContext carries the caller's role on the ACTIVE project + global superadmin flag.
const PermsContext = createContext({ role: null, isSuperadmin: false });

export const PermsProvider = PermsContext.Provider;

export function usePerms() {
  const { role, isSuperadmin } = useContext(PermsContext);
  return {
    role,
    isSuperadmin,
    canEdit: roleAtLeast(role, 'editor'),   // edit config, run pipeline, delete own outputs
    canAdmin: roleAtLeast(role, 'admin'),   // manage members, delete project/templates/periods
  };
}
