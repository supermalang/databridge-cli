import json, subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-roadmap.sh"

GOOD = """# Roadmap — databridge-cli

## Definition of Ready
AC testable, Unit/E2E/UAT filled, deps resolved, on a derived branch.

## Definition of Done
Unit + E2E green, visual baseline approved, UAT signed, committed.

## Global status

| Area | Planned | Progress |
|---|---|---|

## Output

- [ ] **OUT-1 — Example task**

  **Acceptance criteria**
  - download writes a records-array .json
  **Unit tests:** tests/test_x.py
  **E2E:** N/A (no UI surface)
  **UAT:** 1. run download · 2. open file
"""

BAD_NO_UAT = """# Roadmap — databridge-cli

## Definition of Ready
x

## Definition of Done
x

## Global status

- [ ] **OUT-1 — Example task**

  **Acceptance criteria**
  - x
  **Unit tests:** tests/test_x.py
  **E2E:** N/A
"""


def run(tool_name, file_path, content=""):
    payload = {"tool_name": tool_name, "tool_input": {"file_path": file_path, "content": content}}
    return subprocess.run(["bash", str(HOOK)], input=json.dumps(payload), capture_output=True, text=True)


def test_write_good_roadmap_passes():
    r = run("Write", "docs/ROADMAP.md", GOOD)
    assert r.returncode == 0, r.stderr


def test_write_missing_uat_blocks():
    r = run("Write", "docs/ROADMAP.md", BAD_NO_UAT)
    assert r.returncode == 2
    assert "OUT-1" in r.stderr and "UAT" in r.stderr


def test_edit_roadmap_always_blocked():
    r = run("Edit", "docs/ROADMAP.md", "")
    assert r.returncode == 2 and "/roadmap" in r.stderr


def test_write_non_roadmap_ignored():
    r = run("Write", "docs/OTHER.md", "anything")
    assert r.returncode == 0
