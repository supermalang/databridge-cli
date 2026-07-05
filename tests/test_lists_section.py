"""MNT-23 -- tests for the new first-class `list` kind's report-generation
side: ReportBuilder._generate_lists() (cfg['lists'] -> {{ list_<name> }}
context entries, rendered via the existing build_bullet_list_text) and
template_generator.py emitting {{ list_<name> }} placeholders for cfg['lists']
entries.

Mirrors the precedent set by tests/test_tables_section.py for cfg['tables'].
"""
from pathlib import Path

import pandas as pd
from docx import Document

from src.reports.builder import ReportBuilder
from src.reports.charts import build_bullet_list_text
from src.reports.template_generator import generate_template


def _doc_text(path: Path) -> str:
    doc = Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs)


# ── ReportBuilder._generate_lists() ─────────────────────────────────────────

def test_generate_lists_produces_list_keys():
    """Each cfg['lists'] entry yields a list_<name> context key, whose value is
    the raw bullet-prefixed text produced by build_bullet_list_text -- not an
    image."""
    cfg = {
        "questions": [],
        "lists": [{"name": "stories", "title": "Stories", "question": "Story"}],
    }
    df = pd.DataFrame({"Story": ["Alpha", "Beta", "Gamma"]})

    rb = ReportBuilder(cfg)

    class _FakeTpl:
        pass

    images = rb._generate_lists(_FakeTpl(), df, {})
    assert "list_stories" in images, f"expected 'list_stories' key, got: {list(images.keys())}"
    value = images["list_stories"]
    assert isinstance(value, str), f"list_stories must be a plain string, got {type(value)}"
    for name in ("Alpha", "Beta", "Gamma"):
        assert name in value, f"expected '{name}' in rendered list: {value!r}"


def test_generate_lists_empty_when_no_lists():
    cfg = {"questions": []}
    rb = ReportBuilder(cfg)
    assert rb._generate_lists(object(), pd.DataFrame(), {}) == {}


def test_generate_lists_renders_identically_to_build_bullet_list_text():
    """AC: _generate_lists() renders via build_bullet_list_text identically to
    how the old bullet_list-as-chart-type path renders today -- i.e. the
    context value for a cfg['lists'] entry must equal calling
    build_bullet_list_text directly on the same column."""
    cfg = {
        "questions": [],
        "lists": [{"name": "stories", "title": "Stories", "question": "Story"}],
    }
    df = pd.DataFrame({"Story": ["Alpha", "", "Gamma", None]})

    rb = ReportBuilder(cfg)
    images = rb._generate_lists(object(), df, {})

    expected = build_bullet_list_text(df, ["Story"], {})
    assert images["list_stories"] == expected, (
        f"expected identical output to build_bullet_list_text: {expected!r}, "
        f"got: {images.get('list_stories')!r}"
    )


def test_generate_lists_applies_optional_filter():
    """Config/schema impact: cfg['lists'] entries support an optional `filter`
    field -- only rows matching the filter expression are listed."""
    cfg = {
        "questions": [],
        "lists": [{
            "name": "stories", "title": "Stories",
            "question": "Story", "filter": "Region == 'N'",
        }],
    }
    df = pd.DataFrame({
        "Story": ["Alpha", "Beta", "Gamma"],
        "Region": ["N", "N", "S"],
    })

    rb = ReportBuilder(cfg)
    images = rb._generate_lists(object(), df, {})
    value = images["list_stories"]
    assert "Alpha" in value and "Beta" in value, value
    assert "Gamma" not in value, (
        f"row with Region='S' must be excluded by the filter, got: {value!r}"
    )


# ── template_generator.py: {{ list_<name> }} placeholder emission ──────────

def test_generate_template_emits_list_placeholder_for_lists_section(tmp_path):
    """AC: template_generator.py emits {{ list_<name> }} placeholders for
    cfg['lists'] entries when auto-building a Word template."""
    cfg = {
        "questions": [],
        "lists": [{"name": "stories", "title": "Success stories", "question": "Story"}],
    }
    out = tmp_path / "tpl.docx"

    generate_template(cfg, out)

    text = _doc_text(out)
    assert "{{ list_stories }}" in text, (
        f"generate_template must emit '{{{{ list_stories }}}}' for a cfg['lists'] "
        f"entry named 'stories'. Document text:\n{text}"
    )
    assert "{{ chart_stories }}" not in text
    assert "{{ table_stories }}" not in text
