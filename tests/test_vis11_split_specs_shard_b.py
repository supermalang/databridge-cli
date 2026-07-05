"""
VIS-11 — Split Tier 1 specs into functional + visual, Shard B: i18n /
product-UX / composition (15 files).

Same mechanical transformation as VIS-10 (see that card + its
`test_vis10_*` precedent), applied to this shard's 15 files:

    i18n-coverage.spec.ts, i18n-remaining.spec.ts, i18n-subtabs.spec.ts,
    i18n-switch.spec.ts, nav-labels.spec.ts, project-language.spec.ts,
    perf-3-skeleton.spec.ts, pux-1.spec.ts, pux-2.spec.ts,
    composition-progressive.spec.ts, composition-bullet-list.spec.ts,
    composition-chart-title-required.spec.ts, connection-gating.spec.ts,
    copy-placeholder.spec.ts, client-cache.spec.ts

Tests derived strictly from the card's Acceptance criteria:

  - each file's functional remainder at frontend/tests/e2e/<name>.spec.ts has
    zero `toHaveScreenshot` assertions, and is otherwise behaviorally
    unchanged (test names/count preserved)
  - visual-review/specs/<name>.visual.spec.ts exists for every file that
    actually had a screenshot assertion pre-migration, containing the
    extracted visual test(s) (client-cache.spec.ts has NO screenshot
    assertions before or after — same "nothing to extract" posture as the
    VIS-10 exclusion note's three files, so no visual spec is required for it)
  - visual-review/baselines/<name>.visual.spec.ts/ reproduces the same
    three-viewport baseline PNGs (mobile/tablet/desktop), renamed to the new
    filename template, for every migrated file
  - no file remains in the old frontend/tests/e2e/<name>.spec.ts-snapshots/
    directory for any of the 15 files — the old directory must be gone

This does not run the actual Playwright suites (that's `npm run test:e2e` /
`npm run test:visual`, exercised at Verify time) — it asserts the on-disk
contract the card requires so the split can be graded automatically.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
E2E = ROOT / "frontend" / "tests" / "e2e"
VR = ROOT / "visual-review"

# name -> whether it currently has any toHaveScreenshot assertions to extract
# (established by inspecting the pre-migration files' pre-existing baselines
# directories: client-cache.spec.ts is the one file in this shard with none,
# matching the VIS-10 exclusion-note posture for its 3 zero-screenshot files).
SHARD_FILES = [
    "i18n-coverage",
    "i18n-remaining",
    "i18n-subtabs",
    "i18n-switch",
    "nav-labels",
    "project-language",
    "perf-3-skeleton",
    "pux-1",
    "pux-2",
    "composition-progressive",
    "composition-bullet-list",
    "composition-chart-title-required",
    "connection-gating",
    "copy-placeholder",
    "client-cache",
]

# Files in this shard that had screenshot assertions before the split and
# therefore must get a visual-review/specs/<name>.visual.spec.ts extraction.
FILES_WITH_VISUALS = [f for f in SHARD_FILES if f != "client-cache"]

# client-cache.spec.ts ships zero toHaveScreenshot assertions today (the one
# textual match in the file is a comment: "No `toHaveScreenshot` baseline —
# this card is behavioural."), so it is excluded from the visual-extraction
# requirement, same as VIS-10's three noted exclusions.
FILES_WITHOUT_VISUALS = ["client-cache"]


def _read(path: Path) -> str:
    assert path.is_file(), f"expected file to exist: {path}"
    return path.read_text()


def _count_screenshot_assertions(src: str) -> int:
    # Count real assertions, not the explanatory doc-comment mentioning the
    # API name (client-cache.spec.ts has exactly that comment today).
    return len(re.findall(r"await\s+expect\([^)]*\)\)?\.toHaveScreenshot\(", src))


# ---------------------------------------------------------------------------
# AC1 — functional remainder has zero screenshot assertions
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", SHARD_FILES)
def test_functional_file_still_exists(name):
    spec = E2E / f"{name}.spec.ts"
    assert spec.is_file(), f"frontend/tests/e2e/{name}.spec.ts must still exist after the split"


@pytest.mark.parametrize("name", SHARD_FILES)
def test_functional_file_has_zero_screenshot_assertions(name):
    spec = E2E / f"{name}.spec.ts"
    src = _read(spec)
    count = _count_screenshot_assertions(src)
    assert count == 0, (
        f"frontend/tests/e2e/{name}.spec.ts must have zero toHaveScreenshot "
        f"assertions after the split (found {count})"
    )


# ---------------------------------------------------------------------------
# AC2 — visual-review/specs/<name>.visual.spec.ts exists with extracted tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", FILES_WITH_VISUALS)
def test_visual_spec_exists_for_files_with_screenshots(name):
    visual_spec = VR / "specs" / f"{name}.visual.spec.ts"
    assert visual_spec.is_file(), (
        f"visual-review/specs/{name}.visual.spec.ts must exist — "
        f"{name}.spec.ts had toHaveScreenshot assertion(s) to extract"
    )


@pytest.mark.parametrize("name", FILES_WITH_VISUALS)
def test_visual_spec_contains_screenshot_assertion(name):
    visual_spec = VR / "specs" / f"{name}.visual.spec.ts"
    assert visual_spec.is_file(), f"visual-review/specs/{name}.visual.spec.ts must exist"
    src = _read(visual_spec)
    count = _count_screenshot_assertions(src)
    assert count >= 1, (
        f"visual-review/specs/{name}.visual.spec.ts must contain at least one "
        f"toHaveScreenshot assertion moved verbatim from the original spec"
    )


@pytest.mark.parametrize("name", FILES_WITHOUT_VISUALS)
def test_no_visual_spec_required_for_files_without_screenshots(name):
    # client-cache.spec.ts has no screenshot assertions to extract, matching
    # the VIS-10 exclusion-note posture — asserting this explicitly protects
    # against accidentally fabricating a visual spec with no real content.
    spec = E2E / f"{name}.spec.ts"
    src = _read(spec)
    assert _count_screenshot_assertions(src) == 0, (
        f"{name}.spec.ts is expected to have no screenshot assertions "
        f"pre-or-post migration (nothing to extract)"
    )


# ---------------------------------------------------------------------------
# AC3 — baselines relocated under visual-review/baselines/<name>.visual.spec.ts/
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", FILES_WITH_VISUALS)
def test_baselines_relocated_with_three_viewports(name):
    baselines_dir = VR / "baselines" / f"{name}.visual.spec.ts"
    assert baselines_dir.is_dir(), (
        f"visual-review/baselines/{name}.visual.spec.ts/ must exist "
        f"(git-mv'd baseline PNGs, renamed to the new snapshotPathTemplate)"
    )
    pngs = list(baselines_dir.glob("*.png"))
    assert pngs, f"visual-review/baselines/{name}.visual.spec.ts/ must contain baseline PNGs"
    for viewport in ("mobile", "tablet", "desktop"):
        assert any(viewport in p.name for p in pngs), (
            f"visual-review/baselines/{name}.visual.spec.ts/ must contain a "
            f"baseline whose filename encodes the '{viewport}' project"
        )


# ---------------------------------------------------------------------------
# AC5 — no file remains in the old snapshots directories for this shard
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", SHARD_FILES)
def test_old_snapshots_directory_removed(name):
    old_dir = E2E / f"{name}.spec.ts-snapshots"
    assert not old_dir.exists(), (
        f"frontend/tests/e2e/{name}.spec.ts-snapshots/ must no longer exist "
        f"— baselines must be fully moved (git mv), not duplicated"
    )


# ---------------------------------------------------------------------------
# Sanity: functional test bodies/count preserved (AC1's "behaviorally
# identical otherwise" clause) — a coarse but real signal: the non-visual
# `test(...)` blocks must not have been dropped by the split.
# ---------------------------------------------------------------------------

def _count_test_blocks(src: str) -> int:
    # Matches both string-literal and template-literal test names, e.g.
    # test('foo', ...) and test(`${tab.name} ...`, ...).
    return len(re.findall(r"\btest\(\s*[`'\"]", src))


@pytest.mark.parametrize("name", FILES_WITH_VISUALS)
def test_functional_file_keeps_at_least_one_non_visual_test(name):
    spec = E2E / f"{name}.spec.ts"
    src = _read(spec)
    assert _count_test_blocks(src) >= 1, (
        f"frontend/tests/e2e/{name}.spec.ts must retain at least one functional "
        f"test() block after the visual assertion(s) are extracted"
    )
