// PERF-4 — Client-side stale-while-revalidate (SWR) cache.
//
// Goal: make hard reloads / cold starts / project switches paint INSTANTLY by
// serving the last-known response, then revalidating in the background. The
// skeleton only shows on a true cold miss.
//
// Two tiers, split by data sensitivity — localStorage is readable by any XSS, so
// secrets/PII must never be persisted:
//
//   • Persisted tier (localStorage, per-project namespace): only small,
//     non-sensitive metadata whose endpoint is on PERSIST_WHITELIST. Survives a
//     hard reload.
//   • In-memory tier only (never written to disk): everything else — notably
//     /api/config (carries a token), /api/profile and /api/data-quality (column
//     stats can expose real data values). Instant within a session, gone on reload.
//
// Entries are namespaced per active project, carry a CACHE_VERSION (a bump
// retires schema-mismatched entries), and a TTL backstop prevents an
// indefinitely-stale value from ever being served.

// Bump this when the cached payload SHAPE changes so old entries are ignored.
const CACHE_VERSION = 'v1';

// TTL backstop: an entry older than this is treated as a cold miss (still
// revalidated, but never painted as "fresh"). Keeps a forgotten tab from
// serving stale data forever.
const TTL_MS = 24 * 60 * 60 * 1000;   // 24h

// localStorage key prefix for every persisted entry.
const STORE_PREFIX = `databridge:cache:${CACHE_VERSION}:`;

// ONLY these endpoints may be written to disk. Everything else is in-memory
// only. Match is by the request key starting with one of these paths, so query
// strings (e.g. /api/questions?foo=bar) are covered too. Keep this list tight —
// it is the security boundary: a token/PII endpoint must NEVER appear here.
const PERSIST_WHITELIST = [
  '/api/state',
  '/api/questions',
  '/api/templates',
  '/api/reports',
  '/api/data/sessions',
  '/api/periods',
];

// In-memory tier: namespace -> Map(key -> { value, ts }). Never serialized.
const memory = new Map();

// Last fetcher seen per (namespace, key) — lets the cache revalidate a persisted
// entry itself on a data change, write-through with the fresh value, so the next
// read/reload serves up-to-date data and never the stale value. Fetchers are
// in-memory function refs (never serialized).
const fetchers = new Map();   // `${ns}::${key}` -> fetcher

// The active-project namespace. Entries are stored under this so project B never
// sees project A's data. `__none` until App sets a real project.
let activeProject = '__none';

function nsMap(ns) {
  let m = memory.get(ns);
  if (!m) { m = new Map(); memory.set(ns, m); }
  return m;
}

// Whether a request key is allowed on disk (persist whitelist). The whitelist is
// the only thing that may be persisted — a value being non-sensitive is not
// enough; its endpoint must be explicitly listed.
function isPersistable(key) {
  return PERSIST_WHITELIST.some((p) => key === p || key.startsWith(p + '?') || key.startsWith(p + '/'));
}

function storeKey(ns, key) {
  return `${STORE_PREFIX}${ns}::${key}`;
}

// Read a fresh-enough entry for (ns, key): in-memory first, then (if persistable)
// localStorage. Returns the cached value, or undefined on a cold/expired miss.
function readEntry(ns, key) {
  const mem = nsMap(ns).get(key);
  if (mem && (Date.now() - mem.ts) < TTL_MS) return mem.value;

  if (isPersistable(key)) {
    try {
      const raw = localStorage.getItem(storeKey(ns, key));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (Date.now() - parsed.ts) < TTL_MS) {
          // Re-seed memory so subsequent reads in this session are sync.
          nsMap(ns).set(key, parsed);
          return parsed.value;
        }
      }
    } catch { /* corrupt / quota — treat as a miss */ }
  }
  return undefined;
}

// Write a value for (ns, key): always to memory; to disk ONLY if the endpoint is
// whitelisted (the sensitivity gate).
function writeEntry(ns, key, value) {
  const entry = { value, ts: Date.now() };
  nsMap(ns).set(key, entry);
  if (isPersistable(key)) {
    try { localStorage.setItem(storeKey(ns, key), JSON.stringify(entry)); }
    catch { /* quota / disabled storage — memory tier still holds it */ }
  }
}

// Set the active project namespace. Called by App on load + project switch BEFORE
// the panes remount, so each project's reads/writes land in its own namespace and
// switching back to a previously-loaded project is an instant cache hit.
export function setActiveProject(id) {
  activeProject = id || '__none';
}

// Clear cache entries.
//   clearCache()                 → wipe EVERYTHING (in-memory + all persisted).
//   clearCache({ project: id })  → wipe just that project's namespace.
//   clearCache({ project: 'active' }) → wipe the active project's namespace.
export function clearCache(scope) {
  if (!scope) {
    memory.clear();
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORE_PREFIX)) kill.push(k);
      }
      kill.forEach((k) => localStorage.removeItem(k));
    } catch { /* storage unavailable */ }
    return;
  }
  const ns = scope.project === 'active' || scope.project === undefined ? activeProject : scope.project;
  memory.delete(ns);
  try {
    const prefix = storeKey(ns, '');
    const kill = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) kill.push(k);
    }
    kill.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}

// Stale-while-revalidate. `key` identifies the resource (use the request path).
// `fetcher` returns a Promise of the value to cache. `onData(value)` is invoked
// with the cached value immediately (if any), and again with the revalidated
// value once the network resolves (if it differs / had no cache). Returns the
// final (revalidated) value.
//
// The caller renders from `onData`: a cache hit paints before the network, a cold
// miss falls through to the normal fetch (skeleton → content).
export async function swr(key, fetcher, onData) {
  const ns = activeProject;
  fetchers.set(`${ns}::${key}`, fetcher);   // remember for event-driven revalidation
  const cached = readEntry(ns, key);
  const hadCache = cached !== undefined;
  if (hadCache && typeof onData === 'function') onData(cached);

  // Always revalidate in the background (stale-while-revalidate).
  const fresh = await fetcher();
  writeEntry(ns, key, fresh);
  if (typeof onData === 'function') onData(fresh);
  return fresh;
}

// Revalidate every known PERSISTED entry for the active project: re-run its last
// fetcher and write the fresh value through. Fired on a data change so a hard
// reload right after serves the up-to-date value (not the stale one) from disk.
// Starts the fetches immediately (synchronously from the event handler), as early
// as possible, so the write-through lands before any subsequent reload.
function revalidateActivePersisted() {
  const ns = activeProject;
  const prefix = `${ns}::`;
  for (const [k, fetcher] of fetchers) {
    if (!k.startsWith(prefix)) continue;
    const key = k.slice(prefix.length);
    if (!isPersistable(key)) continue;
    Promise.resolve()
      .then(() => fetcher())
      .then((fresh) => writeEntry(ns, key, fresh))
      .catch(() => { /* leave the cleared (cold) state — next read re-fetches */ });
  }
}

// Self-register: when the underlying data changes (post-download / config save /
// questions save), the ACTIVE project's cache is invalidated so a stale value is
// never served after the data moved on.
//
// A PROJECT SWITCH also dispatches databridge:data-changed, but it carries
// `detail.project` and must NOT invalidate — switching back to a previously
// loaded project has to be an instant cache hit. App calls setActiveProject()
// for switches; only non-switch data changes clear the cache here.
if (typeof window !== 'undefined') {
  window.addEventListener('databridge:data-changed', (e) => {
    if (e && e.detail && e.detail.project) return;   // project switch — keep caches
    // Clear immediately so a stale value can never be served, then revalidate the
    // persisted entries write-through so a reload right after serves fresh data.
    clearCache({ project: 'active' });
    revalidateActivePersisted();
  });
}

export { CACHE_VERSION, PERSIST_WHITELIST, TTL_MS };
