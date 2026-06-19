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


# ---------------------------------------------------------------------------
# XTF-19 — push_outputs mirrors a command's declared output categories.
#
# Assumed contract for the implementer (the most natural signature consistent
# with the card + spec):
#
#   workspace.push_outputs(org_id, project_id, base=".", command=None) -> int
#
# - A new per-command map `workspace.RUN_OUTPUTS` declares which CATEGORY_DIRS
#   categories each command produces, e.g.:
#       {"build-report": ["reports"], "run-all": ["reports"],
#        "generate-template": ["templates"], "ai-generate-template": ["templates"],
#        "download": ["processed"]}
# - When `command` is given, for each of that command's declared output
#   categories the push MIRROR-DELETEs: it removes durable-storage objects under
#   that category's prefix that are NOT present in the local/tempdir set, then
#   uploads the current set. Every category NOT declared an output for that
#   command stays MERGE-ONLY (no deletes).
# - When `command` is None (the legacy default), behaviour is the existing
#   merge-only push (the tests above pin that and must keep passing).
# - Mirror-delete must use only `store.list(prefix)` + single-key delete
#   (`store.delete` / `delete_project_file`); no `delete_prefix` blanket wipe.
# ---------------------------------------------------------------------------


def _report_keys(storage, org="o1", project="p1"):
    prefix = "orgs/%s/projects/%s/reports/" % (org, project)
    return sorted(k[len(prefix):] for k in storage.list(prefix))


def _template_keys(storage, org="o1", project="p1"):
    prefix = "orgs/%s/projects/%s/templates/" % (org, project)
    return sorted(k[len(prefix):] for k in storage.list(prefix))


def test_push_mirrors_build_report_reports(storage, tmp_path):
    """A build-report run producing 2 reports into its tempdir, while durable
    storage holds 26 stale report objects, must leave storage AND a subsequent
    pull_workspace mirror with exactly those 2 reports (mirror-delete)."""
    # Seed durable storage with 26 stale report objects.
    for i in range(26):
        storage.put_bytes(
            "orgs/o1/projects/p1/reports/stale_%02d.docx" % i, b"STALE"
        )
    assert len(_report_keys(storage)) == 26

    # The run tempdir holds exactly this run's 2 outputs.
    src = tmp_path / "run"
    (src / "reports").mkdir(parents=True)
    (src / "reports" / "new_a.docx").write_bytes(b"A")
    (src / "reports" / "new_b.docx").write_bytes(b"B")

    workspace.push_outputs("o1", "p1", base=src, command="build-report")

    # Durable storage now holds exactly the 2 new reports — stale ones pruned.
    assert _report_keys(storage) == ["new_a.docx", "new_b.docx"]

    # And the local mirror after a fresh pull also holds exactly those 2.
    dest = tmp_path / "dest"
    workspace.pull_workspace("o1", "p1", base=dest)
    pulled = sorted(f.name for f in (dest / "reports").iterdir() if f.is_file())
    assert pulled == ["new_a.docx", "new_b.docx"]


def test_download_push_leaves_reports_and_templates(storage, tmp_path):
    """download declares only `processed` output — its push must NOT touch
    existing reports/templates storage objects (regression guard against the
    wipe footgun)."""
    # Pre-existing durable reports + templates from prior runs.
    storage.put_bytes("orgs/o1/projects/p1/reports/keep_r1.docx", b"R1")
    storage.put_bytes("orgs/o1/projects/p1/reports/keep_r2.docx", b"R2")
    storage.put_bytes("orgs/o1/projects/p1/templates/keep_t1.docx", b"T1")

    # A download run's tempdir produces processed data but no reports/templates.
    src = tmp_path / "run"
    (src / "data" / "processed").mkdir(parents=True)
    (src / "data" / "processed" / "form_data_1.csv").write_text("a\n1\n")

    workspace.push_outputs("o1", "p1", base=src, command="download")

    # reports + templates untouched (merge-only for undeclared categories).
    assert _report_keys(storage) == ["keep_r1.docx", "keep_r2.docx"]
    assert _template_keys(storage) == ["keep_t1.docx"]


def test_generate_template_push_mirrors_only_templates(storage, tmp_path):
    """generate-template declares only `templates` — it mirrors templates to the
    tempdir set but leaves existing reports objects untouched."""
    # Stale templates that must be pruned + reports that must survive.
    storage.put_bytes("orgs/o1/projects/p1/templates/stale_t.docx", b"OLD")
    storage.put_bytes("orgs/o1/projects/p1/reports/keep_r1.docx", b"R1")
    storage.put_bytes("orgs/o1/projects/p1/reports/keep_r2.docx", b"R2")

    # The run tempdir holds exactly the freshly generated template.
    src = tmp_path / "run"
    (src / "templates").mkdir(parents=True)
    (src / "templates" / "new_tpl.docx").write_bytes(b"NEW")

    workspace.push_outputs("o1", "p1", base=src, command="generate-template")

    # templates mirrored to the tempdir set; reports left alone.
    assert _template_keys(storage) == ["new_tpl.docx"]
    assert _report_keys(storage) == ["keep_r1.docx", "keep_r2.docx"]
