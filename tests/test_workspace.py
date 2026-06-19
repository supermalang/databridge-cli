import pytest
from web.storage import factory, workspace


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "minio"))
    factory.reset_storage()
    yield factory.get_storage()
    factory.reset_storage()


def _seed_local(base):
    (base / "data" / "processed").mkdir(parents=True)
    (base / "data" / "processed" / "form_data_1.csv").write_text("a,b\n1,2\n")
    (base / "data" / "processed" / "charts").mkdir()
    (base / "data" / "processed" / "charts" / "c.png").write_bytes(b"PNG")     # excluded
    (base / "data" / "raw").mkdir(parents=True)
    (base / "data" / "raw" / "raw.json").write_text("{}")                       # excluded
    (base / "reports").mkdir()
    (base / "reports" / "r1.docx").write_bytes(b"DOCX")
    (base / "templates").mkdir()
    (base / "templates" / "t1.docx").write_bytes(b"TPL")


def test_push_then_pull_roundtrip(storage, tmp_path):
    src = tmp_path / "src"; _seed_local(src)
    n = workspace.push_outputs("o1", "p1", base=src)
    assert n == 3                                  # csv + report + template (charts/raw excluded)

    dest = tmp_path / "dest"
    (dest / "data" / "processed").mkdir(parents=True)
    (dest / "reports").mkdir(); (dest / "templates").mkdir()
    pulled = workspace.pull_workspace("o1", "p1", base=dest)
    assert pulled == 3
    assert (dest / "data" / "processed" / "form_data_1.csv").read_text() == "a,b\n1,2\n"
    assert (dest / "reports" / "r1.docx").read_bytes() == b"DOCX"
    assert (dest / "templates" / "t1.docx").read_bytes() == b"TPL"


def test_push_excludes_charts_and_raw(storage, tmp_path):
    src = tmp_path / "src"; _seed_local(src)
    workspace.push_outputs("o1", "p1", base=src)
    keys = storage.list("orgs/o1/projects/p1/")
    assert not any("charts" in k for k in keys)
    assert not any("raw" in k for k in keys)
    assert "orgs/o1/projects/p1/processed/form_data_1.csv" in keys


def test_pull_clears_stale_but_preserves_charts(storage, tmp_path):
    src = tmp_path / "src"; _seed_local(src)
    workspace.push_outputs("o1", "p1", base=src)
    dest = tmp_path / "dest"
    (dest / "data" / "processed" / "charts").mkdir(parents=True)
    (dest / "data" / "processed" / "charts" / "keep.png").write_bytes(b"KEEP")
    (dest / "reports").mkdir(); (dest / "reports" / "old.docx").write_bytes(b"OLD")
    (dest / "templates").mkdir()
    workspace.pull_workspace("o1", "p1", base=dest)
    assert not (dest / "reports" / "old.docx").exists()                  # stale cleared
    assert (dest / "reports" / "r1.docx").exists()                       # pulled
    assert (dest / "data" / "processed" / "charts" / "keep.png").exists()  # charts preserved


def test_is_empty(storage, tmp_path):
    assert workspace.is_empty("o1", "p1") is True
    src = tmp_path / "src"; _seed_local(src)
    workspace.push_outputs("o1", "p1", base=src)
    assert workspace.is_empty("o1", "p1") is False


def test_pull_many_files_parallel(storage, tmp_path):
    """pull_workspace downloads files concurrently — verify a larger batch all
    lands intact (exercises the thread-pool path)."""
    src = tmp_path / "src"
    (src / "data" / "processed").mkdir(parents=True)
    for i in range(50):
        (src / "data" / "processed" / f"f{i}.csv").write_text(f"row,{i}\n")
    workspace.push_outputs("o1", "p1", base=src)

    dest = tmp_path / "dest"
    pulled = workspace.pull_workspace("o1", "p1", base=dest)
    assert pulled == 50
    for i in range(50):
        assert (dest / "data" / "processed" / f"f{i}.csv").read_text() == f"row,{i}\n"
