import pytest
from web.storage import factory
from web.storage.local import LocalStorage


def test_local_backend_selected(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path))
    factory.reset_storage()
    s = factory.get_storage()
    assert isinstance(s, LocalStorage)
    assert factory.get_storage() is s          # singleton
    factory.reset_storage()


def test_unconfigured_raises(monkeypatch):
    for k in ("STORAGE_BACKEND", "S3_ENDPOINT_URL", "S3_ACCESS_KEY",
              "S3_SECRET_KEY", "S3_BUCKET"):
        monkeypatch.delenv(k, raising=False)
    factory.reset_storage()
    with pytest.raises(RuntimeError):
        factory.get_storage()
    factory.reset_storage()


def test_s3_backend_selected(monkeypatch):
    monkeypatch.delenv("STORAGE_BACKEND", raising=False)
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://localhost:9000")
    monkeypatch.setenv("S3_ACCESS_KEY", "ak")
    monkeypatch.setenv("S3_SECRET_KEY", "sk")
    monkeypatch.setenv("S3_BUCKET", "bkt")
    factory.reset_storage()
    from web.storage.s3 import S3Storage
    s = factory.get_storage()
    assert isinstance(s, S3Storage)
    assert s.bucket == "bkt"
    factory.reset_storage()


def test_local_missing_dir_raises_runtimeerror(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.delenv("STORAGE_LOCAL_DIR", raising=False)
    factory.reset_storage()
    with pytest.raises(RuntimeError):
        factory.get_storage()
    factory.reset_storage()
