"""
VIS-14 — Cut over CI + guard-hook comments + docs to the visual-review
layout; retire dead old locations.

Tests derived strictly from the card's Acceptance criteria:

  - CI (`.github/workflows/visual.yml`) runs Tier 1 functional, Tier 1
    visual, and Tier 2 visual jobs/steps, and the PR path trigger includes
    `visual-review/**` alongside `frontend/**`
  - `.gitignore` no longer references any now-dead pre-migration output path
    (frontend/playwright-report/, frontend/blob-report/, frontend/test-results/,
    frontend/.playwright/, and any pre-migration Storybook build/report lines),
    and lists the visual-review/ equivalents
  - CLAUDE.md, .claude/context.md, .claude/skills/visual-review/SKILL.md, and
    .claude/agents/visual-review.md reference only visual-review/ paths — no
    stale pre-migration path (frontend/tests/e2e, frontend/.storybook,
    frontend/tests/storybook, frontend/scripts/visual-review-app, a bare root
    visual-approvals.json) remains in any of them
  - the visual-review agent's git-diff/git-status baseline-change detection
    uses rename detection so pixel-identical git-mv renames are not reported
    as brand-new pending baselines
  - frontend/playwright.storybook.config.ts, frontend/.storybook/,
    frontend/scripts/visual-review-app/, and the root approvals-ledger file
    do not exist anywhere in the repo
  - .claude/hooks/guard-visual-update.sh header comment points at the new
    baseline locations

This does not re-run the full CI workflow (that happens on GitHub Actions at
Verify time) — it asserts the on-disk contract (workflow YAML content, doc
text, hook comment text, dead-path absence) the card requires, same posture
as the VIS-9/10/11/12/13 precedents.
"""
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "visual.yml"
GITIGNORE = ROOT / ".gitignore"
CLAUDE_MD = ROOT / "CLAUDE.md"
CONTEXT_MD = ROOT / ".claude" / "context.md"
SKILL_MD = ROOT / ".claude" / "skills" / "visual-review" / "SKILL.md"
AGENT_MD = ROOT / ".claude" / "agents" / "visual-review.md"
GUARD_HOOK = ROOT / ".claude" / "hooks" / "guard-visual-update.sh"

# Pre-migration paths that must no longer appear in docs/hooks after cutover.
STALE_PATH_PATTERNS = [
    r"frontend/tests/e2e/(?!css-escape-polyfill)",  # functional specs still live here; the
    # visual-baseline references specifically must be gone — checked more precisely below.
]


def _read(path: Path) -> str:
    assert path.is_file(), f"{path} must exist"
    return path.read_text()


# ---------------------------------------------------------------------------
# CI workflow: three jobs/steps, trigger path extended
# ---------------------------------------------------------------------------

def _load_workflow():
    src = _read(WORKFLOW)
    return src, yaml.safe_load(src)


def test_workflow_trigger_includes_visual_review_path():
    src, _doc = _load_workflow()
    paths_block = src.split("paths:", 1)[1] if "paths:" in src else ""
    assert "visual-review/**" in paths_block, (
        ".github/workflows/visual.yml pull_request.paths must include "
        "'visual-review/**' alongside 'frontend/**' so a PR touching only "
        "visual-review/** triggers this workflow"
    )
    assert "frontend/**" in paths_block, (
        ".github/workflows/visual.yml must still trigger on 'frontend/**' changes"
    )


def test_workflow_still_runs_tier1_functional_suite():
    src, _doc = _load_workflow()
    assert "test:e2e" in src, (
        ".github/workflows/visual.yml must keep running the Tier 1 functional "
        "suite (npm run test:e2e) — VIS-10-12 already split it to functional-only"
    )


def test_workflow_runs_tier1_visual_suite():
    src, _doc = _load_workflow()
    assert "test:visual" in src and "storybook" not in src.split("test:visual")[1][:20], (
        ".github/workflows/visual.yml must add a step running the Tier 1 "
        "dedicated visual suite (npm run test:visual, visual-review/playwright.visual.config.ts)"
    )


def test_workflow_runs_tier2_storybook_visual_suite():
    src, _doc = _load_workflow()
    assert "test:visual:storybook" in src, (
        ".github/workflows/visual.yml must add a step running the Tier 2 "
        "Storybook visual suite (npm run test:visual:storybook)"
    )
    assert "storybook:build" in src, (
        ".github/workflows/visual.yml must build Storybook before running the "
        "Tier 2 visual suite (npm run storybook:build)"
    )


def test_workflow_has_at_least_three_distinct_job_or_step_groupings():
    # Regardless of whether Tier1-functional/Tier1-visual/Tier2-visual are
    # separate jobs or steps within one job, all three run commands must be
    # present and distinguishable.
    src, _doc = _load_workflow()
    run_commands = re.findall(r"run:\s*(.+)", src)
    joined = "\n".join(run_commands)
    assert "test:e2e" in joined
    assert re.search(r"test:visual\b", joined)
    assert "test:visual:storybook" in joined


# ---------------------------------------------------------------------------
# .gitignore: dead pre-migration lines removed, visual-review/ present
# ---------------------------------------------------------------------------

def test_gitignore_has_no_dead_pre_migration_output_lines():
    gi = _read(GITIGNORE)
    dead_lines = [
        "frontend/playwright-report/",
        "frontend/blob-report/",
        "frontend/test-results/",
        "frontend/.playwright/",
        "frontend/storybook-static/",
        "frontend/playwright-report-storybook/",
    ]
    for line in dead_lines:
        assert line not in gi, (
            f".gitignore must no longer reference the dead pre-migration output "
            f"path '{line}' — nothing writes there once CI/local runs point at "
            f"visual-review/"
        )


def test_gitignore_lists_visual_review_equivalents():
    gi = _read(GITIGNORE)
    for expected in (
        "visual-review/results/",
        "visual-review/uat/",
        "visual-review/storybook/static/",
    ):
        assert expected in gi, f".gitignore must list {expected}"


# ---------------------------------------------------------------------------
# Docs/hooks: only visual-review/ paths remain, no stale pre-migration path
# ---------------------------------------------------------------------------

STALE_REFERENCES = [
    "frontend/tests/e2e/",
    "frontend/.storybook/",
    "frontend/tests/storybook/",
    "frontend/scripts/visual-review-app/",
    "frontend/playwright.storybook.config.ts",
]


def _assert_no_stale_visual_paths(path: Path):
    text = _read(path)
    for stale in STALE_REFERENCES:
        assert stale not in text, (
            f"{path} still references the pre-migration path '{stale}' — "
            f"VIS-14 requires only visual-review/ paths remain"
        )
    # A bare root-level ledger reference (not visual-review/visual-approvals.json)
    # must not remain either.
    for m in re.finditer(r"[^/`]visual-approvals\.json", text):
        preceding = text[max(0, m.start() - 40): m.start()]
        assert "visual-review" in preceding, (
            f"{path} references a bare 'visual-approvals.json' not qualified "
            f"under visual-review/ — the ledger now lives at "
            f"visual-review/visual-approvals.json"
        )


def test_claude_md_has_no_stale_pre_migration_paths():
    _assert_no_stale_visual_paths(CLAUDE_MD)


def test_context_md_has_no_stale_pre_migration_paths():
    _assert_no_stale_visual_paths(CONTEXT_MD)


def test_skill_md_has_no_stale_pre_migration_paths():
    _assert_no_stale_visual_paths(SKILL_MD)


def test_agent_md_has_no_stale_pre_migration_paths():
    _assert_no_stale_visual_paths(AGENT_MD)


def test_claude_md_describes_split_tier1_configs():
    text = _read(CLAUDE_MD)
    assert "visual-review/playwright.visual.config.ts" in text, (
        "CLAUDE.md must describe the Tier 1 visual config at its "
        "visual-review/ location"
    )
    assert "frontend/playwright.config.ts" in text, (
        "CLAUDE.md must still reference the Tier 1 functional config at "
        "frontend/playwright.config.ts"
    )


def test_claude_md_describes_tier2_and_tier3_new_locations():
    text = _read(CLAUDE_MD)
    assert "visual-review/playwright.storybook.config.ts" in text, (
        "CLAUDE.md must describe Tier 2's config at its visual-review/ location"
    )
    assert "visual-review/storybook/" in text, (
        "CLAUDE.md must describe Tier 2's stories/specs at visual-review/storybook/"
    )
    assert "visual-review/review-app/" in text, (
        "CLAUDE.md must describe Tier 3's review app at visual-review/review-app/"
    )


def test_skill_md_references_relocated_ledger_and_baseline_globs():
    text = _read(SKILL_MD)
    assert "visual-review/baselines" in text, (
        "SKILL.md must reference the relocated Tier 1 baseline glob under "
        "visual-review/baselines/"
    )
    assert "visual-review/visual-approvals.json" in text, (
        "SKILL.md must reference the relocated ledger at "
        "visual-review/visual-approvals.json"
    )
    assert "visual-review/review-app" in text, (
        "SKILL.md must reference the relocated review app at visual-review/review-app/"
    )


# ---------------------------------------------------------------------------
# guard-visual-update.sh: header comment paths updated
# ---------------------------------------------------------------------------

def test_guard_hook_header_comment_has_no_stale_paths():
    src = _read(GUARD_HOOK)
    header = "\n".join(
        line for line in src.splitlines() if line.strip().startswith("#")
    )
    for stale in ("frontend/tests/e2e/*-snapshots/", "frontend/tests/storybook/*-snapshots/"):
        assert stale not in header, (
            f"guard-visual-update.sh header comment still references the "
            f"pre-migration path '{stale}'"
        )


def test_guard_hook_header_comment_references_visual_review_baselines():
    src = _read(GUARD_HOOK)
    header = "\n".join(
        line for line in src.splitlines() if line.strip().startswith("#")
    )
    assert "visual-review/baselines" in header, (
        "guard-visual-update.sh header comment must reference the new baseline "
        "location visual-review/baselines/"
    )
    assert "visual-review/storybook/baselines" in header, (
        "guard-visual-update.sh header comment must reference the new Tier 2 "
        "baseline location visual-review/storybook/baselines/"
    )


# ---------------------------------------------------------------------------
# Now-dead pre-migration files/directories do not exist anywhere in the repo
# ---------------------------------------------------------------------------

def test_frontend_playwright_storybook_config_does_not_exist():
    assert not (ROOT / "frontend" / "playwright.storybook.config.ts").exists(), (
        "frontend/playwright.storybook.config.ts must not exist anywhere in the repo"
    )


def test_frontend_dot_storybook_does_not_exist():
    assert not (ROOT / "frontend" / ".storybook").exists(), (
        "frontend/.storybook/ must not exist anywhere in the repo"
    )


def test_frontend_scripts_visual_review_app_does_not_exist():
    assert not (ROOT / "frontend" / "scripts" / "visual-review-app").exists(), (
        "frontend/scripts/visual-review-app/ must not exist anywhere in the repo"
    )


def test_root_approvals_ledger_does_not_exist():
    assert not (ROOT / "visual-approvals.json").exists(), (
        "the root-level approvals-ledger file must not exist anywhere in the repo"
    )


# ---------------------------------------------------------------------------
# visual-review agent: rename detection in git-diff/git-status logic
# ---------------------------------------------------------------------------

def test_agent_md_uses_rename_detection_flag_on_git_diff():
    text = _read(AGENT_MD)
    diff_invocations = [
        line for line in text.splitlines() if "git diff" in line and "name-only" in line
    ]
    assert diff_invocations, (
        ".claude/agents/visual-review.md must contain a 'git diff --name-only' "
        "baseline-change detection invocation"
    )
    assert any(re.search(r"-M\b|--find-renames\b", line) for line in diff_invocations), (
        ".claude/agents/visual-review.md's git-diff baseline-change detection must "
        "pass a rename-detection flag (-M / --find-renames) so VIS-9-13's "
        "pixel-identical git-mv renames are recognized as renames rather than "
        "reported as brand-new unapproved (pending) baselines"
    )


def test_agent_md_documents_rename_handling_explicitly():
    text = _read(AGENT_MD)
    assert re.search(r"rename", text, re.IGNORECASE), (
        ".claude/agents/visual-review.md must explicitly document how a detected "
        "rename (old baseline path -> new baseline path with identical pixel "
        "content) is treated — carried forward as approved/rejected under its "
        "prior identity, not reported as a fresh pending baseline"
    )
