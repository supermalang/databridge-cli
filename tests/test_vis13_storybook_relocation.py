"""
VIS-13 — Relocate Tier 2 Storybook config + stories + specs into
visual-review/storybook/.

Tests derived strictly from the card's Acceptance criteria:

  - `frontend/.storybook/`, `frontend/tests/storybook/`, and
    `frontend/playwright.storybook.config.ts` no longer exist
  - the relocated tree exists at `visual-review/storybook/`: `main.ts`,
    `preview.ts`, `stories/Example.stories.jsx`,
    `specs/example.visual.spec.ts`, and a baselines dir with the moved PNGs
  - `visual-review/playwright.storybook.config.ts` exists with `testDir:
    './storybook/specs'`, `snapshotDir: 'storybook/baselines'`, the same
    project-name-token `snapshotPathTemplate` pattern as VIS-9's Tier 1
    config, `outputDir: 'results/storybook/output'`, `baseURL` unchanged
    (http://localhost:6006), and workers: 1 (VIS-8 carried forward)
  - `frontend/package.json`'s `storybook`, `storybook:build`, and both Tier 2
    visual test scripts reference the new config-dir / output-dir under
    `visual-review/storybook/`
  - `.gitignore` drops the dead pre-migration Storybook build/report lines
    and adds `visual-review/storybook/static/`
  - the relocated `main.ts` stories glob still finds real app-component
    stories under `frontend/src/**` as well as the relocated example stories

This does not run the actual Storybook build / Playwright suites (that's
`npm run storybook:build && npm run test:visual:storybook`, exercised at
Verify time) — it asserts the on-disk contract the card requires so the
relocation can be graded automatically, same posture as the VIS-9/10/11/12
precedents.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VR = ROOT / "visual-review"
SB = VR / "storybook"


# ---------------------------------------------------------------------------
# Old locations must be gone
# ---------------------------------------------------------------------------

def test_old_dot_storybook_directory_no_longer_exists():
    assert not (ROOT / "frontend" / ".storybook").exists(), (
        "frontend/.storybook/ must no longer exist after relocation"
    )


def test_old_tests_storybook_directory_no_longer_exists():
    assert not (ROOT / "frontend" / "tests" / "storybook").exists(), (
        "frontend/tests/storybook/ must no longer exist after relocation"
    )


def test_old_playwright_storybook_config_no_longer_exists():
    assert not (ROOT / "frontend" / "playwright.storybook.config.ts").exists(), (
        "frontend/playwright.storybook.config.ts must no longer exist after relocation"
    )


# ---------------------------------------------------------------------------
# New tree exists
# ---------------------------------------------------------------------------

def test_new_storybook_main_config_exists():
    assert (SB / "main.ts").is_file(), "visual-review/storybook/main.ts must exist"


def test_new_storybook_preview_config_exists():
    assert (SB / "preview.ts").is_file(), "visual-review/storybook/preview.ts must exist"


def test_new_example_story_relocated():
    assert (SB / "stories" / "Example.stories.jsx").is_file(), (
        "visual-review/storybook/stories/Example.stories.jsx must exist"
    )


def test_new_example_visual_spec_relocated():
    spec = SB / "specs" / "example.visual.spec.ts"
    assert spec.is_file(), "visual-review/storybook/specs/example.visual.spec.ts must exist"
    src = spec.read_text()
    assert "toHaveScreenshot" in src, (
        "the relocated example.visual.spec.ts must keep its visual assertion"
    )


def test_new_baselines_relocated_for_all_three_viewports():
    baselines_dir = SB / "baselines" / "example.visual.spec.ts"
    assert baselines_dir.is_dir(), (
        "visual-review/storybook/baselines/example.visual.spec.ts/ must exist "
        "(git-mv'd baseline PNGs, renamed to the new snapshotPathTemplate)"
    )
    pngs = list(baselines_dir.glob("*.png"))
    assert len(pngs) >= 1, (
        f"expected relocated baseline PNGs under {baselines_dir}, found none"
    )
    for viewport in ("mobile", "tablet", "desktop"):
        assert any(viewport in p.name for p in pngs), (
            f"expected a baseline filename containing '{viewport}' (project-name token), "
            f"got {[p.name for p in pngs]}"
        )


def test_main_config_stories_glob_still_finds_app_components_and_relocated_examples():
    src = (SB / "main.ts").read_text()
    assert "frontend/src" in src or "../../frontend/src" in src, (
        "visual-review/storybook/main.ts stories glob must still resolve to "
        "real app-component stories under frontend/src/** (VIS-5/VIS-6 colocation)"
    )
    assert "stories/**" in src or "./stories" in src, (
        "visual-review/storybook/main.ts stories glob must also include the "
        "relocated harness/example stories under visual-review/storybook/stories/"
    )


# ---------------------------------------------------------------------------
# New Playwright config
# ---------------------------------------------------------------------------

def _read_storybook_config():
    cfg = VR / "playwright.storybook.config.ts"
    assert cfg.is_file(), "visual-review/playwright.storybook.config.ts must exist"
    return cfg.read_text()


def test_storybook_config_test_dir_is_storybook_specs():
    src = _read_storybook_config()
    assert re.search(r"testDir\s*:\s*['\"]\./storybook/specs['\"]", src), (
        "visual-review/playwright.storybook.config.ts must set testDir: './storybook/specs'"
    )


def test_storybook_config_snapshot_dir_is_storybook_baselines():
    src = _read_storybook_config()
    assert re.search(r"snapshotDir\s*:\s*['\"]storybook/baselines['\"]", src), (
        "visual-review/playwright.storybook.config.ts must set "
        "snapshotDir: 'storybook/baselines'"
    )


def test_storybook_config_snapshot_path_template_includes_project_name_token():
    src = _read_storybook_config()
    m = re.search(r"snapshotPathTemplate\s*:\s*['\"]([^'\"]+)['\"]", src)
    assert m, (
        "visual-review/playwright.storybook.config.ts must define a "
        "snapshotPathTemplate (same pattern as VIS-9's Tier 1 config)"
    )
    template = m.group(1)
    assert "{projectName}" in template, (
        "snapshotPathTemplate must include the {projectName} token — omitting it "
        "collapses all three viewport projects' baselines onto the same filename"
    )


def test_storybook_config_output_dir_is_results_storybook_output():
    src = _read_storybook_config()
    assert re.search(r"outputDir\s*:\s*['\"]results/storybook/output['\"]", src), (
        "visual-review/playwright.storybook.config.ts must set "
        "outputDir: 'results/storybook/output'"
    )


def test_storybook_config_base_url_unchanged():
    src = _read_storybook_config()
    assert "http://localhost:6006" in src, (
        "visual-review/playwright.storybook.config.ts must keep "
        "use.baseURL: 'http://localhost:6006'"
    )


def test_storybook_config_workers_is_one():
    src = _read_storybook_config()
    assert re.search(r"workers\s*:\s*1\b", src), (
        "visual-review/playwright.storybook.config.ts must carry forward VIS-8's "
        "flat workers: 1"
    )


def test_storybook_config_has_three_viewport_projects():
    src = _read_storybook_config()
    assert "width: 390" in src and "844" in src, (
        "visual-review/playwright.storybook.config.ts must define the mobile "
        "viewport (390x844)"
    )
    assert "820" in src and "1180" in src, (
        "visual-review/playwright.storybook.config.ts must define the tablet "
        "viewport (820x1180)"
    )
    assert "1440" in src and "900" in src, (
        "visual-review/playwright.storybook.config.ts must define the desktop "
        "viewport (1440x900)"
    )


# ---------------------------------------------------------------------------
# frontend/package.json scripts
# ---------------------------------------------------------------------------

def _load_package_json():
    return json.loads((ROOT / "frontend" / "package.json").read_text())


def test_storybook_dev_script_points_at_relocated_config_dir():
    scripts = _load_package_json().get("scripts", {})
    cmd = scripts.get("storybook", "")
    assert "visual-review/storybook" in cmd or "../visual-review/storybook" in cmd, (
        "frontend/package.json 'storybook' script must reference the relocated "
        "config-dir under visual-review/storybook/, got: " + cmd
    )


def test_storybook_build_script_points_at_relocated_config_dir_and_output():
    scripts = _load_package_json().get("scripts", {})
    cmd = scripts.get("storybook:build", "")
    assert "visual-review/storybook" in cmd, (
        "frontend/package.json 'storybook:build' script must reference the "
        "relocated config-dir under visual-review/storybook/, got: " + cmd
    )


def test_visual_storybook_script_points_at_relocated_playwright_config():
    scripts = _load_package_json().get("scripts", {})
    cmd = scripts.get("test:visual:storybook", "")
    assert "visual-review/playwright.storybook.config.ts" in cmd, (
        "frontend/package.json 'test:visual:storybook' script must point at "
        "../visual-review/playwright.storybook.config.ts, got: " + cmd
    )


def test_visual_storybook_update_script_points_at_relocated_playwright_config():
    scripts = _load_package_json().get("scripts", {})
    cmd = scripts.get("test:visual:storybook:update", "")
    assert "visual-review/playwright.storybook.config.ts" in cmd, (
        "frontend/package.json 'test:visual:storybook:update' script must point "
        "at ../visual-review/playwright.storybook.config.ts, got: " + cmd
    )
    assert "--update-snapshots" in cmd


# ---------------------------------------------------------------------------
# .gitignore
# ---------------------------------------------------------------------------

def test_gitignore_adds_storybook_static_under_visual_review():
    gi = (ROOT / ".gitignore").read_text()
    assert "visual-review/storybook/static/" in gi, (
        ".gitignore must ignore the relocated static Storybook build output "
        "at visual-review/storybook/static/"
    )


def test_gitignore_drops_dead_pre_migration_storybook_lines():
    gi = (ROOT / ".gitignore").read_text()
    assert "frontend/storybook-static/" not in gi, (
        ".gitignore must remove the dead pre-migration Storybook build output line"
    )
    assert "frontend/playwright-report-storybook/" not in gi, (
        ".gitignore must remove the dead pre-migration Storybook report output line"
    )


# ---------------------------------------------------------------------------
# Tier 1 unaffected
# ---------------------------------------------------------------------------

def test_tier1_visual_config_untouched_by_relocation():
    # Sanity: VIS-13 only touches Tier 2 — the Tier 1 dedicated config must
    # still exist unchanged at its VIS-9 location.
    assert (VR / "playwright.visual.config.ts").is_file(), (
        "visual-review/playwright.visual.config.ts (Tier 1, VIS-9) must be unaffected"
    )
