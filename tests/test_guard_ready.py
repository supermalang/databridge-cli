import json, os, subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-ready.sh"

READY = """# Roadmap

## Output

- [ ] **OUT-1 — X**

  **Acceptance criteria**
  - does the thing
  **Unit tests:** tests/test_x.py
  **E2E:** N/A
  **UAT:** 1. step
"""


def setup(tmp, roadmap=READY):
    (tmp / "docs").mkdir(parents=True, exist_ok=True)
    (tmp / "docs" / "ROADMAP.md").write_text(roadmap)
    (tmp / ".claude").mkdir(parents=True, exist_ok=True)
    return tmp


def run(root, marker_obj, fp=None):
    fp = fp or str(root / ".claude" / ".active-task.json")
    payload = {"tool_name": "Write", "tool_input": {"file_path": fp, "content": json.dumps(marker_obj)}}
    env = dict(os.environ, CLAUDE_PROJECT_DIR=str(root))
    return subprocess.run(["bash", str(HOOK)], input=json.dumps(payload), capture_output=True, text=True, env=env)


def test_ready_card_allows(tmp_path):
    p = setup(tmp_path)
    r = run(p, {"id": "OUT-1", "started_at": "now"})
    assert r.returncode == 0, r.stderr


def test_missing_uat_blocks(tmp_path):
    p = setup(tmp_path, READY.replace("  **UAT:** 1. step\n", ""))
    r = run(p, {"id": "OUT-1", "started_at": "now"})
    assert r.returncode == 2 and "UAT" in r.stderr


def test_tbd_blocks(tmp_path):
    p = setup(tmp_path, READY.replace("does the thing", "TBD decide later"))
    r = run(p, {"id": "OUT-1", "started_at": "now"})
    assert r.returncode == 2


def test_closed_card_blocks(tmp_path):
    p = setup(tmp_path, READY.replace("- [ ]", "- [x]"))
    r = run(p, {"id": "OUT-1", "started_at": "now"})
    assert r.returncode == 2


def test_unknown_id_blocks(tmp_path):
    p = setup(tmp_path)
    r = run(p, {"id": "ZZZ-9", "started_at": "now"})
    assert r.returncode == 2


def test_non_marker_file_ignored(tmp_path):
    p = setup(tmp_path)
    r = run(p, {"id": "OUT-1"}, fp=str(tmp_path / "src" / "x.py"))
    assert r.returncode == 0
