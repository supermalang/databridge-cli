"""Authentication: Zitadel OIDC login gate (BFF + encrypted cookie session)."""
import base64
import hashlib
import json
import os
import time
from cryptography.fernet import Fernet, InvalidToken


def _fernet_key(secret: str) -> bytes:
    """Derive a valid 32-byte url-safe base64 Fernet key from any secret string."""
    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())


class SessionCodec:
    """Encrypt/decrypt the session cookie payload. Returns None on any failure."""

    def __init__(self, secret: str):
        self._f = Fernet(_fernet_key(secret))

    def encode(self, payload: dict) -> str:
        return self._f.encrypt(json.dumps(payload).encode()).decode()

    def decode(self, token: str) -> dict | None:
        try:
            return json.loads(self._f.decrypt(token.encode()).decode())
        except (InvalidToken, ValueError, TypeError):
            return None


DEV_USER = {"sub": "dev-local", "email": "dev@localhost", "name": "Local Dev"}
SESSION_COOKIE = "db_session"


def auth_enabled() -> bool:
    return all(os.environ.get(k) for k in ("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"))


def session_codec() -> SessionCodec:
    return SessionCodec(os.environ.get("SESSION_SECRET", "dev-insecure-secret"))


def _public_user(payload: dict) -> dict:
    return {"sub": payload["sub"], "email": payload.get("email", ""), "name": payload.get("name", "")}


def current_user(cookie_value: str | None) -> dict | None:
    """Resolve the current user. Dev user when auth disabled; else decode the cookie.
    Returns None when auth is enabled and there is no valid, unexpired session."""
    if not auth_enabled():
        return DEV_USER
    if not cookie_value:
        return None
    payload = session_codec().decode(cookie_value)
    if not payload or payload.get("sess_exp", 0) < time.time():
        return None
    return _public_user(payload)
