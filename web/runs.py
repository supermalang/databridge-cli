"""In-memory registry of active runs: per-lock_key serialization + a global concurrency
cap + per-run process tracking. Replaces the old global single-flight run state."""
import asyncio
import os
import uuid
from collections import deque
from datetime import datetime


class BusyError(Exception):
    """Another run holds this lock_key (e.g. the same project)."""


class CapError(Exception):
    """The global concurrency cap is reached."""


class RunInfo:
    def __init__(self, run_id: str, command: str, lock_key: str):
        self.run_id = run_id
        self.command = command
        self.lock_key = lock_key
        self.proc = None
        self.status = "running"
        self.started_at = datetime.now().isoformat()
        self.finished_at = None

    def public(self) -> dict:
        return {
            "run_id": self.run_id,
            "command": self.command,
            "status": self.status,
            "project_id": None if self.lock_key == "__base__" else self.lock_key,
            "finished_at": self.finished_at,
        }


class RunRegistry:
    def __init__(self):
        self._active = {}                 # run_id -> RunInfo
        self._recent = deque(maxlen=20)   # finished RunInfo, newest last

    def _cap(self) -> int:
        try:
            return int(os.environ.get("MAX_CONCURRENT_RUNS", "4"))
        except ValueError:
            return 4

    def start(self, command: str, lock_key: str) -> str:
        """Atomic check-and-reserve (no await). Raises BusyError / CapError."""
        if any(r.lock_key == lock_key for r in self._active.values()):
            raise BusyError(lock_key)
        if len(self._active) >= self._cap():
            raise CapError()
        run_id = uuid.uuid4().hex[:12]
        self._active[run_id] = RunInfo(run_id, command, lock_key)
        return run_id

    def attach_proc(self, run_id: str, proc) -> None:
        info = self._active.get(run_id)
        if info is not None:
            info.proc = proc

    def set_status(self, run_id: str, status: str) -> None:
        info = self._active.get(run_id)
        if info is not None:
            info.status = status

    def finish(self, run_id: str) -> None:
        info = self._active.pop(run_id, None)
        if info is not None:
            info.finished_at = datetime.now().isoformat()
            self._recent.append(info)

    def get(self, run_id: str):
        return self._active.get(run_id)

    def active(self):
        return list(self._active.values())

    def last(self):
        return self._recent[-1] if self._recent else None

    async def stop(self, run_id: str) -> bool:
        info = self._active.get(run_id)
        if info is None or info.proc is None:
            return False
        proc = info.proc
        try:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                proc.kill()
        except ProcessLookupError:
            pass
        return True
