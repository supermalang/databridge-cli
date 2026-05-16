"""Shared pytest fixtures."""
import sys
from pathlib import Path
import pytest

# Ensure project root is importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture
def project_root() -> Path:
    return ROOT


@pytest.fixture
def api_client():
    """Synchronous httpx client wired to the FastAPI ASGI app in-process."""
    from fastapi.testclient import TestClient
    from web.main import app
    with TestClient(app) as c:
        yield c
