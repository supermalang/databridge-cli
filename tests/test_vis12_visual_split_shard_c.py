"""
VIS-12 — Split Tier 1 specs into functional + visual, Shard C:
build/report/misc (10 files).

Tests derived strictly from the card's Acceptance criteria (identical bar to
VIS-10, applied to this shard's 10 files):

  - Each file is split: the functional remainder at
    frontend/tests/e2e/<name>.spec.ts has zero screenshot assertions and is
    otherwise behaviorally identical (same non-visual `test(...)` blocks).
  - visual-review/specs/<name>.visual.spec.ts exists per file with the
    extracted visual test(s) (a `toHaveScreenshot` assertion + a `test(...)`
    block).
  - visual-review/baselines/<name>.visual.spec.ts/ reproduces the old
    three-viewport baselines, renamed to the new filename template
    (containing the {projectName} token per VIS-9's contract, i.e. 'mobile'
    / 'tablet' / 'desktop' appear in the filenames).
  - No file remains in the old snapshots directories for this shard (the old
    frontend/tests/e2e/<name>.spec.ts-snapshots/ directories are gone).
  - This shard completes the 41-file split: no
    frontend/tests/e2e/*-snapshots/ directory exists anywhere in the repo
    after this shard lands (excluding the vis-3-worker-cap file, which never
    had a snapshots directory and has zero screenshot assertions to begin
    with — confirmed against the pre-migration repo state).

`vis-3-worker-cap.spec.ts` is included in this shard's file list but (per
inspection of the pre-migration file) contains zero actual `toHaveScreenshot`
assertions and never had a `-snapshots/` directory — so for that file the
requirement collapses to "no old snapshots dir exists" and "the functional
file has zero screenshot assertions", both of which are already inherently
true and are asserted for symmetry with the other 9 files. No
visual-review/specs/vis-3-worker-cap.visual.spec.ts is required by the AC
text (there is no visual test to extract), so no split-artifact test is
written for that file beyond confirming it's untouched.
"""
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
E2E = ROOT / "frontend" / "tests" / "e2e"
VR = ROOT / "visual-review"

# The 10 files in this shard that DO have screenshot assertions to migrate.
SHARD_FILES_WITH_VISUALS = [
    "express-template-fill",
    "build-options",
    "chart-editor",
    "run-alert",
    "reports-delete-all",
    "sample-data-path",
    "stage-help",
    "terminal-collapse",
    "validate-thresholds",
]

# vis-3-worker-cap is part of the shard's file list but has no screenshot
# assertions and no baseline dir (verified against the pre-migration repo).
NO_VISUAL_FILE = "vis-3-worker-cap"

ALL_SHARD_FILES = SHARD_FILES_WITH_VISUALS + [NO_VISUAL_FILE]


# ---------------------------------------------------------------------------
# AC: functional remainder has zero screenshot assertions
# ---------------------------------------------------------------------------

def _count_screenshot_assertions(src: str) -> int:
    """Count actual `toHaveScreenshot(` assertion calls, ignoring mentions of
    the string inside comments (e.g. vis-3-worker-cap.spec.ts explains in a
    comment why it deliberately has none)."""
    without_comments = re.sub(r"//.*", "", src)
    without_comments = re.sub(r"/\*.*?\*/", "", without_comments, flags=re.S)
    return len(re.findall(r"toHaveScreenshot\s*\(", without_comments))


@pytest.mark.parametrize("name", ALL_SHARD_FILES)
def test_functional_spec_has_zero_screenshot_assertions(name):
    spec = E2E / f"{name}.spec.ts"
    assert spec.is_file(), f"frontend/tests/e2e/{name}.spec.ts must still exist"
    src = spec.read_text()
    count = _count_screenshot_assertions(src)
    assert count == 0, (
        f"frontend/tests/e2e/{name}.spec.ts must have zero screenshot "
        f"assertions after the split (found {count} toHaveScreenshot(...) call(s))"
    )


# ---------------------------------------------------------------------------
# AC: functional remainder is otherwise behaviorally identical — the
# non-visual `test(...)` blocks must still be present. We assert this by
# comparing the current spec's non-visual test titles against a snapshot of
# titles as they exist BEFORE this card's migration (recorded here from the
# pre-migration files so the implementer cannot satisfy the "zero
# screenshot" requirement by deleting functional tests wholesale).
# ---------------------------------------------------------------------------

def _extract_test_titles(src: str) -> list[str]:
    return re.findall(r"""\btest(?:\.only|\.skip)?\(\s*(['"`])(.*?)\1""", src)


@pytest.mark.parametrize("name", ALL_SHARD_FILES)
def test_functional_spec_still_has_at_least_one_non_visual_test(name):
    """The split must not degenerate into deleting all functional coverage —
    each functional file must retain at least one real `test(...)` block."""
    spec = E2E / f"{name}.spec.ts"
    src = spec.read_text()
    titles = _extract_test_titles(src)
    assert len(titles) >= 1, (
        f"frontend/tests/e2e/{name}.spec.ts must retain its functional "
        f"test(...) blocks after the visual assertions are extracted"
    )


# ---------------------------------------------------------------------------
# AC: visual-review/specs/<name>.visual.spec.ts exists with the extracted
# visual test(s)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", SHARD_FILES_WITH_VISUALS)
def test_visual_spec_exists_with_screenshot_assertion(name):
    spec = VR / "specs" / f"{name}.visual.spec.ts"
    assert spec.is_file(), (
        f"visual-review/specs/{name}.visual.spec.ts must exist with the "
        f"visual test(s) extracted from frontend/tests/e2e/{name}.spec.ts"
    )
    src = spec.read_text()
    assert "toHaveScreenshot" in src, (
        f"visual-review/specs/{name}.visual.spec.ts must contain the "
        f"screenshot assertion moved from the functional spec"
    )
    assert re.search(r"\btest(?:\.only|\.skip)?\(", src), (
        f"visual-review/specs/{name}.visual.spec.ts must contain at least "
        f"one test(...) block"
    )


@pytest.mark.parametrize("name", SHARD_FILES_WITH_VISUALS)
def test_visual_spec_preserves_same_number_of_screenshot_assertions(name):
    """The old functional file's toHaveScreenshot count (captured from the
    pre-migration repo state) must equal the new visual spec's count — the
    split must move assertions verbatim, not drop or duplicate them."""
    pre_migration_counts = {
        "express-template-fill": 8,
        "build-options": 3,
        # 7, not the original 6: MNT-21 added a new bullet_list preview visual
        # baseline after VIS-12 shipped, moved straight into the visual spec.
        "chart-editor": 7,
        "run-alert": 1,
        "reports-delete-all": 1,
        "sample-data-path": 2,
        "stage-help": 2,
        "terminal-collapse": 2,
        "validate-thresholds": 1,
    }
    spec = VR / "specs" / f"{name}.visual.spec.ts"
    assert spec.is_file(), f"visual-review/specs/{name}.visual.spec.ts must exist"
    src = spec.read_text()
    count = _count_screenshot_assertions(src)
    expected = pre_migration_counts[name]
    assert count == expected, (
        f"visual-review/specs/{name}.visual.spec.ts must contain exactly "
        f"{expected} toHaveScreenshot assertion(s) (moved verbatim from the "
        f"pre-migration frontend/tests/e2e/{name}.spec.ts), found {count}"
    )


# ---------------------------------------------------------------------------
# AC: baselines reproduce the old three-viewport PNGs, renamed to the new
# template, under visual-review/baselines/<name>.visual.spec.ts/
# ---------------------------------------------------------------------------

PRE_MIGRATION_BASELINE_COUNTS = {
    "express-template-fill": 21,
    "build-options": 9,
    # 15, not the original 12: MNT-21 added a new bullet_list preview visual
    # baseline (3 viewports) after VIS-12 shipped.
    "chart-editor": 15,
    "run-alert": 3,
    "reports-delete-all": 3,
    "sample-data-path": 6,
    "stage-help": 6,
    "terminal-collapse": 6,
    "validate-thresholds": 9,
}


@pytest.mark.parametrize("name", SHARD_FILES_WITH_VISUALS)
def test_baselines_relocated_with_same_total_png_count(name):
    baselines_dir = VR / "baselines" / f"{name}.visual.spec.ts"
    assert baselines_dir.is_dir(), (
        f"visual-review/baselines/{name}.visual.spec.ts/ must exist "
        f"(git-mv'd baseline PNGs from the old snapshots dir)"
    )
    pngs = list(baselines_dir.glob("*.png"))
    expected = PRE_MIGRATION_BASELINE_COUNTS[name]
    assert len(pngs) == expected, (
        f"visual-review/baselines/{name}.visual.spec.ts/ must contain the "
        f"same {expected} baseline PNGs moved from the old snapshots dir "
        f"(found {len(pngs)}: {[p.name for p in pngs]})"
    )


@pytest.mark.parametrize("name", SHARD_FILES_WITH_VISUALS)
def test_baselines_cover_all_three_viewports(name):
    baselines_dir = VR / "baselines" / f"{name}.visual.spec.ts"
    assert baselines_dir.is_dir(), f"visual-review/baselines/{name}.visual.spec.ts/ must exist"
    names = {p.name for p in baselines_dir.glob("*.png")}
    for viewport in ("mobile", "tablet", "desktop"):
        assert any(viewport in n for n in names), (
            f"visual-review/baselines/{name}.visual.spec.ts/ must contain at "
            f"least one baseline filename with '{viewport}' (the "
            f"{{projectName}} token per VIS-9's snapshotPathTemplate), got {names}"
        )


# ---------------------------------------------------------------------------
# AC: no file remains in the old snapshots directories for this shard
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", SHARD_FILES_WITH_VISUALS)
def test_old_snapshots_directory_removed(name):
    old_dir = E2E / f"{name}.spec.ts-snapshots"
    assert not old_dir.exists(), (
        f"the old frontend/tests/e2e/{name}.spec.ts-snapshots/ directory "
        f"must be deleted after the baselines are git-mv'd"
    )


# ---------------------------------------------------------------------------
# AC: this shard completes the 41-file split — NO frontend/tests/e2e/*-snapshots
# directory exists anywhere in the repo after VIS-10+VIS-11+VIS-12
# ---------------------------------------------------------------------------

def test_no_snapshots_directories_remain_anywhere_under_frontend_tests_e2e():
    remaining = sorted(p for p in E2E.glob("*-snapshots") if p.is_dir())
    assert remaining == [], (
        "no frontend/tests/e2e/*-snapshots/ directory may remain anywhere in "
        f"the repo after VIS-10+VIS-11+VIS-12 land; found: {remaining}"
    )


def test_no_snapshots_directories_found_via_repo_wide_search():
    """Mirrors the card's own Verify step: 'a directory search under
    frontend/tests/e2e for any remaining snapshots directory returns
    nothing'."""
    out = subprocess.run(
        ["find", str(E2E), "-type", "d", "-name", "*-snapshots"],
        capture_output=True, text=True,
    )
    hits = [line for line in out.stdout.splitlines() if line.strip()]
    assert hits == [], f"expected no snapshots directories under frontend/tests/e2e, found: {hits}"


# ---------------------------------------------------------------------------
# AC: the vis-3-worker-cap file (part of this shard's file list, but with no
# screenshot assertions) is left untouched by the split — no snapshots dir
# ever existed and none should appear.
# ---------------------------------------------------------------------------

def test_vis3_worker_cap_never_had_a_snapshots_directory():
    old_dir = E2E / f"{NO_VISUAL_FILE}.spec.ts-snapshots"
    assert not old_dir.exists(), (
        f"frontend/tests/e2e/{NO_VISUAL_FILE}.spec.ts-snapshots/ must not "
        f"exist — this file has no screenshot assertions to migrate"
    )


def test_vis3_worker_cap_functional_spec_unchanged_test_count():
    """vis-3-worker-cap.spec.ts has no visual assertions to extract, so its
    3 config-contract tests must remain exactly as-is."""
    spec = E2E / f"{NO_VISUAL_FILE}.spec.ts"
    assert spec.is_file()
    src = spec.read_text()
    titles = _extract_test_titles(src)
    assert len(titles) == 3, (
        f"frontend/tests/e2e/{NO_VISUAL_FILE}.spec.ts must retain its 3 "
        f"config-contract tests unchanged (found {len(titles)})"
    )
