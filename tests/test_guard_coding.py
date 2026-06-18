import json, os, subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-coding.sh"
ROADMAP = "# Roadmap\n\n## Global status\n\n- [ ] **OUT-1 — X**\n"


def iso(h=0):
    return (datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%S%z")


def setup(tmp, marker=None, roadmap=ROADMAP):
    (tmp / "docs").mkdir(parents=True, exist_ok=True)
    (tmp / "docs" / "ROADMAP.md").write_text(roadmap)
    (tmp / ".claude").mkdir(parents=True, exist_ok=True)
    if marker is not None:
        (tmp / ".claude" / ".active-task.json").write_text(json.dumps(marker))
    return tmp


def run(root, tool, fp, content=""):
    payload = {"tool_name": tool, "tool_input": {"file_path": fp, "content": content}}
    env = dict(os.environ, CLAUDE_PROJECT_DIR=str(root))
    return subprocess.run(["bash", str(HOOK)], input=json.dumps(payload), capture_output=True, text=True, env=env)


def test_gated_no_marker_blocks(tmp_path):
    p = setup(tmp_path)
    r = run(p, "Write", str(p / "src" / "x.py"), "c")
    assert r.returncode == 2 and "No active roadmap task" in r.stderr


def test_gated_fresh_marker_passes(tmp_path):
    p = setup(tmp_path, {"id": "OUT-1", "started_at": iso()})
    r = run(p, "Write", str(p / "src" / "x.py"), "c")
    assert r.returncode == 0, r.stderr


def test_gated_stale_marker_blocks(tmp_path):
    p = setup(tmp_path, {"id": "OUT-1", "started_at": iso(-9)})
    r = run(p, "Write", str(p / "src" / "x.py"), "c")
    assert r.returncode == 2 and "stale" in r.stderr


def test_gated_closed_task_blocks(tmp_path):
    p = setup(tmp_path, {"id": "OUT-1", "started_at": iso()}, ROADMAP.replace("- [ ]", "- [x]"))
    r = run(p, "Write", str(p / "src" / "x.py"), "c")
    assert r.returncode == 2


def test_exempt_docs_passes(tmp_path):
    p = setup(tmp_path)
    assert run(p, "Write", str(p / "docs" / "x.md"), "t").returncode == 0


def test_exempt_config_passes(tmp_path):
    p = setup(tmp_path)
    assert run(p, "Write", str(p / "config.yml"), "t").returncode == 0


def test_traversal_path_still_gated(tmp_path):
    # C1 regression: a non-canonical path that resolves into src/ must still be gated.
    p = setup(tmp_path)  # no marker
    r = run(p, "Write", str(p / "web" / ".." / "src" / "x.py"), "c")
    assert r.returncode == 2


def test_all_gated_dirs_block_without_marker(tmp_path):
    p = setup(tmp_path)  # no marker
    for sub in ("web/main.py", "frontend/src/App.jsx", "tests/test_foo.py"):
        r = run(p, "Write", str(p / sub), "c")
        assert r.returncode == 2, sub
