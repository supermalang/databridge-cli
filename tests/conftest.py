"""Shared pytest fixtures."""
import sys
from pathlib import Path
import pytest

# Ensure project root is importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="module")
def api_client():
    """Synchronous test client for the FastAPI ASGI app, shared per test module.

    Module scope makes it explicit that web.main's module-level state
    (_last_status, _proc) persists across tests — we'd rather acknowledge
    that than pretend a fresh function-scoped client isolates them.
    """
    from fastapi.testclient import TestClient
    from web.main import app
    with TestClient(app) as c:
        yield c
