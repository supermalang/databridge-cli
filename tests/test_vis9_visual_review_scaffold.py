"""
VIS-9 — Scaffold the visual-review root directory + dedicated Tier 1 visual
config + relocate the Tier 3 review app + ledger.

Tests derived strictly from the card's Acceptance criteria:

  - visual-review/{specs,baselines,results,uat,storybook,review-app}/ all exist
  - visual-review/playwright.visual.config.ts exists with testDir './specs',
    snapshotDir 'baselines', a snapshotPathTemplate containing the project-name
    token, outputDir 'results/output', the html+list reporter pointed at
    results/report, and expect.toHaveScreenshot.animations: 'disabled'
  - frontend/package.json exposes a Tier 1 dedicated-config run script, its
    update variant, and a report-viewer script
  - frontend/scripts/visual-review-app/ no longer exists (moved)
  - visual-review/review-app/{server.mjs,lib.mjs,test.mjs,index.html,README.md} exist
  - visual-review/review-app/server.mjs climbs only 2 dirs to ROOT and defaults
    to the new visual-review/* paths
  - the root-level visual-approvals.json ledger file no longer exists; it lives
    at visual-review/visual-approvals.json instead
  - frontend/tests/e2e/harness-smoke.spec.ts no longer contains a
    toHaveScreenshot assertion, and its old snapshots dir is gone
  - visual-review/specs/harness-smoke.visual.spec.ts exists and contains the
    screenshot assertion
  - .gitignore lists visual-review/results/ and visual-review/uat/
"""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VR = ROOT / "visual-review"


# ---------------------------------------------------------------------------
# Directory scaffold
# ---------------------------------------------------------------------------

def test_visual_review_subdirectories_exist():
    for sub in ("specs", "baselines", "results", "uat", "storybook", "review-app"):
        assert (VR / sub).is_dir(), f"visual-review/{sub}/ must exist"


def test_results_uat_storybook_have_no_tracked_content_yet():
    # Nothing should be *tracked in git* under these dirs (results/uat are
    # gitignored scratch space; storybook/ is populated later by VIS-13).
    for sub in ("results", "uat", "storybook"):
        out = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", f"visual-review/{sub}"],
            capture_output=True, text=True,
        )
        tracked = [l for l in out.stdout.splitlines() if l.strip()]
        assert tracked == [], f"visual-review/{sub}/ must have no tracked files yet, found: {tracked}"


# ---------------------------------------------------------------------------
# Tier 1 dedicated visual config
# ---------------------------------------------------------------------------

def _read_visual_config():
    cfg = VR / "playwright.visual.config.ts"
    assert cfg.is_file(), "visual-review/playwright.visual.config.ts must exist"
    return cfg.read_text()


def test_visual_config_test_dir_is_specs():
    src = _read_visual_config()
    assert re.search(r"testDir\s*:\s*['\"]\./specs['\"]", src), \
        "playwright.visual.config.ts must set testDir: './specs'"


def test_visual_config_snapshot_dir_is_baselines():
    src = _read_visual_config()
    assert re.search(r"snapshotDir\s*:\s*['\"]baselines['\"]", src), \
        "playwright.visual.config.ts must set snapshotDir: 'baselines'"


def test_visual_config_snapshot_path_template_includes_project_name_token():
    src = _read_visual_config()
    m = re.search(r"snapshotPathTemplate\s*:\s*['\"]([^'\"]+)['\"]", src)
    assert m, "playwright.visual.config.ts must define snapshotPathTemplate"
    template = m.group(1)
    assert "{projectName}" in template, (
        "snapshotPathTemplate must include the {projectName} token — omitting it "
        "collapses all three viewport projects' baselines onto the same filename"
    )
    for token in ("{snapshotDir}", "{testFilePath}", "{arg}", "{platform}", "{ext}"):
        assert token in template, f"snapshotPathTemplate must include {token}"


def test_visual_config_output_dir_is_results_output():
    src = _read_visual_config()
    assert re.search(r"outputDir\s*:\s*['\"]results/output['\"]", src), \
        "playwright.visual.config.ts must set outputDir: 'results/output'"


def test_visual_config_reporter_points_at_results_report():
    src = _read_visual_config()
    assert "results/report" in src, \
        "playwright.visual.config.ts html reporter must output to results/report"
    assert "'list'" in src or '"list"' in src, \
        "playwright.visual.config.ts must also configure the list reporter"


def test_visual_config_freezes_animations_and_keeps_diff_ratio():
    src = _read_visual_config()
    assert re.search(r"animations\s*:\s*['\"]disabled['\"]", src), (
        "expect.toHaveScreenshot must set animations: 'disabled' (currently-missing "
        "option this card adds)"
    )
    assert re.search(r"maxDiffPixelRatio\s*:\s*0\.01", src), \
        "expect.toHaveScreenshot must keep maxDiffPixelRatio: 0.01"


def test_visual_config_imports_shared_css_escape_polyfill_not_duplicated():
    src = _read_visual_config()
    assert "css-escape-polyfill" in src, (
        "playwright.visual.config.ts must import the existing polyfill from "
        "frontend/tests/e2e/css-escape-polyfill rather than duplicating it"
    )
    # The polyfill file itself must not be duplicated inside visual-review/.
    duplicated = list(VR.rglob("css-escape-polyfill*"))
    assert duplicated == [], f"polyfill must not be duplicated under visual-review/: {duplicated}"


def test_visual_config_has_three_viewport_projects():
    src = _read_visual_config()
    assert re.search(r"390\s*,\s*height\s*:\s*844", src) or "width: 390" in src, \
        "playwright.visual.config.ts must define the mobile viewport (390x844)"
    assert "820" in src and "1180" in src, \
        "playwright.visual.config.ts must define the tablet viewport (820x1180)"
    assert "1440" in src and "900" in src, \
        "playwright.visual.config.ts must define the desktop viewport (1440x900)"


def test_visual_config_webserver_points_at_vite_dev_server():
    src = _read_visual_config()
    assert "npm run dev" in src, "webServer.command must run 'npm run dev'"
    assert "51730" in src, "webServer.url must target the Vite dev server port 51730"


# ---------------------------------------------------------------------------
# frontend/package.json scripts
# ---------------------------------------------------------------------------

def _load_package_json():
    import json
    return json.loads((ROOT / "frontend" / "package.json").read_text())


def test_package_json_has_tier1_visual_run_script():
    scripts = _load_package_json().get("scripts", {})
    matches = [
        v for k, v in scripts.items()
        if "visual.config" in v and "update" not in k and "storybook" not in k
    ]
    assert matches, (
        "frontend/package.json must add a script running the dedicated Tier 1 "
        "config (playwright.visual.config.ts) distinct from the Tier 2 storybook script"
    )


def test_package_json_has_tier1_visual_update_script():
    scripts = _load_package_json().get("scripts", {})
    matches = [
        v for k, v in scripts.items()
        if "visual.config" in v and "update-snapshots" in v and "storybook" not in k
    ]
    assert matches, (
        "frontend/package.json must add an update variant for the Tier 1 dedicated "
        "config that passes --update-snapshots"
    )


def test_package_json_has_tier1_visual_report_script():
    scripts = _load_package_json().get("scripts", {})
    matches = [
        v for k, v in scripts.items()
        if "show-report" in v and "visual-review/results/report" in v
    ]
    assert matches, (
        "frontend/package.json must add a report-viewer script pointing at "
        "../visual-review/results/report"
    )


# ---------------------------------------------------------------------------
# Relocation: Tier 3 review app
# ---------------------------------------------------------------------------

def test_old_review_app_directory_no_longer_exists():
    assert not (ROOT / "frontend" / "scripts" / "visual-review-app").exists(), (
        "frontend/scripts/visual-review-app/ must no longer exist after relocation"
    )


def test_new_review_app_files_exist():
    review_app = VR / "review-app"
    for fname in ("server.mjs", "lib.mjs", "test.mjs", "index.html", "README.md"):
        assert (review_app / fname).is_file(), f"visual-review/review-app/{fname} must exist"


def test_server_mjs_root_climbs_only_two_directories():
    server = (VR / "review-app" / "server.mjs")
    assert server.is_file(), "visual-review/review-app/server.mjs must exist"
    src = server.read_text()
    # The relocated file sits 2 directories below repo root (visual-review/review-app/),
    # so the fallback ROOT climb must be exactly 2 levels ('..', '..'), not 3.
    assert re.search(r"join\(HERE,\s*['\"]\.\.['\"],\s*['\"]\.\.['\"]\)", src), (
        "server.mjs ROOT fallback must climb exactly 2 directories "
        "(join(HERE, '..', '..')) now that it lives 2 levels below repo root"
    )
    assert not re.search(r"join\(HERE,\s*['\"]\.\.['\"],\s*['\"]\.\.['\"],\s*['\"]\.\.['\"]\)", src), (
        "server.mjs must not still climb 3 directories (the old, now-wrong depth)"
    )


def test_server_mjs_default_paths_point_at_visual_review_tree():
    server = VR / "review-app" / "server.mjs"
    src = server.read_text()
    assert "visual-review/baselines" in src, \
        "server.mjs baselines-dir default must be 'visual-review/baselines'"
    assert "visual-review/results/output" in src, \
        "server.mjs output-dir default must be 'visual-review/results/output'"
    assert "visual-review/visual-approvals.json" in src, \
        "server.mjs approvals-file default must be 'visual-review/visual-approvals.json'"
    # Old defaults must be gone.
    assert "frontend/tests'" not in src and 'frontend/tests"' not in src, \
        "server.mjs must not still default the baselines dir to 'frontend/tests'"
    assert "frontend/test-results" not in src, \
        "server.mjs must not still default the output dir to 'frontend/test-results'"


def test_review_app_test_mjs_imports_lib_from_same_directory():
    test_mjs = VR / "review-app" / "test.mjs"
    assert test_mjs.is_file(), "visual-review/review-app/test.mjs must exist"
    src = test_mjs.read_text()
    assert "./lib.mjs" in src, "test.mjs must import lib.mjs via a relative import in its new directory"


# ---------------------------------------------------------------------------
# Relocation: approvals ledger
# ---------------------------------------------------------------------------

def test_root_level_approvals_ledger_no_longer_exists():
    assert not (ROOT / "visual-approvals.json").exists(), (
        "the root-level visual-approvals.json ledger must no longer exist after relocation"
    )


def test_approvals_ledger_relocated_under_visual_review():
    assert (VR / "visual-approvals.json").is_file(), (
        "visual-review/visual-approvals.json must exist (the relocated ledger)"
    )


# ---------------------------------------------------------------------------
# .gitignore additions
# ---------------------------------------------------------------------------

def test_gitignore_covers_new_visual_review_scratch_dirs():
    gi = (ROOT / ".gitignore").read_text()
    assert "visual-review/results/" in gi, ".gitignore must ignore visual-review/results/"
    assert "visual-review/uat/" in gi, ".gitignore must ignore visual-review/uat/"


def test_gitignore_still_covers_old_frontend_visual_dirs():
    # VIS-14 retires these later; this card must NOT remove them yet.
    gi = (ROOT / ".gitignore").read_text()
    for legacy in ("frontend/playwright-report/", "frontend/blob-report/",
                   "frontend/test-results/", "frontend/.playwright/"):
        assert legacy in gi, f".gitignore must still contain {legacy} (VIS-14 retires it, not this card)"


# ---------------------------------------------------------------------------
# Pilot migration: harness-smoke
# ---------------------------------------------------------------------------

def test_frontend_harness_smoke_spec_no_longer_has_screenshot_assertion():
    spec = ROOT / "frontend" / "tests" / "e2e" / "harness-smoke.spec.ts"
    assert spec.is_file(), "frontend/tests/e2e/harness-smoke.spec.ts must still exist"
    src = spec.read_text()
    assert "toHaveScreenshot" not in src, (
        "frontend/tests/e2e/harness-smoke.spec.ts must have its screenshot assertion "
        "removed (moved to the visual-review pilot spec) but keep a functional check"
    )
    assert "toBeVisible" in src, (
        "frontend/tests/e2e/harness-smoke.spec.ts must keep a minimal functional "
        "visibility check on main.card"
    )


def test_old_harness_smoke_snapshots_directory_removed():
    old_dir = ROOT / "frontend" / "tests" / "e2e" / "harness-smoke.spec.ts-snapshots"
    assert not old_dir.exists(), (
        "the now-empty frontend/tests/e2e/harness-smoke.spec.ts-snapshots/ directory "
        "must be deleted after the baselines are git-mv'd"
    )


def test_new_visual_pilot_spec_exists_with_screenshot_assertion():
    spec = VR / "specs" / "harness-smoke.visual.spec.ts"
    assert spec.is_file(), "visual-review/specs/harness-smoke.visual.spec.ts must exist"
    src = spec.read_text()
    assert "toHaveScreenshot" in src, (
        "visual-review/specs/harness-smoke.visual.spec.ts must contain the "
        "screenshot assertion moved from the frontend spec"
    )


def test_new_baselines_relocated_for_all_three_viewports():
    baselines_dir = VR / "baselines" / "harness-smoke.visual.spec.ts"
    assert baselines_dir.is_dir(), (
        "visual-review/baselines/harness-smoke.visual.spec.ts/ must exist "
        "(git-mv'd baseline PNGs, renamed to the new snapshotPathTemplate)"
    )
    pngs = list(baselines_dir.glob("*.png"))
    assert len(pngs) == 3, (
        f"expected 3 distinct baseline PNGs (mobile/tablet/desktop), found {len(pngs)}: {pngs}"
    )
    names = {p.name for p in pngs}
    assert len(names) == 3, "the three baseline PNGs must have three distinct filenames"
    for viewport in ("mobile", "tablet", "desktop"):
        assert any(viewport in n for n in names), (
            f"expected a baseline filename containing '{viewport}' (project-name token), "
            f"got {names}"
        )
