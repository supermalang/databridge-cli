# Zitadel Login Gate — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — ready for implementation plan
**Slice:** 1 of a larger multi-tenant SaaS re-platforming (see "Context" below)

---

## Context

databridge-cli is today a **local, single-user tool**: one `config.yml` at the repo
root, one set of working directories (`data/`, `reports/`, `templates/`), CLI commands
that operate on those globals, and a FastAPI backend ([web/main.py](../../../web/main.py))
that runs the CLI as single-flight subprocesses and serves the built React app. There is
**no authentication** — nothing guards `/api/*`.

The user wants to move toward a **multi-tenant SaaS** deployment backed by:
- **Postgres** — application state (users, orgs, projects, per-project config, sessions/runs)
- **Zitadel** — identity provider (login / SSO)
- **Minio** — S3-compatible object storage for files (reports, charts, data, templates)

This is a **re-platforming**, not a feature add, so it is decomposed into thin vertical
slices, each its own spec → plan → implementation cycle:

1. **Zitadel login gate** *(this spec)* — gate the existing single-config app behind
   login. Independent of the pipeline; ships value immediately; prerequisite for all
   tenant-scoping.
2. **Postgres project model** — users ↔ orgs ↔ projects; migrate `config.yml` into a
   per-project config row + session/run metadata.
3. **Per-job temp-workspace runner + Minio** — each run hydrates a throwaway working dir
   (`config.yml` + inputs from Postgres/Minio), runs the existing pipeline unchanged, then
   ships outputs back to Minio under per-tenant/project prefixes.

**Decided execution model (for later slices):** per-job temp workspace — wrap the existing
CLI rather than rewrite `src/`.

This spec covers **only Slice 1**.

---

## Goal

Add an authentication layer so that, when Zitadel is configured, every API request must
carry a valid login session; when it is not configured (local dev), the app runs exactly
as it does today. No multi-tenant data model, no per-user data isolation — the app still
operates on the single shared `config.yml`. This slice only *gates access*.

### Non-goals (deferred to later slices)
- Multi-tenant data model; mapping Zitadel users/orgs → app tenants/projects.
- Per-user data isolation; authorization beyond "is this a logged-in user".
- Postgres or Minio dependencies.
- Server-side session store / instant revocation.

---

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Deployment target (overall) | Multi-tenant SaaS | User-stated direction |
| Execution isolation (later slices) | Per-job temp workspace | Minimal CLI rewrite; reuse existing code paths |
| First slice | Zitadel login gate | Independent, ships value, unblocks tenant-scoping |
| Auth pattern | **Server-side BFF + HttpOnly cookie** | Same-origin app; no token in JS (XSS-safe); simplest frontend |
| Session store | **Stateless encrypted cookie** | Keeps Slice 1 free of DB/Redis dependency |
| Unconfigured behavior | **Auth-off fallback w/ dev user** | Mirrors AI-features-no-op; `./scripts/dev.sh` works with zero setup |

---

## Architecture

A thin auth layer added to the FastAPI backend, implemented with **Authlib**
(`authlib.integrations.starlette_client`) for the OIDC Authorization-Code + PKCE flow
against Zitadel.

New module **`web/auth.py`** owns:
- OIDC client setup (issuer discovery, client id/secret, redirect URI).
- The **encrypted session cookie codec** (encode/decode + tamper/expiry rejection).
- The **enforcement dependency** used to guard routes.
- Detection of configured-vs-unconfigured mode + the dev-user fallback.

No changes to `src/` — the CLI is HTTP-free and unaffected by auth. The single-flight
runner and SSE streaming in [web/main.py](../../../web/main.py) are unchanged; they simply
run behind the gate.

**New dependencies:** `authlib`, `cryptography` (Fernet for cookie encryption). Added to
`requirements.txt`.

### Session cookie

Because the session carries a **refresh token** (for transparent access-token renewal),
the cookie is **encrypted** (Fernet), not merely signed. Attributes:
`HttpOnly`, `Secure`, `SameSite=Lax`.

Payload (encrypted): `sub`, `email`, `name`, `exp` (session expiry), and the refresh
token. Nothing is stored server-side.

Session lifetime: rolling renewal via the refresh token while the Zitadel session is
valid; on refresh failure the session is treated as unauthenticated.

---

## Routes

| Route | Method | Behavior |
|---|---|---|
| `/auth/login` | GET | Build PKCE verifier + `state` + `nonce`; redirect to Zitadel authorize endpoint. |
| `/auth/callback` | GET | Exchange code for tokens; **validate the ID token** (JWKS signature, `iss`, `aud`, `nonce`, `exp`); write the encrypted session cookie; redirect back into the SPA. |
| `/auth/logout` | POST | Clear the session cookie; redirect to Zitadel `end_session_endpoint`. |
| `/api/me` | GET | Return `{sub, email, name}` for the current session, or `401`. |

---

## Enforcement

A FastAPI dependency (applied via router/middleware) guards **all `/api/*` routes plus the
SSE/run endpoints**. Whitelisted: `/auth/*` and `/api/health`.

Behavior with no/expired session:
- `/api/*` → **`401` JSON**.
- The React app intercepts `401` in [hooks/useCommand.js](../../../frontend/src/hooks/useCommand.js)
  and the `lib/config.js` fetch helpers, and redirects the browser to `/auth/login`.
- The SPA shell (`index.html` + `/assets`) loads **freely** and bootstraps by calling
  `/api/me`; if that returns `401` it redirects to `/auth/login`.

Access-token renewal via the stored refresh token happens transparently inside the
dependency; renewal failure → unauthenticated.

---

## Dev / unconfigured fallback

`web/auth.py` detects whether Zitadel is configured by the presence of `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`.

- **Not configured → auth disabled.** Every request resolves to a fixed dev user
  (`dev@localhost`). A loud startup log line states `AUTH DISABLED — no OIDC config`.
- **Configured → full enforcement.**

This keeps `./scripts/dev.sh` working with zero external setup, mirroring the
AI-features-no-op pattern already used in the project.

Vite's [vite.config.js](../../../frontend/vite.config.js) proxy list gains **`/auth`**
(today it proxies only `/api` and `/terminal`), so the OIDC redirect flow works through
the dev server on `:51730`.

---

## Configuration (env vars)

Added to `.env.example`:

| Variable | Purpose |
|---|---|
| `OIDC_ISSUER` | Zitadel issuer / domain URL (used for OIDC discovery) |
| `OIDC_CLIENT_ID` | Confidential client id (BFF) |
| `OIDC_CLIENT_SECRET` | Confidential client secret (BFF) |
| `SESSION_SECRET` | Key for cookie encryption (Fernet) |
| `APP_BASE_URL` | Drives the redirect URI; differs dev vs prod; must be registered in Zitadel |

---

## Testing (TDD)

OIDC network calls are mocked — no live Zitadel instance needed.

- **Enforcement dependency:** configured + no cookie → `401`; + valid session cookie →
  resolves user; auth-off mode → dev user.
- **Callback ID-token validation:** good token (mocked JWKS) passes and sets a cookie;
  bad `iss` / `aud` / signature / expired → rejected, no cookie set.
- **Cookie codec:** round-trips a payload; rejects tampered and expired payloads.
- **`/api/me`:** returns the user when authenticated, `401` otherwise.
- **`/auth/logout`:** clears the cookie and redirects to the end-session endpoint.

---

## Risks / open points

- **Refresh token in cookie:** mitigated by encryption + HttpOnly + Secure; acceptable for
  this slice. Instant server-side revocation is deferred to the Postgres/Redis slice.
- **Redirect URI per environment:** dev (`:51730` forwarded port) vs prod host must both be
  registered in Zitadel; driven by `APP_BASE_URL`.
- **Cookie size:** encrypted payload incl. refresh token must stay within the ~4KB cookie
  limit; verify against real Zitadel tokens during implementation.
