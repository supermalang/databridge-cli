"""
VIS-8 — Fix: uncap hardcoded worker count to stop full-suite instability.

Both frontend/playwright.config.ts and frontend/playwright.storybook.config.ts
previously hardcoded a flat `workers: 4`, which contradicted VIS-3's rationale
(the three viewport projects share one Vite dev server) and was confirmed
unstable under full-suite load — 25/69 crash-class failures at 4 workers vs
0/69 at 1. The fix caps both configs at a flat `workers: 1`.

This supersedes the earlier `process.env.CI ? 1 : '50%'` proposal: `'50%'` is a
string that can never satisfy VIS-3's frozen `vis-3-worker-cap.spec.ts`
assertion that the resolved worker value be a number in [1, 2], and — being
>= 4 workers on most machines — would reintroduce the very crashes VIS-8 fixes.

Tests derived strictly from the amended card's Acceptance criteria:

  - Worker count is a flat `workers: 1` in both configs, replacing the value of 4
  - The resolved worker value is 1 under both CI and local (single-worker,
    deterministic; satisfies VIS-3's [1, 2] contract)
  - No change to `fullyParallel`, `retries`, `expect.toHaveScreenshot`, or
    `webServer`

The crash-class-failure and chart-editor.spec.ts 33/33 criteria are validated by
running the Playwright harness itself (3 consecutive full runs) — a human/harness
gate, not statically assertable here. This file asserts the on-disk config
contract so the value change can be graded automatically (same static-config
posture as test_vis11_*).
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

MAIN_CONFIG = FRONTEND / "playwright.config.ts"
STORYBOOK_CONFIG = FRONTEND / "playwright.storybook.config.ts"

CONFIGS = [
    pytest.param(MAIN_CONFIG, id="playwright.config.ts"),
    pytest.param(STORYBOOK_CONFIG, id="playwright.storybook.config.ts"),
]


def _read(path: Path) -> str:
    assert path.exists(), f"expected config file to exist: {path}"
    return path.read_text(encoding="utf-8")


def _workers_value(text: str) -> str:
    """Return the normalised right-hand side of the top-level `workers:` key."""
    m = re.search(r"^\s*workers:\s*(.+?),?\s*$", text, re.MULTILINE)
    assert m is not None, "no top-level `workers:` key found in config"
    return re.sub(r"\s+", "", m.group(1))


@pytest.mark.parametrize("config_path", CONFIGS)
def test_workers_is_flat_one(config_path: Path):
    """AC: worker count is a flat `workers: 1` in both configs."""
    value = _workers_value(_read(config_path))
    assert value == "1", (
        f"{config_path.name}: workers must be a flat `1`, got `{value}`"
    )


@pytest.mark.parametrize("config_path", CONFIGS)
def test_workers_flat_four_is_gone(config_path: Path):
    """AC: the hardcoded value of 4 is replaced (no `workers: 4` remains)."""
    text = _read(config_path)
    assert re.search(r"^\s*workers:\s*4\s*,?\s*$", text, re.MULTILINE) is None, (
        f"{config_path.name}: hardcoded `workers: 4` must be replaced by a flat 1"
    )


@pytest.mark.parametrize("config_path", CONFIGS)
def test_workers_is_single_worker_number(config_path: Path):
    """AC: the resolved worker value is 1 (numeric single worker).

    A flat `1` resolves to 1 under both CI and local, keeping the run
    deterministic and satisfying VIS-3's [1, 2] numeric contract. Guards against
    a regression back to a string value (e.g. '50%') that VIS-3 forbids.
    """
    value = _workers_value(_read(config_path))
    assert value.isdigit(), (
        f"{config_path.name}: workers must be a bare number, not a string "
        f"expression, got `{value}`"
    )
    assert 1 <= int(value) <= 2, (
        f"{config_path.name}: resolved worker count must be in [1, 2], got `{value}`"
    )


# --- Unchanged fields (AC: no change to fullyParallel, retries,
# expect.toHaveScreenshot, or webServer). These exist to catch a regression
# where the edit touches more than the single `workers` line the card scopes. ---


@pytest.mark.parametrize("config_path", CONFIGS)
def test_fully_parallel_unchanged(config_path: Path):
    text = _read(config_path)
    assert re.search(r"fullyParallel:\s*true", text), (
        f"{config_path.name}: fullyParallel must remain `true`"
    )


@pytest.mark.parametrize("config_path", CONFIGS)
def test_retries_unchanged(config_path: Path):
    text = _read(config_path)
    normalised = re.sub(r"\s+", "", text)
    assert "retries:process.env.CI?1:0" in normalised, (
        f"{config_path.name}: retries must remain `process.env.CI ? 1 : 0`"
    )


@pytest.mark.parametrize("config_path", CONFIGS)
def test_to_have_screenshot_tolerance_unchanged(config_path: Path):
    text = _read(config_path)
    normalised = re.sub(r"\s+", "", text)
    assert "toHaveScreenshot:{maxDiffPixelRatio:0.01}" in normalised, (
        f"{config_path.name}: expect.toHaveScreenshot tolerance must remain "
        f"maxDiffPixelRatio 0.01"
    )


@pytest.mark.parametrize("config_path", CONFIGS)
def test_web_server_block_present(config_path: Path):
    text = _read(config_path)
    assert re.search(r"webServer:\s*{", text), (
        f"{config_path.name}: the webServer block must remain present/unchanged"
    )
