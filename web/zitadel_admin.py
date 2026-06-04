"""Zitadel Management (v2) client for invites: find/create a human user and email
them an invite to set a password. Auth is a service-user **PAT** in ZITADEL_API_TOKEN.

This is optional infrastructure: if ZITADEL_API_TOKEN is unset, `enabled()` is False and
the invite endpoint records the DB invitation only (it's consumed when that email logs in
by any means). When configured, we also create the user in Zitadel so a brand-new person
can actually sign in (true invite-only)."""
import logging
import os

import httpx

log = logging.getLogger("databridge.zitadel_admin")


class ZitadelAdminError(Exception):
    """A Zitadel Management API call failed."""


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def enabled() -> bool:
    return bool(_env("ZITADEL_API_TOKEN") and _env("OIDC_ISSUER"))


def _base() -> str:
    return _env("OIDC_ISSUER").rstrip("/")


def _headers() -> dict:
    return {"Authorization": f"Bearer {_env('ZITADEL_API_TOKEN')}",
            "Content-Type": "application/json"}


def find_user_by_email(email: str) -> str | None:
    """Return the Zitadel userId for an email, or None if no such user."""
    r = httpx.post(f"{_base()}/v2/users", headers=_headers(), timeout=15.0, json={
        "queries": [{"emailQuery": {
            "emailAddress": email,
            "method": "EMAIL_QUERY_METHOD_EQUALS_IGNORE_CASE"}}]})
    if r.status_code >= 400:
        raise ZitadelAdminError(f"user search failed ({r.status_code}): {r.text}")
    result = (r.json() or {}).get("result") or []
    return result[0].get("userId") if result else None


def create_human_user(email: str, name: str = "") -> str:
    """Create a human user (unverified email, no password yet). Returns the userId."""
    given, _, family = (name or email.split("@")[0]).partition(" ")
    body = {
        "profile": {"givenName": given or email.split("@")[0], "familyName": family or "."},
        "email": {"email": email, "isVerified": False},
    }
    r = httpx.post(f"{_base()}/v2/users/human", headers=_headers(), timeout=15.0, json=body)
    if r.status_code >= 400:
        raise ZitadelAdminError(f"user create failed ({r.status_code}): {r.text}")
    return (r.json() or {}).get("userId", "")


def send_invite(user_id: str, app_url: str = "") -> None:
    """Email the user an invite code so they can set a password and sign in."""
    body = {}
    if app_url:
        # Zitadel substitutes {{.Code}} / {{.UserID}} into the link it emails.
        body = {"sendCode": {"urlTemplate":
                f"{app_url.rstrip('/')}/auth/login?invite={{{{.Code}}}}&userId={{{{.UserID}}}}"}}
    else:
        body = {"sendCode": {}}
    r = httpx.post(f"{_base()}/v2/users/{user_id}/invite_code",
                   headers=_headers(), timeout=15.0, json=body)
    if r.status_code >= 400:
        raise ZitadelAdminError(f"invite send failed ({r.status_code}): {r.text}")


def ensure_invited_user(email: str, name: str = "", app_url: str = "") -> dict:
    """Find-or-create the Zitadel user for `email` and email them an invite.
    Returns {zitadel_user_id, status} where status ∈ {existing, created}. Raises
    ZitadelAdminError on API failure (caller decides whether to surface or tolerate)."""
    uid = find_user_by_email(email)
    if uid:
        return {"zitadel_user_id": uid, "status": "existing"}
    uid = create_human_user(email, name)
    try:
        send_invite(uid, app_url)
    except ZitadelAdminError as e:
        log.warning("user %s created but invite email failed: %s", email, e)
    return {"zitadel_user_id": uid, "status": "created"}
