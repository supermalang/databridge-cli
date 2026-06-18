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
