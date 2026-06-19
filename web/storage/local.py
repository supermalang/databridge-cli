"""Filesystem-backed Storage — keys map to files under a base directory. For tests
and isolated unit testing."""
import shutil
from datetime import datetime
from pathlib import Path
from typing import List

from web.storage.base import Storage


class LocalStorage(Storage):
    def __init__(self, base_dir):
        self._base = Path(base_dir)

    def _path(self, key: str) -> Path:
        return self._base / key

    def put_bytes(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def put_file(self, key: str, local_path) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_path, p)

    def get_bytes(self, key: str) -> bytes:
        p = self._path(key)
        if not p.is_file():
            raise KeyError(key)
        return p.read_bytes()

    def get_file(self, key: str, dest_path) -> None:
        p = self._path(key)
        if not p.is_file():
            raise KeyError(key)
        dest = Path(dest_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, dest)

    def last_modified(self, key: str) -> datetime:
        p = self._path(key)
        if not p.is_file():
            raise KeyError(key)
        return datetime.fromtimestamp(p.stat().st_mtime)

    def list(self, prefix: str) -> List[str]:
        keys = []
        for f in self._base.rglob("*"):
            if f.is_file():
                rel = f.relative_to(self._base).as_posix()
                if rel.startswith(prefix):
                    keys.append(rel)
        return sorted(keys)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> None:
        for key in self.list(prefix):
            self._path(key).unlink(missing_ok=True)
        # Prune now-empty directories under the prefix (deepest first) so a deleted
        # project subtree doesn't leave empty dirs behind.
        prefix_dir = self._path(prefix)
        if prefix_dir.is_dir():
            for d in sorted((p for p in prefix_dir.rglob("*") if p.is_dir()),
                            key=lambda p: len(p.parts), reverse=True):
                if not any(d.iterdir()):
                    d.rmdir()
            if not any(prefix_dir.iterdir()):
                prefix_dir.rmdir()
