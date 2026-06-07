"""SSRF guard for user-controlled outbound URLs.

Connectivity probes (``/api/sources/test``, ``/api/ai/test``) take a URL from the
caller and make a server-side HTTP request to it. Without a guard, a caller can
point that request at internal services or the cloud metadata endpoint
(169.254.169.254). ``validate_public_url`` rejects non-http(s) schemes and any
host that resolves to a private, loopback, link-local, or otherwise non-public
address.
"""
import ipaddress
import socket
from urllib.parse import urlsplit

ALLOWED_SCHEMES = ("http", "https")


class SSRFError(ValueError):
    """Raised when a URL is not an allowed public http(s) target."""


def _is_public_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def validate_public_url(url: str) -> None:
    """Raise :class:`SSRFError` unless *url* is an http(s) URL whose host resolves
    only to public IP addresses.

    Resolves the hostname and checks every returned address so a hostname that
    maps to an internal IP (e.g. ``localhost`` or an attacker-controlled DNS name
    pointing at 127.0.0.1) is rejected.
    """
    if not isinstance(url, str) or not url.strip():
        raise SSRFError("URL is required.")
    parts = urlsplit(url.strip())
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise SSRFError(f"URL scheme '{parts.scheme}' is not allowed (use http/https).")
    host = parts.hostname
    if not host:
        raise SSRFError("URL has no host.")

    try:
        infos = socket.getaddrinfo(host, parts.port or None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise SSRFError(f"Could not resolve host '{host}': {e}") from e

    resolved = {info[4][0] for info in infos}
    if not resolved:
        raise SSRFError(f"Could not resolve host '{host}'.")
    for ip in resolved:
        if not _is_public_ip(ip):
            raise SSRFError(
                f"Host '{host}' resolves to a non-public address ({ip}); not allowed."
            )
