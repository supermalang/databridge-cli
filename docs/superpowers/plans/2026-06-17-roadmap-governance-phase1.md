# Roadmap Governance (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docs/ROADMAP.md` the single tracked source of work, enforce the task-card template on every roadmap write, gate implementation edits behind an active roadmap task, and enforce the `feature/* → develop → main` git-flow — all via deterministic hooks plus the `/roadmap` skill and the four roadmap agents.

**Architecture:** Four PreToolUse bash hooks (roadmap template guard, marker-gated coding guard, git-flow guard, branch guard) + the `/roadmap` skill (template, test/impl split, marker, gitflow-aware closeout) + CLAUDE.md rules + four agents (planner, card-reviewer, test-author, implementer). Visual checks (Phase 2) use impeccable `audit`/`critique` + Playwright `toHaveScreenshot`; Phase-1 cards are `N/A (no UI surface)`.

**Tech Stack:** Bash + `jq` 1.6 (hooks) · pytest (hook tests) · Claude Code `.claude/settings.json` PreToolUse hooks · Markdown skill + agents · git-flow.

## Global Constraints

- **Block mechanism:** a hook blocks by exiting **2** with the reason on **stderr**; exit 0 allows.
- **Branch model:** `main` (prod) and `develop` (integration) receive **merges only**. All work on derived branches `feature/ fix/ chore/` off `develop`. We are on `feature/roadmap-governance`; `develop == main == 400afba`.
- **Marker:** `.claude/.active-task.json` = `{"id":"AREA-N","started_at":"ISO8601"}`, TTL **8h (28800s)**, gitignored.
- **Gated code paths** (marker + non-protected branch required): repo-relative `src/ web/ frontend/src/ tests/`. **Exempt:** config, `docs/**`, `*.md`, `.claude/**`, `scripts/**`, `.github/**`.
- **Roadmap template (guard-checked):** header has a `Definition of Done` section + `## Global status`; every task card (`- [ ] **AREA-N — …**`) carries labels `Acceptance criteria`, `Unit tests`, `E2E`, `UAT`. DoD is global (stated once in the header), not per card.
- **Tests:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest`.
- **Hooks registered in `settings.json` LAST** (Task 8) so the build never self-blocks. Hooks `chmod +x`.
- **Commits:** Conventional Commits, commit-as-we-go on `feature/roadmap-governance`.

---

### Task 1: Roadmap content guard hook

**Files:** Create `.claude/hooks/guard-roadmap.sh` · Test `tests/test_guard_roadmap.py`

- [ ] **Step 1: Write the failing test** — `tests/test_guard_roadmap.py`:
```python
import json, subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-roadmap.sh"

GOOD = """# Roadmap — databridge-cli

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
```

- [ ] **Step 2: Run, verify it fails** — `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_guard_roadmap.py -q` → FAIL (script missing).

- [ ] **Step 3: Write the hook** — `.claude/hooks/guard-roadmap.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
case "$fp" in */docs/ROADMAP.md|docs/ROADMAP.md) ;; *) exit 0 ;; esac
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
if [ "$tool" != "Write" ]; then
  echo "Roadmap changes go through /roadmap, which rewrites the whole file; a partial $tool can't be validated." >&2
  exit 2
fi
content="$(printf '%s' "$input" | jq -r '.tool_input.content // ""')"
read -r -d '' awkprog <<'AWK' || true
function flush(   miss){
  if (id=="") return
  miss=""
  if (body !~ /Acceptance criteria/) miss=miss " Acceptance-criteria"
  if (body !~ /Unit tests/)          miss=miss " Unit-tests"
  if (body !~ /E2E/)                 miss=miss " E2E"
  if (body !~ /UAT/)                 miss=miss " UAT"
  if (miss!="") printf("  %s missing:%s\n", id, miss)
  id=""; body=""
}
BEGIN{h1=0; gs=0; dod=0}
NR==1 && $0 ~ /^# .*[Rr]oadmap/ {h1=1}
$0 ~ /^## Definition of Done/ {dod=1}
$0 ~ /^## Global status/ {gs=1}
$0 ~ /^- \[[ x]\] \*\*[A-Za-z]+-[0-9]+/ { flush(); id=$0; sub(/^- \[[ x]\] \*\*/,"",id); sub(/ .*/,"",id); body=$0; next }
$0 ~ /^## / {flush()}
{ body=body "\n" $0 }
END{ flush();
  if(!h1)  print "  missing H1 roadmap title (line 1)"
  if(!dod) print "  missing '## Definition of Done' section"
  if(!gs)  print "  missing '## Global status' section" }
AWK
errors="$(printf '%s' "$content" | awk "$awkprog")"
if [ -n "$errors" ]; then
  { echo "Roadmap content failed template validation — use /roadmap."; echo "Problems:"; echo "$errors"; } >&2
  exit 2
fi
exit 0
```
Then `chmod +x .claude/hooks/guard-roadmap.sh`.

- [ ] **Step 4: Run, verify pass** — same pytest command → 4 passed.
- [ ] **Step 5: Commit** — `git add .claude/hooks/guard-roadmap.sh tests/test_guard_roadmap.py && git commit -m "feat(harness): roadmap content-shape guard hook"`

---

### Task 2: Coding gate hook

**Files:** Create `.claude/hooks/guard-coding.sh` · Test `tests/test_guard_coding.py`

- [ ] **Step 1: Write the failing test** — `tests/test_guard_coding.py`:
```python
import json, os, subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-coding.sh"
ROADMAP = "# Roadmap\n\n## Global status\n\n- [ ] **OUT-1 — X**\n"

def iso(h=0): return (datetime.now(timezone.utc)+timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%S%z")

def setup(tmp, marker=None, roadmap=ROADMAP):
    (tmp/"docs").mkdir(parents=True, exist_ok=True); (tmp/"docs"/"ROADMAP.md").write_text(roadmap)
    (tmp/".claude").mkdir(parents=True, exist_ok=True)
    if marker is not None: (tmp/".claude"/".active-task.json").write_text(json.dumps(marker))
    return tmp

def run(root, tool, fp, content=""):
    payload={"tool_name":tool,"tool_input":{"file_path":fp,"content":content}}
    env=dict(os.environ, CLAUDE_PROJECT_DIR=str(root))
    return subprocess.run(["bash",str(HOOK)],input=json.dumps(payload),capture_output=True,text=True,env=env)

def test_gated_no_marker_blocks(tmp_path):
    p=setup(tmp_path); r=run(p,"Write",str(p/"src"/"x.py"),"c")
    assert r.returncode==2 and "No active roadmap task" in r.stderr
def test_gated_fresh_marker_passes(tmp_path):
    p=setup(tmp_path,{"id":"OUT-1","started_at":iso()}); r=run(p,"Write",str(p/"src"/"x.py"),"c")
    assert r.returncode==0, r.stderr
def test_gated_stale_marker_blocks(tmp_path):
    p=setup(tmp_path,{"id":"OUT-1","started_at":iso(-9)}); r=run(p,"Write",str(p/"src"/"x.py"),"c")
    assert r.returncode==2 and "stale" in r.stderr
def test_gated_closed_task_blocks(tmp_path):
    p=setup(tmp_path,{"id":"OUT-1","started_at":iso()},ROADMAP.replace("- [ ]","- [x]")); r=run(p,"Write",str(p/"src"/"x.py"),"c")
    assert r.returncode==2
def test_exempt_docs_passes(tmp_path):
    p=setup(tmp_path); assert run(p,"Write",str(p/"docs"/"x.md"),"t").returncode==0
def test_exempt_config_passes(tmp_path):
    p=setup(tmp_path); assert run(p,"Write",str(p/"config.yml"),"t").returncode==0
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Write the hook** — `.claude/hooks/guard-coding.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
[ -n "$fp" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"; rel="${fp#"$root"/}"
case "$rel" in src/*|web/*|frontend/src/*|tests/*) ;; *) exit 0 ;; esac
marker="$root/.claude/.active-task.json"
fail(){ echo "$1" >&2; exit 2; }
[ -f "$marker" ] || fail "No active roadmap task. Use /roadmap to start the task you're implementing (sets the marker). Config/docs/tooling are exempt."
id="$(jq -r '.id // ""' "$marker")"; started="$(jq -r '.started_at // ""' "$marker")"
[ -n "$id" ] && [ -n "$started" ] || fail "Active-task marker malformed. Re-run /roadmap."
se="$(date -d "$started" +%s 2>/dev/null || echo 0)"; ne="$(date +%s)"
{ [ "$se" -eq 0 ] || [ $((ne-se)) -gt 28800 ]; } && fail "Active-task marker for $id is stale (>8h). Re-run /roadmap."
grep -qE "^- \[ \] \*\*${id} " "$root/docs/ROADMAP.md" 2>/dev/null || fail "Task $id is not an open ( - [ ] ) task in docs/ROADMAP.md."
exit 0
```
Then `chmod +x`.
- [ ] **Step 4: Run, verify pass** (6 passed).
- [ ] **Step 5: Commit** — `git commit -m "feat(harness): marker-gated coding guard hook"`

---

### Task 3: Git-flow guard hook (commit/push protection)

**Files:** Create `.claude/hooks/guard-git-flow.sh` · Test `tests/test_guard_git_flow.py`

- [ ] **Step 1: Write the failing test** — `tests/test_guard_git_flow.py`:
```python
import json, subprocess, os
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-git-flow.sh"

def gitrepo(tmp, branch):
    subprocess.run(["git","init","-q",str(tmp)],check=True)
    subprocess.run(["git","-C",str(tmp),"config","user.email","t@t"],check=True)
    subprocess.run(["git","-C",str(tmp),"config","user.name","t"],check=True)
    (tmp/"f").write_text("x"); subprocess.run(["git","-C",str(tmp),"add","-A"],check=True)
    subprocess.run(["git","-C",str(tmp),"commit","-qm","init"],check=True)
    subprocess.run(["git","-C",str(tmp),"checkout","-q","-B",branch],check=True)
    return tmp

def run(root, command):
    payload={"tool_name":"Bash","tool_input":{"command":command}}
    env=dict(os.environ, CLAUDE_PROJECT_DIR=str(root))
    return subprocess.run(["bash",str(HOOK)],input=json.dumps(payload),capture_output=True,text=True,env=env)

def test_commit_on_main_blocked(tmp_path):
    p=gitrepo(tmp_path,"main"); r=run(p,'git commit -m "x"')
    assert r.returncode==2 and "main" in r.stderr
def test_push_on_develop_blocked(tmp_path):
    p=gitrepo(tmp_path,"develop"); r=run(p,"git push origin develop")
    assert r.returncode==2
def test_commit_on_feature_allowed(tmp_path):
    p=gitrepo(tmp_path,"feature/x"); assert run(p,'git commit -m "x"').returncode==0
def test_non_git_command_ignored(tmp_path):
    p=gitrepo(tmp_path,"main"); assert run(p,"ls -la").returncode==0
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Write the hook** — `.claude/hooks/guard-git-flow.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
printf '%s' "$cmd" | grep -qE '\bgit\b.*\b(commit|push)\b' || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
case "$branch" in
  main|develop)
    echo "Refusing git commit/push on '$branch' — protected branches receive merges only. Create a derived branch: git switch -c feature/<desc> (from develop)." >&2
    exit 2;;
esac
exit 0
```
Then `chmod +x`.
- [ ] **Step 4: Run, verify pass** (4 passed).
- [ ] **Step 5: Commit** — `git commit -m "feat(harness): git-flow commit/push guard"`

---

### Task 4: Branch guard hook (no code edits on main/develop)

**Files:** Create `.claude/hooks/guard-branch.sh` · Test `tests/test_guard_branch.py`

- [ ] **Step 1: Write the failing test** — `tests/test_guard_branch.py`:
```python
import json, subprocess, os
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-branch.sh"

def gitrepo(tmp, branch):
    subprocess.run(["git","init","-q",str(tmp)],check=True)
    subprocess.run(["git","-C",str(tmp),"config","user.email","t@t"],check=True)
    subprocess.run(["git","-C",str(tmp),"config","user.name","t"],check=True)
    (tmp/"f").write_text("x"); subprocess.run(["git","-C",str(tmp),"add","-A"],check=True)
    subprocess.run(["git","-C",str(tmp),"commit","-qm","init"],check=True)
    subprocess.run(["git","-C",str(tmp),"checkout","-q","-B",branch],check=True)
    return tmp

def run(root, fp):
    payload={"tool_name":"Write","tool_input":{"file_path":fp,"content":"c"}}
    env=dict(os.environ, CLAUDE_PROJECT_DIR=str(root))
    return subprocess.run(["bash",str(HOOK)],input=json.dumps(payload),capture_output=True,text=True,env=env)

def test_code_edit_on_main_blocked(tmp_path):
    p=gitrepo(tmp_path,"main"); r=run(p,str(tmp_path/"src"/"x.py"))
    assert r.returncode==2 and "main" in r.stderr
def test_code_edit_on_develop_blocked(tmp_path):
    p=gitrepo(tmp_path,"develop"); assert run(p,str(tmp_path/"src"/"x.py")).returncode==2
def test_code_edit_on_feature_allowed(tmp_path):
    p=gitrepo(tmp_path,"feature/x"); assert run(p,str(tmp_path/"src"/"x.py")).returncode==0
def test_docs_edit_on_main_allowed(tmp_path):
    p=gitrepo(tmp_path,"main"); assert run(p,str(tmp_path/"docs"/"x.md")).returncode==0
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Write the hook** — `.claude/hooks/guard-branch.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
[ -n "$fp" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"; rel="${fp#"$root"/}"
case "$rel" in src/*|web/*|frontend/src/*|tests/*) ;; *) exit 0 ;; esac
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
case "$branch" in
  main|develop)
    echo "Refusing to edit code on '$branch' — create a derived branch first: git switch -c feature/<desc> (from develop)." >&2
    exit 2;;
esac
exit 0
```
Then `chmod +x`.
- [ ] **Step 4: Run, verify pass** (4 passed).
- [ ] **Step 5: Commit** — `git commit -m "feat(harness): branch guard (no code edits on main/develop)"`

---

### Task 5: The `/roadmap` skill

**Files:** Create `.claude/skills/roadmap/SKILL.md`

- [ ] **Step 1: Write the skill** — `.claude/skills/roadmap/SKILL.md`:
```markdown
---
name: roadmap
description: Use whenever adding, editing, starting, or completing work tracked in docs/ROADMAP.md. Enforces the task-card template (global Definition of Done + per-card Acceptance criteria, Unit tests, E2E, UAT), the tests-first / separate-author rule, and sets/clears the active-task marker that unblocks edits to src/, web/, frontend/src/, tests/.
---

# Roadmap skill

`docs/ROADMAP.md` is the single tracked source of work. Every change goes through this skill.
Hooks back it up: `guard-roadmap` (template), `guard-coding` (marker gate), `guard-git-flow`
+ `guard-branch` (no commits/code-edits on main/develop).

## Rule 0 — rewrite the whole file
Never `Edit` `docs/ROADMAP.md` (the guard blocks partial edits). Read it, compute the full new
content, `Write` the whole file.

## Template
- The header carries the universal **Definition of Done** once (`## Definition of Done`):
  *unit + E2E green · visual baseline approved · impeccable audit/critique clean · UAT signed ·
  committed.* Plus a `## Global status` table.
- Each task card carries (labels checked verbatim by the guard):
  `**Acceptance criteria**` (testable, behavior-specific), `**Unit tests:**` (pytest file +
  cases), `**E2E:**` (Playwright spec + visual: impeccable audit/critique + `toHaveScreenshot`;
  `N/A (reason)` for non-UI), `**UAT:**` (manual numbered steps). Plus Files / Config impact /
  Verify. ID = `AREA-N`. Each sprint adds golden-path `SP-N-E` + sprint UAT.

## Operations
- **Add/edit a task:** read roadmap → write the whole file with the card following the
  template → keep Global status counts in sync. (Optionally dispatch `roadmap-planner` to draft
  and `roadmap-card-reviewer` to validate.)
- **Start a task (unlocks coding):** confirm it's `- [ ]`; write
  `.claude/.active-task.json` = `{"id":"AREA-N","started_at":"<ISO8601 UTC>"}`. Then tests-first.
- **Tests-first, separate authors:** `roadmap-test-author` writes tests from the Acceptance
  criteria and proves they FAIL (red) before any code. `roadmap-task-implementer` makes them
  pass and MUST NOT edit tests. A test believed wrong is escalated, not edited.
- **Complete a task:** confirm DoD met → write roadmap with `- [x]` + updated Global status →
  delete `.claude/.active-task.json`.

## Gate before coding
No feature/bug/fix code without the task existing here and started via this skill. Minor
config, docs, and harness/tooling are exempt. Work happens on a `feature/ fix/ chore/` branch
off `develop` — never on main/develop.
```

- [ ] **Step 2: Verify** — `test -f .claude/skills/roadmap/SKILL.md && grep -q "name: roadmap" .claude/skills/roadmap/SKILL.md && grep -q "active-task.json" .claude/skills/roadmap/SKILL.md && echo OK`
- [ ] **Step 3: Commit** — `git commit -m "feat(harness): /roadmap skill"`

---

### Task 6: CLAUDE.md rules + .gitignore + agents tracked

**Files:** Modify `CLAUDE.md`, `.gitignore`; verify `.claude/agents/*.md` present.

- [ ] **Step 1: Add to CLAUDE.md** (before the final `## Harness`):
```markdown
## Development workflow (gated)

Work is tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md). Four PreToolUse hooks enforce it; the
`/roadmap` skill is the way through them.

- **Gate before coding.** No feature/bug/fix code unless the task exists in `docs/ROADMAP.md`
  and is started via `/roadmap` (sets `.claude/.active-task.json`). Edits to `src/`, `web/`,
  `frontend/src/`, `tests/` are blocked without a fresh marker. Exempt: minor config, `docs/**`,
  `*.md`, `.claude/**`, `scripts/**`, `.github/**`.
- **Roadmap edits go through `/roadmap`** (never hand-edit; the guard rejects partial / template-
  incomplete writes).
- **Branching (git-flow).** `main` (prod) and `develop` (integration) receive merges only — the
  hooks block commits/pushes and code edits on them. Work on `feature/ fix/ chore/` branches off
  `develop`; PR feature → develop, then a release PR develop → main; delete the branch after merge.
- **Testing contract.** Tests are authored by `roadmap-test-author` from the Acceptance criteria,
  proven red, and FROZEN during implementation (`roadmap-task-implementer` never edits them).
  Each task: pytest unit + (UI) Playwright E2E + visual (impeccable `audit`/`critique` +
  `toHaveScreenshot`) + manual UAT. DoD lives once in the roadmap header.
- **Process skills (superpowers).** Review → `/code-review`, `/security-review`,
  requesting/receiving-code-review · debugging → systematic-debugging · verification →
  verification-before-completion · isolation → using-git-worktrees · delivery →
  finishing-a-development-branch.
- **Agents** (`.claude/agents/`): `roadmap-planner`, `roadmap-card-reviewer`,
  `roadmap-test-author`, `roadmap-task-implementer`.
```

- [ ] **Step 2: Switch `.gitignore`** — replace `.claude/` with:
```
# Claude Code: track shared config (settings, skills/roadmap, hooks, agents); ignore local + vendored
.claude/settings.local.json
.claude/.active-task*
.claude/skills/impeccable/
```
(Keeps `.claude/skills/roadmap`, `.claude/hooks`, `.claude/agents`, `.claude/settings.json` tracked; impeccable is re-installable via `npx impeccable skills install`.)

- [ ] **Step 3: Verify** — `grep -q "Development workflow (gated)" CLAUDE.md && git check-ignore .claude/.active-task.json >/dev/null && git check-ignore .claude/skills/impeccable/SKILL.md >/dev/null && ! git check-ignore .claude/agents/roadmap-planner.md >/dev/null && echo OK`
- [ ] **Step 4: Commit** — `git add CLAUDE.md .gitignore .claude/agents .claude/skills/roadmap .claude/hooks && git commit -m "docs(harness): gated workflow + branching policy; track .claude config"`

---

### Task 7: Migrate existing ROADMAP.md to the new template

**Files:** Modify `docs/ROADMAP.md` (via the `/roadmap` flow — whole-file Write).

- [ ] **Step 1:** Read `docs/ROADMAP.md`. Add a `## Definition of Done` section to the header (unit + E2E green · visual approved · UAT signed · committed). Keep the existing `## Global status`.
- [ ] **Step 2:** For each of the 17 cards (OUT-1..3, UX-1..9, ME-1..5), ensure the four labels exist: keep existing `Acceptance criteria`; add `Unit tests:` (target pytest file), `E2E:` (`N/A (reason)` for non-UI, else Playwright + visual), `UAT:` (manual steps). Preserve Files/Config impact/Verify.
- [ ] **Step 3:** Write the whole file. (Hooks are NOT yet active — Task 8 activates them — so this Write succeeds; after activation the same content passes the guard.)
- [ ] **Step 4: Verify** content has `## Definition of Done` and every `- [ ]` card has all four labels (eyeball or grep).
- [ ] **Step 5: Commit** — `git commit -m "docs(roadmap): migrate cards to DoD+AC/Unit/E2E/UAT template"`

---

### Task 8: Activate hooks (settings.json) — LAST

**Files:** Modify `.claude/settings.json`

- [ ] **Step 1: Register hooks** — `.claude/settings.json`:
```json
{
  "permissions": {
    "allow": [
      "Bash(python -m pytest *)",
      "Bash(PYTHONPATH=. MPLBACKEND=Agg python -m pytest *)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-roadmap.sh" },
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-coding.sh" },
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-branch.sh" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-git-flow.sh" }
        ]
      }
    ]
  }
}
```
- [ ] **Step 2: Validate JSON** — `python3 -c "import json; json.load(open('.claude/settings.json'))" && echo OK`
- [ ] **Step 3: Full suite green** — `PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q` (existing + 18 new hook tests).
- [ ] **Step 4: Commit** — `git add .claude/settings.json && git commit -m "feat(harness): activate roadmap, coding, git-flow, branch guards"`

---

## Task 9: Manual end-to-end verification (hooks now live)

Confirm by hand in a fresh turn (expected result noted):
1. `Write` to `src/scratch.py` with no marker → **blocked** ("No active roadmap task"). 2. `Edit`
`docs/ROADMAP.md` → **blocked** ("/roadmap"). 3. `/roadmap` add a throwaway card missing `UAT` →
Write **blocked** naming the gap; add it → passes. 4. `Write` `docs/NOTES.md` → **allowed**
(revert). 5. On `develop`: `git commit` → **blocked**; editing `src/` → **blocked**. 6. `/roadmap`
start a real task → `tests/` edit **allowed**. Fix the relevant hook if any differ.

---

## Phase 2 (separate plan)
`/roadmap` → register `INF-1 — Playwright + visual E2E harness` → its own plan: `frontend/playwright.config.js`, `frontend/tests/e2e/` + `toHaveScreenshot` baseline, npm `test:e2e`, impeccable `audit`/`critique` in the visual gate, CI job, `/impeccable init` + detector hook.

## Self-review
Spec coverage: 4 hooks (T1–4), skill (T5), CLAUDE.md+gitignore+agents (T6), migration (T7), activation+verify (T8–9). Visual = impeccable + Playwright (deferred to Phase 2; Phase-1 cards `N/A`). Test/impl split encoded in skill (T5) + CLAUDE.md (T6) + agents. Required labels (`Acceptance criteria`/`Unit tests`/`E2E`/`UAT` + header `Definition of Done`) consistent across guard (T1), skill (T5), CLAUDE.md (T6), migration (T7). Bootstrap-safe: hooks activate only in T8; all build artifacts are exempt paths; we're on `feature/roadmap-governance` so guard-branch won't fire on our own edits.

---

## Addendum — locked deltas (integrate into the tasks above)

Locked after the main list (DoR gate · verifier · CI). Fold in during execution.

**A. DoR header (into Task 7 migration):** add a `## Definition of Ready` section to the
roadmap header: *startable only when — AC concrete + testable · Unit/E2E/UAT filled (no TBD) ·
Files identified · dependencies resolved · scoped to one deliverable · on a derived branch.*
guard-roadmap already requires `## Definition of Done` + `## Global status`; extend its header
check to also require `## Definition of Ready`.

**B. `guard-ready.sh` (new task, before Task 8 activation) + `tests/test_guard_ready.py`** —
PreToolUse on Write to `.claude/.active-task.json`; blocks the marker unless the target card is
open and structurally Ready:
```bash
#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
case "$fp" in */.claude/.active-task.json|.claude/.active-task.json) ;; *) exit 0 ;; esac
content="$(printf '%s' "$input" | jq -r '.tool_input.content // ""')"
id="$(printf '%s' "$content" | jq -r '.id // ""' 2>/dev/null || echo "")"
root="${CLAUDE_PROJECT_DIR:-$PWD}"; rm="$root/docs/ROADMAP.md"
fail(){ echo "$1" >&2; exit 2; }
[ -n "$id" ] || fail "Active-task marker has no id."
card="$(awk -v id="$id" '
  $0 ~ "^- \\[[ x]\\] \\*\\*"id" " {f=1; b=$0; next}
  f && $0 ~ /^(- \[[ x]\]|## )/ {f=0}
  f {b=b"\n"$0} END{print b}' "$rm")"
[ -n "$card" ] || fail "Task $id not found in docs/ROADMAP.md."
printf '%s' "$card" | grep -q '^- \[ \]' || fail "Task $id is not open ( - [ ] )."
printf '%s' "$card" | grep -qiE 'TBD|TODO' && fail "Task $id not Ready: TBD/TODO placeholder."
miss=""; for l in "Acceptance criteria" "Unit tests" "E2E" "UAT"; do
  printf '%s' "$card" | grep -q "$l" || miss="$miss $l"; done
[ -z "$miss" ] || fail "Task $id not Ready: missing$miss."
exit 0
```
Tests (temp roadmap + marker payload): Ready card → allow · missing UAT → block · TBD present →
block · closed card → block · non-marker file → allow. Register in settings (Task 8) under the
`Write|Edit|MultiEdit` matcher.

**C. CI + branch protection (new task):** `.github/workflows/governance.yml` — a job that runs a
roadmap-template validator (header has DoR+DoD+Global status; every card has the four labels;
no `TBD`) and fails the PR if not. Add `docs/CONTRIBUTING.md` documenting required GitHub
branch protection: PRs only into `main`/`develop`, require the governance check + ≥1 review.

**D. Verifier wiring (into Task 5 skill + Task 6 CLAUDE.md):** the `/roadmap` "start" step checks
DoR before writing the marker; closeout dispatches `roadmap-verifier` (DoD exit gate) before
flipping `- [x]`. Agent roster includes `roadmap-verifier` (already created).
```
