"""MNT-9 — Translate chart hardcoded strings to project language.

Acceptance criteria tested here:
  AC1 — All hardcoded English column headers and axis labels in charts.py
        ("Count", "Percent", etc.) are translated when `ai.language` is "French".
  AC2 — builder.py passes `ai.language` into the chart dispatch call.
  AC3 — Unknown / unsupported languages fall back to English (no crash).
  AC4 — All existing tests remain green (covered by the full pytest suite).

chart_bar / chart_table call plt.close(fig) internally, so we monkeypatch
plt.close to capture the axes labels before the figure is destroyed.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import pytest
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_df():
    """Minimal DataFrame with a categorical column suitable for bar / table."""
    return pd.DataFrame({
        "Region": ["North", "South", "North", "East", "South", "East", "North"],
    })


class _CaptureFig:
    """Context manager that intercepts plt.close() and captures the last figure's axes."""

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


# ---------------------------------------------------------------------------
# AC1 (bar) — French axis label
# ---------------------------------------------------------------------------

def test_bar_chart_french_ylabel(tmp_path):
    """AC1/bar: chart_bar called with language='French' must NOT label the y-axis
    with the English string 'Count'; it must use the French equivalent ('Nombre').
    """
    from src.reports.charts import chart_bar

    out = tmp_path / "bar_fr.png"
    df = _make_df()
    opts = {"language": "French"}

    with _CaptureFig() as cap:
        chart_bar(df, ["Region"], "Test Bar", out, opts)

    assert cap.axes, "chart_bar produced no axes — rendering may have crashed"
    ax = cap.axes[0]
    ylabel = ax.get_ylabel()

    assert "Count" not in ylabel, (
        f"y-axis label is still 'Count' in French mode — got: {ylabel!r}. "
        "chart_bar must translate 'Count' to 'Nombre' when language='French'."
    )
    assert "Nombre" in ylabel, (
        f"y-axis label does not contain the French word 'Nombre' — got: {ylabel!r}. "
        "chart_bar must use 'Nombre' as the French translation of 'Count'."
    )


# ---------------------------------------------------------------------------
# AC1 (table) — French column headers
# ---------------------------------------------------------------------------

def _extract_table_cell_texts(axes):
    """Extract all cell texts from the first matplotlib Table artist found in axes."""
    texts = []
    for ax in axes:
        for child in ax.get_children():
            if hasattr(child, "get_celld"):
                for (row, col), cell in child.get_celld().items():
                    texts.append(cell.get_text().get_text())
    return texts


def test_table_chart_french_column_headers(tmp_path):
    """AC1/table: chart_table called with language='French' must render column
    headers 'Nombre' and 'Pourcentage' instead of 'Count' and 'Percent'.
    """
    from src.reports.charts import chart_table

    out = tmp_path / "table_fr.png"
    df = _make_df()
    opts = {"language": "French"}

    with _CaptureFig() as cap:
        chart_table(df, ["Region"], "Test Table", out, opts)

    assert cap.axes, "chart_table produced no axes — rendering may have crashed"
    cell_texts = _extract_table_cell_texts(cap.axes)
    assert cell_texts, (
        "No table cells captured — the matplotlib Table artist was not found on the axes."
    )
    header_texts = " ".join(cell_texts)

    assert "Count" not in header_texts, (
        f"Table still uses English 'Count' header in French mode. "
        f"Cell texts: {cell_texts!r}"
    )
    assert "Percent" not in header_texts, (
        f"Table still uses English 'Percent' header in French mode. "
        f"Cell texts: {cell_texts!r}"
    )
    assert "Nombre" in header_texts, (
        f"Table does not contain French header 'Nombre'. "
        f"Cell texts: {cell_texts!r}"
    )
    assert "Pourcentage" in header_texts, (
        f"Table does not contain French header 'Pourcentage'. "
        f"Cell texts: {cell_texts!r}"
    )


# ---------------------------------------------------------------------------
# AC3 — Unknown language falls back to English, no crash
# ---------------------------------------------------------------------------

def test_bar_chart_unknown_language_falls_back_to_english(tmp_path):
    """AC3/bar: Calling chart_bar with an unsupported language must not raise,
    and must fall back to English ('Count') for the y-axis label.
    """
    from src.reports.charts import chart_bar

    out = tmp_path / "bar_unknown.png"
    df = _make_df()
    opts = {"language": "Klingon"}

    with _CaptureFig() as cap:
        chart_bar(df, ["Region"], "Test Bar Unknown Lang", out, opts)

    assert cap.axes, "chart_bar produced no axes"
    ylabel = cap.axes[0].get_ylabel()

    assert "Count" in ylabel, (
        f"Unknown language must fall back to English 'Count' for y-axis label. "
        f"Got: {ylabel!r}"
    )


def test_table_chart_unknown_language_falls_back_to_english(tmp_path):
    """AC3/table: Calling chart_table with an unsupported language must not raise,
    and must fall back to English ('Count', 'Percent') column headers.
    """
    from src.reports.charts import chart_table

    out = tmp_path / "table_unknown.png"
    df = _make_df()
    opts = {"language": "Klingon"}

    with _CaptureFig() as cap:
        chart_table(df, ["Region"], "Test Table Unknown Lang", out, opts)

    assert cap.axes, "chart_table produced no axes"
    cell_texts = _extract_table_cell_texts(cap.axes)
    assert cell_texts, "No table cells captured"
    header_texts = " ".join(cell_texts)

    assert "Count" in header_texts, (
        f"Unknown language must fall back to English 'Count'. "
        f"Cell texts: {cell_texts!r}"
    )
    assert "Percent" in header_texts, (
        f"Unknown language must fall back to English 'Percent'. "
        f"Cell texts: {cell_texts!r}"
    )


# ---------------------------------------------------------------------------
# AC2 — builder.py must pass ai.language into the chart dispatch
# ---------------------------------------------------------------------------

def test_builder_passes_language_to_generate_chart(tmp_path, monkeypatch):
    """AC2: When config has ai.language='French', ReportBuilder must pass the
    language down to generate_chart (which dispatches to the individual chart
    functions).  We verify this by monkeypatching generate_chart and asserting
    that the language kwarg (or opts entry) reaches the function.
    """
    import yaml
    import pandas as pd
    from src.reports.template_generator import generate_template

    ws = tmp_path / "ws_mnt9"
    (ws / "data" / "processed").mkdir(parents=True)
    (ws / "templates").mkdir()
    (ws / "reports").mkdir()

    csv_path = ws / "data" / "processed" / "mnt9_data_20260101_120000.csv"
    pd.DataFrame({"Region": ["A", "B", "A", "C"]}).to_csv(csv_path, index=False)

    template_path = ws / "templates" / "t.docx"

    cfg = {
        "api": {"url": "https://kf.kobotoolbox.org/api/v2", "token": "dummy", "platform": "kobo"},
        "form": {"alias": "mnt9", "uid": "x"},
        "questions": [
            {
                "kobo_key": "Region",
                "label": "Region",
                "type": "select_one",
                "category": "categorical",
                "group": "",
                "export_label": "Region",
            }
        ],
        "filters": [],
        "charts": [
            {
                "name": "region_bar",
                "title": "Region",
                "type": "bar",
                "questions": ["Region"],
                "options": {},
            }
        ],
        "ai": {"language": "French"},
        "report": {
            "template": str(template_path),
            "output_dir": str(ws / "reports"),
            "title": "MNT-9 Lang Test",
            "period": "Q2 2026",
        },
        "export": {
            "format": "csv",
            "output_dir": str(ws / "data" / "processed"),
        },
    }

    generate_template(cfg, template_path)
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)

    # Capture what generate_chart is called with.
    captured_calls = []

    import src.reports.charts as _charts_mod
    original_generate_chart = _charts_mod.generate_chart

    def _spy_generate_chart(chart_cfg, df, out_dir=_charts_mod.CHART_DIR, **kwargs):
        captured_calls.append(dict(chart_cfg=dict(chart_cfg), opts=dict(chart_cfg.get("options", {})), kwargs=kwargs))
        return original_generate_chart(chart_cfg, df, out_dir, **kwargs)

    monkeypatch.setattr("src.reports.builder.generate_chart", _spy_generate_chart)

    from src.reports.builder import ReportBuilder
    ReportBuilder(cfg).build()

    assert captured_calls, "generate_chart was never called — check the builder fixture"

    # The language must have been threaded into the chart config or its options.
    all_passed = []
    for call in captured_calls:
        chart_cfg = call["chart_cfg"]
        opts = call["opts"]
        kwargs = call.get("kwargs", {})
        # Accept language at chart_cfg level, inside opts, or as a kwarg.
        language_in_cfg = chart_cfg.get("language")
        language_in_opts = opts.get("language")
        language_in_kwargs = kwargs.get("language")
        all_passed.append(
            language_in_cfg == "French"
            or language_in_opts == "French"
            or language_in_kwargs == "French"
        )

    assert all(all_passed), (
        f"generate_chart was called without language='French' in at least one call. "
        f"Calls: {captured_calls!r}. "
        "builder.py must thread ai.language into the chart dispatch call."
    )
