import pytest
import yaml
from web.storage import factory, workspace


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "minio"))
    factory.reset_storage()
    yield factory.get_storage()
    factory.reset_storage()


def test_run_inputs_manifest():
    assert workspace.RUN_INPUTS["download"] == []
    assert workspace.RUN_INPUTS["build-report"] == ["processed", "templates"]
    assert workspace.RUN_INPUTS["generate-template"] == []
    assert workspace.RUN_INPUTS["suggest-charts"] == ["processed"]
    assert workspace.RUN_INPUTS["run-all"] == ["processed", "templates"]


def _seed_minio(storage, org, proj):
    from web.storage.base import storage_key
    storage.put_bytes(storage_key(org, proj, "processed", "form_data_1.csv"), b"a,b\n1,2\n")
    storage.put_bytes(storage_key(org, proj, "templates", "t1.docx"), b"TPL")


def test_hydrate_writes_config_and_pulls_inputs(storage, tmp_path):
    _seed_minio(storage, "o1", "p1")
    dest = tmp_path / "run"
    cfg = {"api": {"platform": "kobo"}, "form": {"alias": "demo"}}
    n = workspace.hydrate_run_dir("o1", "p1", "build-report", dest, cfg)
    assert n == 2                                  # processed + templates
    assert yaml.safe_load((dest / "config.yml").read_text()) == cfg
    assert (dest / "data" / "processed" / "form_data_1.csv").read_text() == "a,b\n1,2\n"
    assert (dest / "templates" / "t1.docx").read_bytes() == b"TPL"


def test_hydrate_download_pulls_no_inputs(storage, tmp_path):
    _seed_minio(storage, "o1", "p1")
    dest = tmp_path / "run"
    n = workspace.hydrate_run_dir("o1", "p1", "download", dest, {"api": {}, "form": {}})
    assert n == 0                                  # download regenerates processed; no inputs
    assert (dest / "config.yml").exists()
    assert not (dest / "data" / "processed" / "form_data_1.csv").exists()


def test_hydrate_unknown_command_uses_safe_default(storage, tmp_path):
    _seed_minio(storage, "o1", "p1")
    dest = tmp_path / "run"
    n = workspace.hydrate_run_dir("o1", "p1", "some-future-cmd", dest, {})
    assert n == 2                                  # default ["processed", "templates"]
