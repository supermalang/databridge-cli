"""Express Template Fill — placeholder extraction (XTF-1).

Pure, offline parsing of an uploaded ``.docx`` into structured :class:`Token`s.
No AI, no network. This is the foundation for the rest of the express path
(inference / validation / resolution live in later cards).

``extract_placeholders(docx_path)`` walks the document body paragraphs, table
cells, headers, and footers. For each paragraph it reconstructs the full text by
concatenating its runs (so a placeholder split across several runs — which
hand-typed placeholders almost always are — is still matched), then matches the
three interchangeable delimiters in precedence order ``[[ … ]]`` → ``[ … ]`` →
``{{ … }}`` (so a ``[[x]]`` token is never double-matched as ``[x]``).

A ``{{ }}`` token whose inner text is a *known literal* placeholder (the set the
existing report builder already understands) is marked ``kind == "literal"`` and
left untouched; everything else is returned as a non-literal natural-language
token for downstream inference.
"""
import re
from dataclasses import dataclass, field
from typing import List

from docx import Document

# --------------------------------------------------------------------------- #
# Known {{ }} literal placeholders (today's report-builder contract).
# --------------------------------------------------------------------------- #
# Exact names the builder fills directly. Prefix families (chart_, ind_,
# summary_, table_, data_quality, logframe) are matched via the regexes below.
_LITERAL_EXACT = frozenset({
    "report_title",
    "period",
    "n_submissions",
    "generated_at",
    "summary_text",
    "observations",
    "recommendations",
    "data_quality",
    "logframe",
    "provenance.footer",
})

# ``ind_*`` (incl. ``_table`` / ``_breakdown``), ``chart_*``, ``summary_*``,
# ``table_*``, ``data_quality*``, ``logframe*``.
_LITERAL_PREFIX_RE = re.compile(
    r"^(?:chart_|ind_|summary_|table_|data_quality|logframe)\w*$"
)


def _is_known_literal(inner: str) -> bool:
    """True if a ``{{ }}`` placeholder's inner text is a known literal."""
    return inner in _LITERAL_EXACT or bool(_LITERAL_PREFIX_RE.match(inner))


# --------------------------------------------------------------------------- #
# Delimiter patterns, in precedence order. ``[[ … ]]`` first so it is never
# double-matched as ``[ … ]``. Inner text is non-greedy and forbids the
# delimiter chars so matches don't run past their own close.
# --------------------------------------------------------------------------- #
_PATTERNS = (
    ("[[", re.compile(r"\[\[(.*?)\]\]")),
    ("[", re.compile(r"\[([^\[\]]*?)\]")),
    ("{{", re.compile(r"\{\{(.*?)\}\}")),
)


# --------------------------------------------------------------------------- #
# Token + location types (attribute access is part of the contract).
# --------------------------------------------------------------------------- #
@dataclass
class Location:
    """Where a token lives, with enough detail to rewrite it later.

    ``runs`` is the sequence of integer run indices (into the owning paragraph's
    ``runs``) that the token's ``raw`` text spans. ``paragraph_text`` is the full
    paragraph text reconstructed by concatenating those runs.
    """

    runs: List[int] = field(default_factory=list)
    paragraph_text: str = ""


@dataclass
class Token:
    raw: str            # full delimited string, e.g. "[[Total]]" / "{{ x }}"
    inner: str          # trimmed inner text, e.g. "Total" / "x"
    delimiter: str      # opening delimiter: "[[", "[", or "{{"
    kind: str           # "literal" for known {{ }} literals, else "nl"
    location: Location


def _run_span(run_offsets: List[int], start: int, end: int) -> List[int]:
    """Run indices whose character ranges overlap ``[start, end)``.

    ``run_offsets`` are the cumulative character offsets where each run begins,
    with a final sentinel offset equal to the paragraph length.
    """
    spanned: List[int] = []
    for i in range(len(run_offsets) - 1):
        r_start, r_end = run_offsets[i], run_offsets[i + 1]
        # Overlap (treat zero-length runs at the boundary as non-spanning).
        if r_start < end and r_end > start:
            spanned.append(i)
    return spanned


def _tokens_in_paragraph(paragraph) -> List[Token]:
    """Extract all tokens from a single python-docx paragraph."""
    runs = paragraph.runs
    text = "".join(r.text for r in runs)
    if not text:
        return []

    # Cumulative run start offsets (+ sentinel = total length).
    run_offsets: List[int] = []
    acc = 0
    for r in runs:
        run_offsets.append(acc)
        acc += len(r.text)
    run_offsets.append(acc)

    # Find matches per delimiter, honouring precedence by claiming spans: once a
    # character range is claimed by a higher-precedence delimiter, lower ones
    # cannot match over it (e.g. the "[Total]" inside "[[Total]]").
    claimed = [False] * len(text)
    found = []  # (start, end, delimiter, inner)
    for delim, pat in _PATTERNS:
        for m in pat.finditer(text):
            s, e = m.start(), m.end()
            if any(claimed[s:e]):
                continue
            for i in range(s, e):
                claimed[i] = True
            found.append((s, e, delim, m.group(1)))

    found.sort(key=lambda t: t[0])

    tokens: List[Token] = []
    for s, e, delim, inner_raw in found:
        raw = text[s:e]
        inner = inner_raw.strip()
        kind = "literal" if (delim == "{{" and _is_known_literal(inner)) else "nl"
        tokens.append(
            Token(
                raw=raw,
                inner=inner,
                delimiter=delim,
                kind=kind,
                location=Location(
                    runs=_run_span(run_offsets, s, e),
                    paragraph_text=text,
                ),
            )
        )
    return tokens


def _iter_table_paragraphs(table):
    """Yield every paragraph in a table, recursing into nested tables."""
    for row in table.rows:
        for cell in row.cells:
            for para in cell.paragraphs:
                yield para
            for nested in cell.tables:
                yield from _iter_table_paragraphs(nested)


def extract_placeholders(docx_path) -> List[Token]:
    """Parse all placeholder tokens out of a ``.docx`` file.

    Walks body paragraphs and tables, plus each section's header and footer
    (paragraphs and tables). Returns a flat list of :class:`Token` in document
    order.
    """
    doc = Document(str(docx_path))
    tokens: List[Token] = []

    # Body paragraphs + tables.
    for para in doc.paragraphs:
        tokens.extend(_tokens_in_paragraph(para))
    for table in doc.tables:
        for para in _iter_table_paragraphs(table):
            tokens.extend(_tokens_in_paragraph(para))

    # Headers + footers (each section).
    for section in doc.sections:
        for part in (section.header, section.footer):
            for para in part.paragraphs:
                tokens.extend(_tokens_in_paragraph(para))
            for table in part.tables:
                for para in _iter_table_paragraphs(table):
                    tokens.extend(_tokens_in_paragraph(para))

    return tokens
