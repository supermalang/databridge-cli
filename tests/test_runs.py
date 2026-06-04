import asyncio
import pytest
from web.runs import RunRegistry, BusyError, CapError


def test_start_returns_unique_run_ids():
    r = RunRegistry()
    a = r.start("download", "p1")
    b = r.start("build-report", "p2")
    assert a != b
    assert {x.run_id for x in r.active()} == {a, b}


def test_same_lock_key_is_busy():
    r = RunRegistry()
    r.start("download", "p1")
    with pytest.raises(BusyError):
        r.start("build-report", "p1")


def test_different_keys_concurrent():
    r = RunRegistry()
    r.start("download", "p1")
    r.start("download", "p2")            # no raise
    assert len(r.active()) == 2


def test_global_cap(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_RUNS", "2")
    r = RunRegistry()
    r.start("download", "p1")
    r.start("download", "p2")
    with pytest.raises(CapError):
        r.start("download", "p3")


def test_finish_releases_lock_and_slot(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_RUNS", "1")
    r = RunRegistry()
    rid = r.start("download", "p1")
    with pytest.raises(CapError):
        r.start("download", "p2")
    r.finish(rid)
    assert r.active() == []
    r.start("download", "p2")            # slot + key free now


def test_finish_records_last():
    r = RunRegistry()
    rid = r.start("download", "p1")
    r.set_status(rid, "success")
    r.finish(rid)
    assert r.last().run_id == rid
    assert r.last().status == "success"


def test_public_maps_base_to_none_project():
    r = RunRegistry()
    rid = r.start("download", "__base__")
    info = r.get(rid)
    assert info.public()["project_id"] is None
    rid2 = r.start("download", "p9")
    assert r.get(rid2).public()["project_id"] == "p9"


def test_stop_terminates_and_unknown_is_false():
    r = RunRegistry()

    class _FakeProc:
        def __init__(self): self.terminated = False
        def terminate(self): self.terminated = True
        async def wait(self): return 0
        def kill(self): pass

    rid = r.start("download", "p1")
    proc = _FakeProc()
    r.attach_proc(rid, proc)
    assert asyncio.run(r.stop(rid)) is True
    assert proc.terminated is True
    assert asyncio.run(r.stop("nope")) is False
