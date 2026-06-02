"""Authentication: Zitadel OIDC login gate (BFF + encrypted cookie session)."""
import base64
import hashlib
import json
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
