"""MNT-11 — Named chart colour palettes selectable from `config.yml`.

Acceptance criteria tested here:
  AC1 — charts.py defines 5 named palettes (slate, teal, earth, indigo, olive),
        each exactly 10 hex colours.
  AC2 — config.py exposes get_palette(cfg) returning the named palette, or the
        default ("slate") when brand.palette is absent or unrecognised.
  AC3 — _palette() / _color() accept an optional `palette` argument and use it
        instead of the module-level PALETTE constant (exercised indirectly via
        chart_bar / chart_pie, which are the public chart entry points that call
        into _color()/_palette()).
  AC4 — An unknown palette name logs a warning and falls back to "slate" (no
        crash) — covered by test_unknown_palette_falls_back_to_slate.
  AC5 — get_palette({}) (brand.palette absent) returns the slate palette.

Card-specified unit tests (see docs/ROADMAP.md MNT-11) are reproduced below,
adapted to this codebase's actual public chart entry points (`chart_bar`,
`chart_pie`) since the card's bar()/pie() are the dispatch functions'
informal names.
"""
import logging

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import pytest


class _CaptureFig:
    """Context manager that intercepts plt.close() to capture axes before
    the figure is destroyed (chart_* functions call plt.close(fig) internally).
    """

    def __init__(self):
        self.axes = []
        self._orig_close = None

    def __enter__(self):
        self._orig_close = plt.close
        capture = self

        def _mock_close(fig=None):
            fig_to_use = fig if fig is not None else plt.gcf()
            capture.axes = list(fig_to_use.axes)
            capture._orig_close(fig_to_use)

        plt.close = _mock_close
        return self

    def __exit__(self, *args):
        plt.close = self._orig_close


def _make_categorical_df():
    return pd.DataFrame({
        "Region": ["North", "South", "North", "East", "South", "East", "North"],
    })


# ---------------------------------------------------------------------------
# AC1 + AC3 — bar chart uses the named "slate" palette's first colour
# ---------------------------------------------------------------------------

def test_palette_bar_uses_slate_sequence(tmp_path):
    """AC1/AC3: chart_bar rendered with palette="slate" must draw its first
    bar using the slate palette's leading colour (#1D3557), not the module's
    hardcoded default PALETTE.
    """
    from src.reports.charts import chart_bar

    out = tmp_path / "bar_slate.png"
    df = _make_categorical_df()
    opts = {"palette": "slate"}

    with _CaptureFig() as cap:
        chart_bar(df, ["Region"], "Test Bar", out, opts)

    assert cap.axes, "chart_bar produced no axes — rendering may have crashed"
    ax = cap.axes[0]
    assert ax.patches, "chart_bar produced no bar patches"

    r, g, b, _ = ax.patches[0].get_facecolor()
    rgb = (round(r * 255), round(g * 255), round(b * 255))

    assert rgb == (0x1D, 0x35, 0x57), (
        f"expected the first bar to use the slate palette's leading colour "
        f"#1D3557 (29, 53, 87), got RGB {rgb}. chart_bar must resolve the "
        "'palette' opt to the named slate sequence via _color()/_palette()."
    )


# ---------------------------------------------------------------------------
# AC1 + AC3 — pie chart uses the named "teal" palette's first colour
# ---------------------------------------------------------------------------

def test_palette_pie_uses_teal_sequence(tmp_path):
    """AC1/AC3: chart_pie rendered with palette="teal" must draw its first
    wedge using the teal palette's leading colour (#134E4A).
    """
    from src.reports.charts import chart_pie

    out = tmp_path / "pie_teal.png"
    df = _make_categorical_df()
    opts = {"palette": "teal"}

    with _CaptureFig() as cap:
        chart_pie(df, ["Region"], "Test Pie", out, opts)

    assert cap.axes, "chart_pie produced no axes — rendering may have crashed"
    ax = cap.axes[0]
    assert ax.patches, "chart_pie produced no wedge patches"

    r, g, b, _ = ax.patches[0].get_facecolor()
    rgb = (round(r * 255), round(g * 255), round(b * 255))

    assert rgb == (0x13, 0x4E, 0x4A), (
        f"expected the first pie wedge to use the teal palette's leading "
        f"colour #134E4A (19, 78, 74), got RGB {rgb}. chart_pie must resolve "
        "the 'palette' opt to the named teal sequence."
    )


# ---------------------------------------------------------------------------
# AC2 — unknown palette name falls back to slate, with a warning, no crash
# ---------------------------------------------------------------------------

def test_unknown_palette_falls_back_to_slate(caplog):
    """AC2: get_palette() with an unrecognised brand.palette name must fall
    back to the slate palette and log a warning rather than raising.
    """
    from src.utils.config import get_palette, PALETTES

    with caplog.at_level(logging.WARNING):
        result = get_palette({"brand": {"palette": "nonexistent"}})

    assert result == PALETTES["slate"], (
        f"expected fallback to PALETTES['slate'] for an unknown palette name, "
        f"got {result!r}"
    )
    assert any("unknown palette" in rec.message.lower() for rec in caplog.records), (
        "expected a warning log mentioning 'unknown palette' when brand.palette "
        f"is unrecognised; captured log messages: {[r.message for r in caplog.records]!r}"
    )


# ---------------------------------------------------------------------------
# AC2 — absent brand.palette falls back to slate (no breaking change)
# ---------------------------------------------------------------------------

def test_get_palette_absent_returns_slate():
    """AC2: get_palette({}) — no brand.palette key at all — must return the
    default slate palette (backward-compatible default)."""
    from src.utils.config import get_palette, PALETTES

    result = get_palette({})

    assert result == PALETTES["slate"], (
        f"expected get_palette({{}}) to fall back to PALETTES['slate'] when "
        f"brand.palette is absent, got {result!r}"
    )


# ---------------------------------------------------------------------------
# AC1 — every named palette has exactly 10 hex colours
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["slate", "teal", "earth", "indigo", "olive"])
def test_named_palette_has_ten_hex_colours(name):
    """AC1: charts.py must define all 5 named palettes, each a list of
    exactly 10 valid hex colour strings.
    """
    from src.reports.charts import PALETTES

    assert name in PALETTES, f"expected PALETTES to define a '{name}' entry"
    palette = PALETTES[name]
    assert len(palette) == 10, (
        f"expected palette '{name}' to have exactly 10 colours, got {len(palette)}"
    )
    for color in palette:
        assert isinstance(color, str) and color.startswith("#") and len(color) == 7, (
            f"expected each colour in palette '{name}' to be a 7-char hex string "
            f"like '#1D3557', got {color!r}"
        )

