"""Unit tests for XTF-1 — placeholder extraction from .docx.

These tests are the spec for ``extract_placeholders(docx_path) -> List[Token]``
(``src/reports/template_inference.py``), derived strictly from the XTF-1
acceptance criteria and design spec §4.1. They are written before the
implementation exists and are expected to be RED until it lands.

Contract committed to here (minimal, AC-derived):

``extract_placeholders(docx_path)`` returns a list of ``Token`` objects, in
document order, one per matched placeholder. Each ``Token`` exposes:

* ``raw``        -- the full delimited string, e.g. ``"[[Total]]"`` / ``"{{ x }}"``
* ``inner``      -- the trimmed inner text, e.g. ``"Total"`` / ``"x"``
* ``delimiter``  -- one of ``"[["``, ``"["``, ``"{{"`` (the opening delimiter)
* ``kind``       -- ``"literal"`` for a known ``{{ }}`` literal placeholder;
                    any other (non-``"literal"``) value for NL tokens to infer
* ``location``   -- an object/mapping carrying enough to rewrite the token later:
                    a ``runs`` sequence of integer run indices the token spans,
                    and ``paragraph_text`` = the reconstructed full paragraph text.

Attribute access is used throughout; if the implementer chooses a dataclass
these read as attributes. (A dict-shaped Token would fail these tests, which is
an intentional contract choice.)
"""
import pytest

from docx import Document

# Import the unit under test. If the module / symbol does not exist yet this
# raises at collection time, which is an acceptable RED for XTF-1 (the function
# is unimplemented). It is NOT a typo / fixture error.
from src.reports.template_inference import extract_placeholders


# --------------------------------------------------------------------------- #
# Fixtures / helpers (build .docx programmatically with python-docx)
# --------------------------------------------------------------------------- #

def _save(doc, tmp_path, name="t.docx"):
    path = tmp_path / name
    doc.save(str(path))
    return str(path)


def _by_raw(tokens):
    """Index returned tokens by their ``raw`` string for order-independent asserts."""
    out = {}
    for t in tokens:
        out.setdefault(t.raw, []).append(t)
    return out


@pytest.fixture
def one_per_delimiter_docx(tmp_path):
    """A body with exactly one placeholder of each delimiter, each in its own
    paragraph (each placeholder is a single run -> trivially matched)."""
    doc = Document()
    doc.add_paragraph("[[Total Beneficiaries]]")
    doc.add_paragraph("[Average Age]")
    doc.add_paragraph("{{ region breakdown }}")
    return _save(doc, tmp_path)


# --------------------------------------------------------------------------- #
# AC: each delimiter matched individually
# --------------------------------------------------------------------------- #

def test_extract_double_square_delimiter(tmp_path):
    doc = Document()
    doc.add_paragraph("[[Total Beneficiaries]]")
    tokens = extract_placeholders(_save(doc, tmp_path))
    assert len(tokens) == 1
    tok = tokens[0]
    assert tok.raw == "[[Total Beneficiaries]]"
    assert tok.inner == "Total Beneficiaries"
    assert tok.delimiter == "[["


def test_extract_single_square_delimiter(tmp_path):
    doc = Document()
    doc.add_paragraph("[Average Age]")
    tokens = extract_placeholders(_save(doc, tmp_path))
    assert len(tokens) == 1
    tok = tokens[0]
    assert tok.raw == "[Average Age]"
    assert tok.inner == "Average Age"
    assert tok.delimiter == "["


def test_extract_double_brace_delimiter(tmp_path):
    doc = Document()
    doc.add_paragraph("{{ region breakdown }}")
    tokens = extract_placeholders(_save(doc, tmp_path))
    assert len(tokens) == 1
    tok = tokens[0]
    assert tok.raw == "{{ region breakdown }}"
    assert tok.inner == "region breakdown"
    assert tok.delimiter == "{{"


def test_extract_all_three_delimiters_in_one_doc(one_per_delimiter_docx):
    tokens = extract_placeholders(one_per_delimiter_docx)
    raws = {t.raw for t in tokens}
    assert raws == {
        "[[Total Beneficiaries]]",
        "[Average Age]",
        "{{ region breakdown }}",
    }


# --------------------------------------------------------------------------- #
# AC: precedence -- [[x]] matched once as [[x]], never double-matched as [x]
# --------------------------------------------------------------------------- #

def test_extract_double_square_is_one_token_not_inner_single_square(tmp_path):
    doc = Document()
    doc.add_paragraph("[[Total]]")
    tokens = extract_placeholders(_save(doc, tmp_path))
    # Exactly one token, and it is the [[ ]] token -- the [Total] substring
    # inside must NOT also be returned as a [ ] token.
    assert len(tokens) == 1
    tok = tokens[0]
    assert tok.raw == "[[Total]]"
    assert tok.delimiter == "[["
    assert tok.inner == "Total"
    assert all(t.raw != "[Total]" for t in tokens)


# --------------------------------------------------------------------------- #
# AC: a token whose characters span multiple runs is matched as one token
# --------------------------------------------------------------------------- #

def test_extract_token_split_across_runs_matched_as_single_token(tmp_path):
    """Hand-typed placeholders are almost always split across runs by Word.
    Simulate that: the characters of one [[ ]] placeholder are spread over
    several runs in the same paragraph. It must come back as ONE token."""
    doc = Document()
    para = doc.add_paragraph()
    for chunk in ["[[Tot", "al Benef", "iciaries", "]]"]:
        para.add_run(chunk)
    tokens = extract_placeholders(_save(doc, tmp_path))
    assert len(tokens) == 1
    tok = tokens[0]
    assert tok.raw == "[[Total Beneficiaries]]"
    assert tok.inner == "Total Beneficiaries"
    assert tok.delimiter == "[["


# --------------------------------------------------------------------------- #
# AC: tokens in a table cell, a header, and a footer are all extracted
# --------------------------------------------------------------------------- #

def test_tokens_in_table_header_and_footer_extracted(tmp_path):
    doc = Document()
    doc.add_paragraph("[[Body Token]]")

    table = doc.add_table(rows=1, cols=1)
    table.cell(0, 0).paragraphs[0].add_run("{{ cell token }}")

    section = doc.sections[0]
    section.header.paragraphs[0].add_run("[Header Token]")
    section.footer.paragraphs[0].add_run("{{ footer token }}")

    tokens = extract_placeholders(_save(doc, tmp_path))
    raws = {t.raw for t in tokens}
    assert "[[Body Token]]" in raws
    assert "{{ cell token }}" in raws
    assert "[Header Token]" in raws
    assert "{{ footer token }}" in raws


# --------------------------------------------------------------------------- #
# AC: known {{ }} literal -> kind "literal", raw unchanged
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("raw,inner", [
    ("{{ report_title }}", "report_title"),
    ("{{ chart_sales }}", "chart_sales"),
])
def test_extract_known_literal_placeholder_marked_literal_and_unchanged(tmp_path, raw, inner):
    doc = Document()
    doc.add_paragraph(raw)
    tokens = extract_placeholders(_save(doc, tmp_path))
    by_raw = _by_raw(tokens)
    assert raw in by_raw, f"{raw!r} not returned"
    tok = by_raw[raw][0]
    assert tok.kind == "literal"
    assert tok.inner == inner
    assert tok.raw == raw  # left untouched


# --------------------------------------------------------------------------- #
# AC: non-literal {{ }} -> returned as an NL (non-literal) token for inference
# --------------------------------------------------------------------------- #

def test_extract_unknown_double_brace_is_non_literal_nl_token(tmp_path):
    doc = Document()
    doc.add_paragraph("{{ unknown thing }}")
    tokens = extract_placeholders(_save(doc, tmp_path))
    by_raw = _by_raw(tokens)
    assert "{{ unknown thing }}" in by_raw
    tok = by_raw["{{ unknown thing }}"][0]
    assert tok.inner == "unknown thing"
    assert tok.delimiter == "{{"
    # The whole point of the express path: it is offered up for inference,
    # i.e. it is NOT a passthrough literal.
    assert tok.kind != "literal"


# --------------------------------------------------------------------------- #
# AC: location records a run-span reference sufficient to rewrite the token
# --------------------------------------------------------------------------- #

def test_extract_location_runspan_round_trips_to_same_runs(tmp_path):
    """The recorded run-span must identify the same runs the token occupies.
    Build a paragraph whose runs are known, then verify location.runs indexes
    back into those runs to reconstruct the token's raw text."""
    doc = Document()
    para = doc.add_paragraph()
    chunks = ["intro ", "[[Tot", "al]]", " outro"]
    for chunk in chunks:
        para.add_run(chunk)

    path = _save(doc, tmp_path)
    tokens = extract_placeholders(path)
    assert len(tokens) == 1
    loc = tokens[0].location

    # location must carry an integer run-span and the reconstructed paragraph text.
    run_indices = list(loc.runs)
    assert run_indices, "location.runs is empty"
    assert all(isinstance(i, int) for i in run_indices)
    assert loc.paragraph_text == "".join(chunks)

    # Re-open the document and confirm the recorded run indices select the same
    # runs whose concatenation contains the token's raw text -- i.e. the span is
    # sufficient to rewrite the token in place.
    reopened = Document(path)
    target_para = next(
        p for p in reopened.paragraphs
        if "".join(r.text for r in p.runs) == "".join(chunks)
    )
    spanned = "".join(target_para.runs[i].text for i in run_indices)
    assert "[[Total]]" in spanned


# =========================================================================== #
# XTF-2 — Batched inference + local validation
# =========================================================================== #
# These tests are the spec for two new functions appended to
# ``src/reports/template_inference.py`` (XTF-2). They are derived strictly from
# the XTF-2 acceptance criteria and design spec §4.2 / §4.3. Written before the
# implementation lands; expected RED until ``infer_specs`` / ``annotate_proposals``
# exist.
#
# Contract committed to here (AC-derived, mirroring ask_engine shapes):
#
# ``infer_specs(nl_tokens, catalog, ai_cfg) -> List[Proposal]``
#   * makes exactly ONE batched ``lf_client.chat`` call (trace_name=
#     "template_inference", json_mode=True) over ALL nl_tokens + the catalog;
#   * returns one Proposal per token.
#
# A ``Proposal`` is a mapping (dict access) carrying at least:
#   * ``token_index`` -- int, index into the input token list
#   * ``kind``        -- one of chart | indicator | summary | table | narrative | metadata
#   * ``spec``        -- a config-shaped dict (chart: {name,title,type,questions,…};
#                        indicator: {name,stat,question,…}; summary: {name,stat,questions,…})
#   * ``name``        -- canonical slug (str)
#   * ``confidence``  -- float in 0..1
#   * ``reason``      -- str
#
# ``annotate_proposals(proposals, profile) -> List[Proposal]`` is local +
# deterministic (no AI). It reuses ``ask_engine.validate_recipe`` / ``CHART_REQS``
# / ``INDICATOR_STATS`` and adds:
#   * ``status``      -- "ok" or "needs_attention"
#   * ``reason``      -- human-readable (overwritten/augmented with the failure)
# and dedupes canonical ``name``s (suffix on collision). ``needs_attention`` is
# set when confidence is low, validation fails, or a referenced column is absent.
# Narrative tokens map to a fixed slot (recommendations/observations/summary_text)
# when the text clearly matches, else a ``summaries`` entry with ``stat: "ai"``.
#
# These assertions intentionally pin dict-shaped Proposals.

from src.reports import template_inference as ti
from src.reports import ask_engine


# Confidence threshold used by the tests. The implementation must treat a
# proposal *below* this as low-confidence (needs_attention). 0.5 is a midpoint
# clearly below "high"; the AC only requires "low confidence" be flagged, so the
# tests use values at the extremes (0.1 low, 0.95 high) to stay robust to the
# implementation's exact cutoff.
_LOW_CONF = 0.1
_HIGH_CONF = 0.95


def _profile_xtf2():
    """A profile shaped exactly like ``ask_engine.validate_recipe`` expects:
    keyed by table name, each table {name, rows, columns:[{name, role, …}]}.
    Mirrors tests/test_ask_engine.py::_profile_fixture."""
    return {
        "main": {
            "name": "main", "rows": 3,
            "columns": [
                {"name": "_id", "role": "linkage", "distinct": 3, "missing_pct": 0.0},
                {"name": "Region", "role": "categorical", "distinct": 2, "missing_pct": 0.0,
                 "top_values": [{"value": "N", "count": 2}, {"value": "S", "count": 1}]},
                {"name": "Age", "role": "quantitative", "distinct": 3, "missing_pct": 0.0,
                 "min": 10.0, "max": 30.0, "mean": 20.0, "median": 20.0},
                {"name": "Income", "role": "quantitative", "distinct": 3, "missing_pct": 0.0,
                 "min": 100.0, "max": 900.0, "mean": 500.0, "median": 500.0},
                {"name": "Story", "role": "qualitative", "distinct": 3, "missing_pct": 0.0},
            ],
            "correlations": [], "duplicates": None,
        }
    }


def _proposal(kind, spec, name, confidence=_HIGH_CONF, token_index=0, reason="proposed"):
    """Build a Proposal dict in the shape ``infer_specs`` returns."""
    return {
        "token_index": token_index,
        "kind": kind,
        "spec": dict(spec),
        "name": name,
        "confidence": confidence,
        "reason": reason,
    }


def _get(proposal, key):
    """Read a Proposal field whether the impl returns dicts or objects."""
    if isinstance(proposal, dict):
        return proposal[key]
    return getattr(proposal, key)


# --------------------------------------------------------------------------- #
# annotate_proposals — confidence gate
# --------------------------------------------------------------------------- #
def test_annotate_flags_low_confidence_as_needs_attention():
    """AC: needs_attention is set when confidence is low. A bar proposal that is
    otherwise valid but has a low confidence score must be flagged."""
    proposals = [
        _proposal("chart", {"name": "by_region", "title": "By region",
                            "type": "bar", "questions": ["Region"]},
                  name="by_region", confidence=_LOW_CONF),
    ]
    out = ti.annotate_proposals(proposals, _profile_xtf2())
    assert _get(out[0], "status") == "needs_attention"
    assert isinstance(_get(out[0], "reason"), str) and _get(out[0], "reason")


# --------------------------------------------------------------------------- #
# annotate_proposals — missing column
# --------------------------------------------------------------------------- #
def test_annotate_flags_missing_column():
    """AC: needs_attention when a referenced column is absent from the data.
    A bar chart on a column not present in the profile must be flagged, and the
    reason should name the offending column."""
    proposals = [
        _proposal("chart", {"name": "ghost", "title": "Ghost",
                            "type": "bar", "questions": ["NotAColumn"]},
                  name="ghost", confidence=_HIGH_CONF),
    ]
    out = ti.annotate_proposals(proposals, _profile_xtf2())
    assert _get(out[0], "status") == "needs_attention"
    assert "NotAColumn" in _get(out[0], "reason")


# --------------------------------------------------------------------------- #
# annotate_proposals — bad type/column combo via CHART_REQS
# --------------------------------------------------------------------------- #
def test_annotate_flags_scatter_with_one_quantitative():
    """AC: bad type/column combo flagged via validate_recipe/CHART_REQS. A
    scatter needs >=2 quantitative columns; one quantitative + one categorical
    must fail and the reason should mention the quantitative requirement."""
    proposals = [
        _proposal("chart", {"name": "scatter_bad", "title": "Scatter",
                            "type": "scatter", "questions": ["Age", "Region"]},
                  name="scatter_bad", confidence=_HIGH_CONF),
    ]
    out = ti.annotate_proposals(proposals, _profile_xtf2())
    assert _get(out[0], "status") == "needs_attention"
    assert "quantitative" in _get(out[0], "reason")


# --------------------------------------------------------------------------- #
# annotate_proposals — valid proposals pass
# --------------------------------------------------------------------------- #
def test_annotate_passes_valid_bar_indicator_summary():
    """AC: a valid bar / indicator / summary proposal is status ok. All three
    reference real columns, satisfy their role requirements, and have high
    confidence."""
    proposals = [
        _proposal("chart", {"name": "by_region", "title": "By region",
                            "type": "bar", "questions": ["Region"]},
                  name="by_region", confidence=_HIGH_CONF, token_index=0),
        _proposal("indicator", {"name": "mean_age", "stat": "mean",
                                "question": "Age"},
                  name="mean_age", confidence=_HIGH_CONF, token_index=1),
        _proposal("summary", {"name": "income_summary", "stat": "sum",
                              "questions": ["Income"]},
                  name="income_summary", confidence=_HIGH_CONF, token_index=2),
    ]
    out = ti.annotate_proposals(proposals, _profile_xtf2())
    statuses = [_get(p, "status") for p in out]
    assert statuses == ["ok", "ok", "ok"], statuses


# --------------------------------------------------------------------------- #
# annotate_proposals — dedupe canonical names
# --------------------------------------------------------------------------- #
def test_annotate_dedupes_colliding_names_with_suffix():
    """AC: canonical names are deduped (suffix on collision). Two valid proposals
    that resolve to the same slug must end with distinct ``name`` values."""
    proposals = [
        _proposal("chart", {"name": "by_region", "title": "By region",
                            "type": "bar", "questions": ["Region"]},
                  name="by_region", confidence=_HIGH_CONF, token_index=0),
        _proposal("chart", {"name": "by_region", "title": "By region again",
                            "type": "bar", "questions": ["Region"]},
                  name="by_region", confidence=_HIGH_CONF, token_index=1),
    ]
    out = ti.annotate_proposals(proposals, _profile_xtf2())
    names = [_get(p, "name") for p in out]
    assert len(set(names)) == 2, f"names not deduped: {names}"
    # The original slug is preserved on (at least) one; the other is suffixed.
    assert "by_region" in names


# --------------------------------------------------------------------------- #
# annotate_proposals — narrative routing
# --------------------------------------------------------------------------- #
def test_annotate_narrative_recommendations_maps_to_slot():
    """AC: a narrative token clearly matching 'recommendations' maps to the fixed
    ``recommendations`` slot."""
    proposals = [
        _proposal("narrative", {}, name="recommendations",
                  confidence=_HIGH_CONF, reason="Recommendations"),
    ]
    out = ti.annotate_proposals(proposals, _profile_xtf2())
    p = out[0]
    # The canonical name resolves to the fixed slot regardless of internal spec
    # representation.
    assert _get(p, "name") == "recommendations"
    assert _get(p, "status") == "ok"


def test_annotate_free_form_narrative_maps_to_ai_summary():
    """AC: a free-form narrative (not a fixed slot) maps to a summaries entry with
    stat 'ai' and the placeholder text carried as the prompt."""
    placeholder_text = "Write a paragraph about progress against targets this quarter"
    proposals = [
        _proposal("narrative", {"prompt": placeholder_text},
                  name="progress_narrative", confidence=_HIGH_CONF,
                  reason=placeholder_text),
    ]
    out = ti.annotate_proposals(proposals, _profile_xtf2())
    p = out[0]
    spec = _get(p, "spec")
    assert spec.get("stat") == "ai", f"expected stat 'ai', got spec={spec}"
    assert placeholder_text in (spec.get("prompt") or ""), spec


# --------------------------------------------------------------------------- #
# infer_specs — exactly one batched LLM call
# --------------------------------------------------------------------------- #
def test_infer_specs_makes_one_batched_chat_call(monkeypatch):
    """AC: infer_specs makes a SINGLE batched lf_client.chat call for N tokens,
    via get_prompt('template_inference', …) + chat(trace_name='template_inference',
    json_mode=True). Mock the LLM (suggester convention) and assert call count==1."""
    calls = {"chat": 0, "trace_names": [], "json_modes": []}

    monkeypatch.setattr(
        ti.lf_client, "get_prompt",
        lambda *a, **k: ([{"role": "user", "content": "x"}], {}),
    )

    def _fake_chat(*a, **k):
        calls["chat"] += 1
        calls["trace_names"].append(k.get("trace_name"))
        calls["json_modes"].append(k.get("json_mode"))
        # One Proposal per input token, returned as a JSON string (suggester style).
        return (
            '{"proposals": ['
            '{"token_index": 0, "kind": "chart", "name": "by_region", '
            '"spec": {"name": "by_region", "type": "bar", "questions": ["Region"]}, '
            '"confidence": 0.9, "reason": "bar of region"},'
            '{"token_index": 1, "kind": "indicator", "name": "mean_age", '
            '"spec": {"name": "mean_age", "stat": "mean", "question": "Age"}, '
            '"confidence": 0.8, "reason": "mean age"}'
            ']}'
        )

    monkeypatch.setattr(ti.lf_client, "chat", _fake_chat)

    # Three NL tokens (objects with .inner, like XTF-1 Token); batched into one call.
    nl_tokens = [
        ti.Token(raw="[Region breakdown]", inner="Region breakdown",
                 delimiter="[", kind="nl", location=ti.Location()),
        ti.Token(raw="[average age]", inner="average age",
                 delimiter="[", kind="nl", location=ti.Location()),
        ti.Token(raw="[total income]", inner="total income",
                 delimiter="[", kind="nl", location=ti.Location()),
    ]
    catalog = ask_engine.build_catalog(_profile_xtf2())
    ai_cfg = {"provider": "openai", "model": "gpt-x", "api_key": "sk-test"}

    out = ti.infer_specs(nl_tokens, catalog, ai_cfg)

    assert calls["chat"] == 1, f"expected exactly one batched chat call, got {calls['chat']}"
    assert calls["trace_names"] == ["template_inference"]
    assert calls["json_modes"] == [True]
    assert isinstance(out, list) and out, "infer_specs returned no proposals"
