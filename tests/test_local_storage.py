import pytest
from web.storage.local import LocalStorage


@pytest.fixture
def store(tmp_path):
    return LocalStorage(tmp_path)


def test_put_get_bytes_roundtrip(store):
    store.put_bytes("orgs/o/projects/p/raw/a.txt", b"hello")
    assert store.get_bytes("orgs/o/projects/p/raw/a.txt") == b"hello"


def test_put_get_file_roundtrip(store, tmp_path):
    src = tmp_path / "src.bin"; src.write_bytes(b"\x00\x01\x02")
    store.put_file("k/deep/x.bin", src)
    dest = tmp_path / "out" / "x.bin"        # parent does not exist yet
    store.get_file("k/deep/x.bin", dest)
    assert dest.read_bytes() == b"\x00\x01\x02"


def test_get_missing_raises_keyerror(store):
    with pytest.raises(KeyError):
        store.get_bytes("nope")
    with pytest.raises(KeyError):
        store.get_file("nope", "/tmp/whatever")


def test_list_returns_scoped_sorted_keys(store):
    store.put_bytes("orgs/o/projects/p/raw/b.txt", b"1")
    store.put_bytes("orgs/o/projects/p/raw/a.txt", b"1")
    store.put_bytes("orgs/o/projects/q/raw/c.txt", b"1")
    assert store.list("orgs/o/projects/p/") == [
        "orgs/o/projects/p/raw/a.txt", "orgs/o/projects/p/raw/b.txt"]


def test_exists(store):
    store.put_bytes("k", b"x")
    assert store.exists("k") is True
    assert store.exists("missing") is False


def test_delete_is_idempotent(store):
    store.put_bytes("k", b"x")
    store.delete("k")
    assert store.exists("k") is False
    store.delete("k")           # no error on absent


def test_delete_prefix_removes_subtree_only(store):
    store.put_bytes("orgs/o/projects/p/raw/a.txt", b"1")
    store.put_bytes("orgs/o/projects/p/reports/r.docx", b"1")
    store.put_bytes("orgs/o/projects/q/raw/c.txt", b"1")
    store.delete_prefix("orgs/o/projects/p/")
    assert store.list("orgs/o/projects/p/") == []
    assert store.list("orgs/o/projects/q/") == ["orgs/o/projects/q/raw/c.txt"]
