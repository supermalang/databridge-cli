"""Object-storage abstraction: a backend-agnostic interface + per-project key helper.

No web.db import — keys are built from plain string IDs so storage stays decoupled
from the data model."""
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Dict, List, Optional, Tuple

CATEGORIES = ("raw", "processed", "charts", "reports", "templates")


def storage_key(org_id: str, project_id: str, category: str, name: str) -> str:
    """Per-project object key: orgs/<org_id>/projects/<project_id>/<category>/<name>.
    `name` may contain '/' for nested paths (e.g. 'charts/foo.png')."""
    return f"orgs/{org_id}/projects/{project_id}/{category}/{name}"


class Storage(ABC):
    """A flat key→bytes object store. get_bytes/get_file raise KeyError if absent."""

    @abstractmethod
    def put_bytes(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def put_file(self, key: str, local_path) -> None: ...

    @abstractmethod
    def get_bytes(self, key: str) -> bytes: ...

    @abstractmethod
    def get_file(self, key: str, dest_path) -> None: ...

    @abstractmethod
    def last_modified(self, key: str) -> datetime:
        """Return the stored object's last-modified time. Raise KeyError if absent."""
        ...

    @abstractmethod
    def list(self, prefix: str) -> List[str]:
        """Return all keys starting with `prefix`, sorted. Matching is by string
        prefix (not path segments), so callers should pass a trailing '/' (e.g.
        'orgs/o/projects/p/') to avoid matching sibling keys like '.../p2/...'."""
        ...

    def list_with_metadata(
        self, prefix: str
    ) -> Dict[str, Tuple[Optional[int], datetime]]:
        """Return {key: (size, last_modified)} for every key under `prefix`.

        Default implementation loops the existing `list()` + `last_modified()`
        so any backend that doesn't override it keeps today's behavior. Backends
        whose listing already carries size/mtime (e.g. S3's `list_objects_v2`)
        should override this to avoid a per-key round trip. `size` is `None` when
        the base interface can't provide it without an extra fetch."""
        result: Dict[str, Tuple[Optional[int], datetime]] = {}
        for key in self.list(prefix):
            try:
                result[key] = (None, self.last_modified(key))
            except KeyError:
                continue
        return result

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def delete_prefix(self, prefix: str) -> None: ...
