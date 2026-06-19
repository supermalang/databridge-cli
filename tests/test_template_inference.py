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


# =========================================================================== #
# XTF-3 — Apply: persist config + resolve template (apply_inference)
# =========================================================================== #
# These tests are the spec for ``apply_inference`` appended to
# ``src/reports/template_inference.py`` (XTF-3). Derived strictly from the XTF-3
# acceptance criteria and design spec §4.4. Written before the implementation
# lands; expected RED (AttributeError: module has no attribute 'apply_inference')
# until it exists.
#
# Contract committed to here (AC-derived):
#
# ``apply_inference(approved, cfg, template_path) -> (cfg, resolved_template_path)``
#
#   * ``approved`` is the list of approved Proposal dicts (the same shape
#     ``annotate_proposals`` returns: keys ``token_index``, ``kind``, ``spec``,
#     ``name``, ``confidence``, ``reason``, ``status``). Only ``status == "ok"``
#     proposals are expected to be passed in (the CLI/web layer drops flagged
#     ones before calling); these tests pass ``status="ok"``.
#
#   * To know WHERE each approved proposal's token lives in the .docx,
#     ``apply_inference`` re-runs ``extract_placeholders(template_path)``
#     internally and matches approved proposals to extracted tokens by
#     ``token_index`` (index into the extracted NL-token list). So a test:
#       1. builds a .docx with known NL placeholders,
#       2. calls ``extract_placeholders`` to learn token indices,
#       3. builds approved Proposal dicts referencing those ``token_index`` +
#          a ``spec`` / ``name`` / ``kind`` (status "ok"),
#       4. calls ``apply_inference``.
#
#   * Config: each approved spec is appended/merged into the section for its
#     kind — chart -> ``cfg["charts"]``, indicator -> ``cfg["indicators"]``,
#     summary -> ``cfg["summaries"]``, table -> ``cfg["tables"]`` — using the
#     established list-of-dicts shape, where the entry's ``name`` is the canonical
#     slug (e.g. ``by_region``). Existing user-authored entries are NEVER
#     clobbered; a colliding name is given a numeric suffix.
#
#   * Template resolution: the token's run span is replaced by a SINGLE clean run
#     whose text is the canonical ``{{ <prefix>_<slug> }}`` placeholder
#     (chart -> ``chart_``, indicator -> ``ind_``, summary -> ``summary_``,
#     table -> ``table_``); the other runs in the span are cleared. So the chart
#     placeholder is exactly ONE unbroken XML run. The resolved .docx is saved as
#     a NEW file (the original upload is preserved). The resolved path is returned.

from pathlib import Path


# Canonical placeholder prefix per kind (the {{ }} text the builder fills).
_KIND_PREFIX = {
    "chart": "chart_",
    "indicator": "ind_",
    "summary": "summary_",
    "table": "table_",
}


def _approved(kind, spec, name, token_index, status="ok", confidence=_HIGH_CONF):
    """Build an approved Proposal dict (annotate_proposals output shape)."""
    return {
        "token_index": token_index,
        "kind": kind,
        "spec": dict(spec),
        "name": name,
        "confidence": confidence,
        "reason": "approved",
        "status": status,
    }


def _docx_with_nl_placeholders(tmp_path, texts, name="upload.docx"):
    """Build a .docx with one NL placeholder per paragraph (single run each)."""
    doc = Document()
    for t in texts:
        doc.add_paragraph(t)
    path = tmp_path / name
    doc.save(str(path))
    return str(path)


def _section_entry(cfg, section, slug):
    """Find the config entry in ``cfg[section]`` whose name matches ``slug`` (or a
    suffixed variant beginning with ``slug``). Returns the entry dict or None."""
    for e in cfg.get(section, []) or []:
        if e.get("name") == slug:
            return e
    return None


# --------------------------------------------------------------------------- #
# AC: chart proposal -> cfg["charts"], indicator -> cfg["indicators"] (shapes)
# --------------------------------------------------------------------------- #
def test_apply_writes_chart_and_indicator_into_their_sections(tmp_path):
    template = _docx_with_nl_placeholders(
        tmp_path, ["[Region breakdown]", "[Average age]"]
    )
    # token_index is the index into extract_placeholders' returned list.
    tokens = ti.extract_placeholders(template)
    assert len(tokens) == 2

    approved = [
        _approved("chart",
                  {"name": "by_region", "title": "By region",
                   "type": "bar", "questions": ["Region"]},
                  name="by_region", token_index=0),
        _approved("indicator",
                  {"name": "mean_age", "stat": "mean", "question": "Age"},
                  name="mean_age", token_index=1),
    ]
    cfg = {"api": {}, "form": {}}

    cfg_out, resolved = ti.apply_inference(approved, cfg, template)

    chart = _section_entry(cfg_out, "charts", "by_region")
    assert chart is not None, f"chart not written: {cfg_out.get('charts')}"
    assert chart["type"] == "bar"
    assert chart["questions"] == ["Region"]

    ind = _section_entry(cfg_out, "indicators", "mean_age")
    assert ind is not None, f"indicator not written: {cfg_out.get('indicators')}"
    assert ind["stat"] == "mean"
    assert ind["question"] == "Age"


# --------------------------------------------------------------------------- #
# AC: never clobber existing user-authored entries; new entry appended
# --------------------------------------------------------------------------- #
def test_apply_preserves_existing_user_chart_and_appends_new(tmp_path):
    template = _docx_with_nl_placeholders(tmp_path, ["[Region breakdown]"])
    approved = [
        _approved("chart",
                  {"name": "by_region", "title": "By region",
                   "type": "bar", "questions": ["Region"]},
                  name="by_region", token_index=0),
    ]
    # Pre-seed a user-authored chart that must survive untouched.
    cfg = {
        "api": {}, "form": {},
        "charts": [
            {"name": "chart_existing", "title": "User chart",
             "type": "pie", "questions": ["Region"]},
        ],
    }

    cfg_out, _resolved = ti.apply_inference(approved, cfg, template)

    names = [c.get("name") for c in cfg_out.get("charts", [])]
    # The user's chart survives verbatim.
    existing = _section_entry(cfg_out, "charts", "chart_existing")
    assert existing is not None, f"user chart clobbered: {names}"
    assert existing["type"] == "pie"
    # The new chart is appended alongside it.
    assert _section_entry(cfg_out, "charts", "by_region") is not None, names
    assert len(cfg_out["charts"]) == 2, names


# --------------------------------------------------------------------------- #
# AC: two approved specs with the same base slug -> distinct suffixed names
# --------------------------------------------------------------------------- #
def test_apply_dedupes_colliding_base_slugs_with_suffix(tmp_path):
    template = _docx_with_nl_placeholders(
        tmp_path, ["[Region breakdown]", "[Region split]"]
    )
    approved = [
        _approved("chart",
                  {"name": "by_region", "title": "By region",
                   "type": "bar", "questions": ["Region"]},
                  name="by_region", token_index=0),
        _approved("chart",
                  {"name": "by_region", "title": "By region (2)",
                   "type": "bar", "questions": ["Region"]},
                  name="by_region", token_index=1),
    ]
    cfg = {"api": {}, "form": {}}

    cfg_out, _resolved = ti.apply_inference(approved, cfg, template)

    names = [c.get("name") for c in cfg_out.get("charts", [])]
    assert len(names) == 2, names
    # Two distinct names; both derived from the base slug.
    assert len(set(names)) == 2, f"slugs not deduped: {names}"
    assert "by_region" in names
    assert all(str(n).startswith("by_region") for n in names), names


# --------------------------------------------------------------------------- #
# AC: resolved chart placeholder occupies exactly ONE run with {{ chart_<slug> }}
# --------------------------------------------------------------------------- #
def test_apply_resolves_chart_placeholder_to_single_run(tmp_path):
    """The chart placeholder must be exactly one unbroken XML run so docxtpl can
    render it. Build the placeholder split across several runs (as Word does),
    apply, then assert the resolved paragraph holds the canonical placeholder in a
    single non-empty run."""
    doc = Document()
    para = doc.add_paragraph()
    for chunk in ["[Reg", "ion break", "down]"]:
        para.add_run(chunk)
    template = str(tmp_path / "upload.docx")
    doc.save(template)

    tokens = ti.extract_placeholders(template)
    assert len(tokens) == 1

    approved = [
        _approved("chart",
                  {"name": "by_region", "title": "By region",
                   "type": "bar", "questions": ["Region"]},
                  name="by_region", token_index=0),
    ]
    cfg = {"api": {}, "form": {}}

    _cfg_out, resolved = ti.apply_inference(approved, cfg, template)

    expected = "{{ chart_by_region }}"
    reopened = Document(str(resolved))
    target = None
    for p in reopened.paragraphs:
        if expected in "".join(r.text for r in p.runs):
            target = p
            break
    assert target is not None, "resolved placeholder paragraph not found"

    # Exactly ONE run carries the placeholder text; the other runs in the span
    # are cleared (empty). So the placeholder is one unbroken run.
    nonempty = [r for r in target.runs if r.text]
    assert len(nonempty) == 1, (
        f"chart placeholder must be exactly one run, got {[r.text for r in target.runs]}"
    )
    assert nonempty[0].text == expected, nonempty[0].text


# --------------------------------------------------------------------------- #
# AC: the original uploaded .docx is preserved (resolved saved as new file)
# --------------------------------------------------------------------------- #
def test_apply_preserves_original_upload(tmp_path):
    template = _docx_with_nl_placeholders(tmp_path, ["[Region breakdown]"])
    approved = [
        _approved("chart",
                  {"name": "by_region", "title": "By region",
                   "type": "bar", "questions": ["Region"]},
                  name="by_region", token_index=0),
    ]
    cfg = {"api": {}, "form": {}}

    _cfg_out, resolved = ti.apply_inference(approved, cfg, template)

    # The original upload still exists.
    assert Path(template).exists(), "original upload was not preserved"
    # The resolved template is a distinct, existing file.
    assert Path(str(resolved)).exists(), "resolved template was not written"
    assert Path(str(resolved)).resolve() != Path(template).resolve(), (
        "resolved template must be a new file, not the original upload"
    )


# =========================================================================== #
# XTF-4 — CLI commands (infer-template, apply-template)
# =========================================================================== #
# These tests are the spec for the two new Click commands appended to
# ``src/data/make.py`` (and their registration in ``web.main.ALLOWED_COMMANDS``)
# for XTF-4. They are derived strictly from the XTF-4 acceptance criteria and
# design spec §5. They are written before the commands exist and are expected
# to be RED until the commands land — RED for the RIGHT reason: Click reports
# "No such command 'infer-template' / 'apply-template'" (nonzero exit), and the
# ALLOWED_COMMANDS keys are missing — NOT because of fixture / mock / import bugs.
#
# They are selectable with ``-k "cli or command"`` (every test name below
# contains "cli"); the XTF-1/2/3 tests above are NOT matched by that filter, so
# they keep running under ``-k "extract or infer or annotate or apply"``.
#
# --------------------------------------------------------------------------- #
# Contract committed to here (AC-derived; the implementer must satisfy these
# exact flag names + message substrings, kept aligned with the card/spec wording)
# --------------------------------------------------------------------------- #
#
# ``infer-template --template <file> [--out reports/.template_inference.json]``
#   * runs extract_placeholders -> infer_specs -> annotate_proposals;
#   * writes the proposal LIST to the --out JSON (one entry per NON-literal
#     token; known {{ }} literals are passthrough and NOT proposals);
#   * prints a summary table (placeholder -> kind/name/status) and exits 0.
#   * No AI provider/key configured  -> nonzero exit + a message naming the AI
#     provider requirement (assert substring "AI provider", case-insensitive).
#   * No downloaded data             -> nonzero exit + the "run Download first"
#     message (assert substring "download first", case-insensitive).
#   * Zero placeholders found        -> a friendly no-op message + exit 0.
#
# ``apply-template [--from reports/.template_inference.json] [--build]``
#   * reads the (possibly user-edited) proposal list JSON;
#   * DROPS any proposal still flagged (status == "needs_attention") or not
#     approved before calling apply_inference (so a needs_attention row never
#     reaches config / the resolved template);
#   * calls apply_inference -> persists config via write_config + writes the
#     resolved template;
#   * with --build, chains into the build-report command via ctx.invoke
#     (the same _invoke seam run-all uses, so it is mockable).
#
# Both command names are present in ``web.main.ALLOWED_COMMANDS``.
#
# MOCKING SEAMS (chosen to mirror how build-report / download / run-all /
# ask_engine detect their preconditions, NOT invented):
#   * "no AI provider/key": same shape build-report's AI features check — an
#     ``ai`` config whose provider/api_key are absent (or api_key is an unresolved
#     ``env:`` ref) is treated as not-configured. The configured case uses
#     {provider: openai, api_key: sk-test} like the suggester tests.
#   * "no downloaded data": ``src/data/transform.load_processed_data`` raises
#     ``FileNotFoundError("... Run 'download' first.")`` when no session exists —
#     the same seam ask/build-report read through. We monkeypatch it on the
#     ``make`` module (where the command imports it) to simulate present/absent
#     data without writing real CSVs.
#   * profile + catalog: ``src/data/profile.profile_dataset`` and
#     ``ask_engine.build_catalog`` — patched to return a tiny deterministic
#     profile so the command does not depend on a real download.
#   * the LLM: ``template_inference.infer_specs`` is patched to return canned
#     proposals (the suggester-test convention of mocking at the inference
#     boundary rather than the raw lf_client.chat, since the command orchestrates
#     the module function).
#   * build-report chaining: patch ``make._invoke`` (the run-all sequencing
#     seam) and/or the ``apply_inference`` call to spy on the chained build.
#
# If the implementer wires a precondition at a different-but-equivalent seam,
# these monkeypatches still hold as long as the command imports the helpers via
# the ``make`` module namespace (the established pattern in make.py).

import json as _json

import pytest as _pytest
import yaml as _yaml
from click.testing import CliRunner

from src.data import make as _make


_AI_OK = {"provider": "openai", "api_key": "sk-test", "model": "gpt-x", "max_tokens": 1500}


def _profile_xtf4():
    """A minimal profile in the shape build_catalog / validate_recipe expect."""
    return {
        "main": {
            "name": "main", "rows": 3,
            "columns": [
                {"name": "Region", "role": "categorical", "distinct": 2, "missing_pct": 0.0,
                 "top_values": [{"value": "N", "count": 2}, {"value": "S", "count": 1}]},
                {"name": "Age", "role": "quantitative", "distinct": 3, "missing_pct": 0.0,
                 "min": 10.0, "max": 30.0, "mean": 20.0, "median": 20.0},
            ],
            "correlations": [], "duplicates": None,
        }
    }


def _write_cfg_xtf4(tmp_path, *, ai=True):
    """A config.yml with (optionally) a configured AI provider, written to disk
    so the CLI's ``load_config`` reads it the same way every other command does."""
    cfg = {
        "api": {"platform": "kobo", "url": "https://x.example.com/api/v2", "token": "t"},
        "form": {"uid": "aaa", "alias": "survey"},
        "questions": [{"export_label": "Region", "category": "categorical"}],
    }
    if ai:
        cfg["ai"] = dict(_AI_OK)
    p = tmp_path / "config.yml"
    p.write_text(_yaml.safe_dump(cfg))
    return p


def _docx_for_cli(tmp_path, texts, name="upload.docx"):
    """Build a .docx with one placeholder per paragraph (single run each)."""
    doc = Document()
    for t in texts:
        doc.add_paragraph(t)
    path = tmp_path / name
    doc.save(str(path))
    return str(path)


def _patch_data_present(monkeypatch, profile=None):
    """Simulate a successful prior download: load_processed_data returns a frame +
    profile_dataset / build_catalog return a tiny deterministic profile/catalog.
    Patched on the ``make`` module namespace (where the command imports them)."""
    import pandas as pd
    from src.data import transform as _transform
    from src.data import profile as _profile_mod

    prof = profile or _profile_xtf4()
    df = pd.DataFrame({"Region": ["N", "N", "S"], "Age": [10, 20, 30]})

    # The command may import these via `from ... import` inside the function or as
    # module attributes; patch both the source modules and the make namespace so
    # whichever binding the implementer chooses resolves to our stub.
    for mod, attr, val in [
        (_transform, "load_processed_data", lambda *a, **k: (df, {})),
        (_profile_mod, "profile_dataset", lambda *a, **k: prof),
    ]:
        monkeypatch.setattr(mod, attr, val, raising=False)
    monkeypatch.setattr(
        ti.ask_engine, "build_catalog", lambda *a, **k: {"tables": []}, raising=False
    )


def _patch_no_data(monkeypatch):
    """Simulate no prior download: load_processed_data raises FileNotFoundError
    with the canonical "Run 'download' first." message (the real seam's wording)."""
    import pandas as pd  # noqa: F401  (ensures pandas importable in this env)
    from src.data import transform as _transform

    def _boom(*a, **k):
        raise FileNotFoundError(
            "No data matching data/processed/survey_data*.csv. Run 'download' first."
        )

    monkeypatch.setattr(_transform, "load_processed_data", _boom, raising=False)


# --------------------------------------------------------------------------- #
# infer-template — writes the --out JSON, one entry per non-literal token, exit 0
# --------------------------------------------------------------------------- #
def test_cli_infer_template_writes_proposal_json_and_exits_zero(tmp_path, monkeypatch):
    """AC: infer-template runs extract -> infer -> annotate, writes the proposal
    list to --out, and exits 0. The template has two NON-literal placeholders and
    one known {{ }} literal (passthrough); the JSON must hold one entry per
    non-literal token (the literal is NOT a proposal)."""
    cfg_path = _write_cfg_xtf4(tmp_path, ai=True)
    template = _docx_for_cli(
        tmp_path,
        ["[Region breakdown]", "[Average age]", "{{ report_title }}"],
    )
    out_json = tmp_path / "proposals.json"

    _patch_data_present(monkeypatch)

    def _fake_infer(nl_tokens, catalog, ai_cfg):
        # One proposal per NON-literal token passed in (the literal is filtered out
        # by the command before infer_specs is called).
        return [
            {"token_index": i, "kind": "chart",
             "spec": {"name": f"c{i}", "type": "bar", "questions": ["Region"]},
             "name": f"c{i}", "confidence": 0.9, "reason": "ok"}
            for i, _t in enumerate(nl_tokens)
        ]

    monkeypatch.setattr(ti, "infer_specs", _fake_infer, raising=False)

    res = CliRunner().invoke(
        _make.cli,
        ["--config", str(cfg_path), "infer-template",
         "--template", template, "--out", str(out_json)],
    )

    assert res.exit_code == 0, res.output
    assert out_json.exists(), f"--out JSON not written. output:\n{res.output}"
    data = _json.loads(out_json.read_text())
    proposals = data["proposals"] if isinstance(data, dict) else data
    assert isinstance(proposals, list)
    # Exactly the two non-literal tokens -> two proposals (the literal is excluded).
    assert len(proposals) == 2, proposals


# --------------------------------------------------------------------------- #
# infer-template — no AI provider/key configured -> nonzero + AI-provider message
# --------------------------------------------------------------------------- #
def test_cli_infer_template_errors_without_ai_provider(tmp_path, monkeypatch):
    """AC: infer-template errors clearly when no AI provider/key is configured,
    with a message naming the AI-provider requirement (the feature requires AI —
    it cannot degrade to seeds)."""
    cfg_path = _write_cfg_xtf4(tmp_path, ai=False)
    template = _docx_for_cli(tmp_path, ["[Region breakdown]"])
    out_json = tmp_path / "proposals.json"

    # Data is present so the ONLY failing precondition is the missing AI provider.
    _patch_data_present(monkeypatch)

    res = CliRunner().invoke(
        _make.cli,
        ["--config", str(cfg_path), "infer-template",
         "--template", template, "--out", str(out_json)],
    )

    assert res.exit_code != 0, res.output
    assert "ai provider" in res.output.lower(), res.output


# --------------------------------------------------------------------------- #
# infer-template — no downloaded data -> nonzero + "run Download first" message
# --------------------------------------------------------------------------- #
def test_cli_infer_template_errors_without_downloaded_data(tmp_path, monkeypatch):
    """AC: infer-template errors when no data has been downloaded (local
    validation needs real columns), with the "run Download first" message."""
    cfg_path = _write_cfg_xtf4(tmp_path, ai=True)
    template = _docx_for_cli(tmp_path, ["[Region breakdown]"])
    out_json = tmp_path / "proposals.json"

    _patch_no_data(monkeypatch)

    res = CliRunner().invoke(
        _make.cli,
        ["--config", str(cfg_path), "infer-template",
         "--template", template, "--out", str(out_json)],
    )

    assert res.exit_code != 0, res.output
    assert "download first" in res.output.lower(), res.output


# --------------------------------------------------------------------------- #
# infer-template — zero placeholders -> friendly no-op message, exit 0
# --------------------------------------------------------------------------- #
def test_cli_infer_template_zero_placeholders_is_friendly_noop(tmp_path, monkeypatch):
    """AC: zero placeholders found -> a friendly no-op message, non-error exit."""
    cfg_path = _write_cfg_xtf4(tmp_path, ai=True)
    template = _docx_for_cli(tmp_path, ["Just prose, no placeholders here."])
    out_json = tmp_path / "proposals.json"

    _patch_data_present(monkeypatch)
    # infer_specs must NOT be needed when there is nothing to infer; if it is
    # called it would still no-op on an empty list, so leave it real.

    res = CliRunner().invoke(
        _make.cli,
        ["--config", str(cfg_path), "infer-template",
         "--template", template, "--out", str(out_json)],
    )

    assert res.exit_code == 0, res.output
    # A friendly message mentioning that no placeholders were found.
    assert "no placeholder" in res.output.lower(), res.output


# --------------------------------------------------------------------------- #
# apply-template — writes config + resolved template and DROPS a needs_attention
# proposal that was not approved
# --------------------------------------------------------------------------- #
def test_cli_applytmpl_drops_needs_attention_and_writes_config(tmp_path, monkeypatch):
    """AC: apply-template reads the proposals, drops any still flagged/unapproved,
    runs apply_inference (writes config + resolved template). Here the proposal
    list has one ``ok`` chart and one ``needs_attention`` chart; only the ``ok``
    one may reach apply_inference (and thus config)."""
    cfg_path = _write_cfg_xtf4(tmp_path, ai=True)
    template = _docx_for_cli(tmp_path, ["[Region breakdown]", "[Mystery thing]"])

    proposals = [
        {"token_index": 0, "kind": "chart",
         "spec": {"name": "by_region", "type": "bar", "questions": ["Region"]},
         "name": "by_region", "confidence": 0.9, "reason": "ok", "status": "ok"},
        {"token_index": 1, "kind": "chart",
         "spec": {"name": "mystery", "type": "bar", "questions": ["NotAColumn"]},
         "name": "mystery", "confidence": 0.2, "reason": "missing column",
         "status": "needs_attention"},
    ]
    from_json = tmp_path / "proposals.json"
    from_json.write_text(_json.dumps({"proposals": proposals, "template": template}))

    # Spy on apply_inference to capture which proposals survived the drop, and to
    # avoid depending on its real config/docx side effects here.
    seen = {"approved": None}

    def _spy_apply(approved, cfg, template_path):
        seen["approved"] = list(approved)
        # Mimic the real return: (cfg with the spec written, resolved path).
        cfg.setdefault("charts", [])
        for p in approved:
            cfg["charts"].append(dict(p.get("spec") or {}, name=p.get("name")))
        resolved = str(tmp_path / "upload.resolved.docx")
        Document().save(resolved)
        return cfg, resolved

    monkeypatch.setattr(ti, "apply_inference", _spy_apply, raising=False)

    res = CliRunner().invoke(
        _make.cli,
        ["--config", str(cfg_path), "apply-template", "--from", str(from_json)],
    )

    assert res.exit_code == 0, res.output
    # The needs_attention proposal was dropped: only the ok one reached apply.
    assert seen["approved"] is not None, "apply_inference was never called"
    names = [p.get("name") for p in seen["approved"]]
    assert names == ["by_region"], f"needs_attention not dropped: {names}"

    # Config was persisted with the approved chart.
    saved = _yaml.safe_load(cfg_path.read_text())
    chart_names = [c.get("name") for c in (saved.get("charts") or [])]
    assert "by_region" in chart_names, saved
    assert "mystery" not in chart_names, saved


# --------------------------------------------------------------------------- #
# apply-template --build — chains into the build-report path
# --------------------------------------------------------------------------- #
def test_cli_applytmpl_build_chains_into_build_report(tmp_path, monkeypatch):
    """AC: with --build, apply-template chains into build-report. We assert the
    chained call via the same _invoke seam run-all uses (monkeypatched to record
    the command name), so no real report is built."""
    cfg_path = _write_cfg_xtf4(tmp_path, ai=True)
    template = _docx_for_cli(tmp_path, ["[Region breakdown]"])

    proposals = [
        {"token_index": 0, "kind": "chart",
         "spec": {"name": "by_region", "type": "bar", "questions": ["Region"]},
         "name": "by_region", "confidence": 0.9, "reason": "ok", "status": "ok"},
    ]
    from_json = tmp_path / "proposals.json"
    from_json.write_text(_json.dumps({"proposals": proposals, "template": template}))

    def _spy_apply(approved, cfg, template_path):
        cfg.setdefault("charts", []).append(
            {"name": "by_region", "type": "bar", "questions": ["Region"]}
        )
        resolved = str(tmp_path / "upload.resolved.docx")
        Document().save(resolved)
        return cfg, resolved

    monkeypatch.setattr(ti, "apply_inference", _spy_apply, raising=False)

    invoked = []
    monkeypatch.setattr(
        _make, "_invoke",
        lambda ctx, command, **kw: invoked.append(command.name),
        raising=False,
    )

    res = CliRunner().invoke(
        _make.cli,
        ["--config", str(cfg_path), "apply-template",
         "--from", str(from_json), "--build"],
    )

    assert res.exit_code == 0, res.output
    assert "build-report" in invoked, (
        f"--build did not chain into build-report; invoked={invoked}\n{res.output}"
    )


# --------------------------------------------------------------------------- #
# Both command names registered in web.main.ALLOWED_COMMANDS
# --------------------------------------------------------------------------- #
def test_cli_names_registered_in_allowed_commands():
    """AC: both commands added to ALLOWED_COMMANDS in web/main.py (so they are
    runnable via the SSE run endpoint)."""
    from web import main as web_main
    assert "infer-template" in web_main.ALLOWED_COMMANDS
    assert "apply-template" in web_main.ALLOWED_COMMANDS


# --------------------------------------------------------------------------- #
# The commands actually exist on the CLI group (guards against the RED being a
# generic Click usage error rather than a missing command — once implemented,
# `--help` must succeed for each).
# --------------------------------------------------------------------------- #
@_pytest.mark.parametrize("command", ["infer-template", "apply-template"])
def test_cli_name_is_registered_on_cli_group(command):
    """AC: infer-template / apply-template are real Click commands on the group."""
    res = CliRunner().invoke(_make.cli, [command, "--help"])
    assert res.exit_code == 0, res.output
    assert "No such command" not in res.output
