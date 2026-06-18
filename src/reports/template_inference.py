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
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Dict, List

from docx import Document

from src.reports import ask_engine
from src.utils import lf_client

log = logging.getLogger(__name__)

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


# =========================================================================== #
# XTF-2 — Batched inference + local validation.
# =========================================================================== #
# A ``Proposal`` is a plain dict (mirrors the Ask engine's recipe shape):
#   {token_index, kind, spec, name, confidence, reason}
# ``infer_specs`` produces them from one batched LLM call; ``annotate_proposals``
# validates them locally (no AI) and stamps ``status`` + a human ``reason``.

Proposal = Dict

# Kinds the inference path understands.
_KINDS = ("chart", "indicator", "summary", "table", "narrative", "metadata")

# Confidence below this is treated as low → needs_attention.
_CONFIDENCE_THRESHOLD = 0.5

# Narrative inner text → fixed report slot. The match is a loose keyword test so
# a placeholder like "Recommendations" or "key recommendations" routes correctly.
_NARRATIVE_SLOTS = ("summary_text", "observations", "recommendations")
_NARRATIVE_SLOT_KEYWORDS = {
    "summary_text": ("summary", "executive summary", "overview"),
    "observations": ("observation", "findings", "finding", "key points"),
    "recommendations": ("recommendation", "recommend", "next steps"),
}

# metadata inner text → canonical report.* field.
_METADATA_FIELDS = {
    "title": "report.title",
    "report title": "report.title",
    "period": "report.period",
    "reporting period": "report.period",
}


def _slugify(text: str) -> str:
    """A snake_case slug from arbitrary placeholder text."""
    slug = re.sub(r"[^0-9a-zA-Z]+", "_", str(text or "")).strip("_").lower()
    return slug or "item"


def infer_specs(nl_tokens: List["Token"], catalog: Dict, ai_cfg: Dict) -> List[Proposal]:
    """One batched LLM call: NL placeholders + data catalog → config-shaped Proposals.

    Builds a single prompt over ALL ``nl_tokens`` (their ``inner`` text) plus the
    Ask-engine ``catalog``, calls ``lf_client.get_prompt("template_inference", …)``
    + ``lf_client.chat(trace_name="template_inference", json_mode=True)`` exactly
    once, and returns one :data:`Proposal` per token. Returns ``[]`` on failure.
    """
    if not nl_tokens:
        return []

    provider = (ai_cfg.get("provider") or "openai").lower()
    placeholders = [
        {"token_index": i, "text": getattr(t, "inner", "")}
        for i, t in enumerate(nl_tokens)
    ]
    variables = {
        "placeholders": json.dumps(placeholders, ensure_ascii=False),
        "catalog": json.dumps(catalog, ensure_ascii=False),
        "kinds": ", ".join(_KINDS),
        "chart_types": ask_engine._CHART_TYPES_BLOCK,
        "indicator_stats": ask_engine._INDICATOR_STATS_BLOCK,
    }
    try:
        messages, _config = lf_client.get_prompt("template_inference", variables)
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=max(int(ai_cfg.get("max_tokens", 1500)), 2000),
            trace_name="template_inference",
            base_url=ai_cfg.get("base_url"),
            json_mode=True,
            output_schema=_config.get("output_schema"),
        )
    except Exception as e:  # noqa: BLE001
        log.warning(f"template_inference: infer_specs failed: {e}")
        return []

    data = ask_engine._loads_lenient(raw)
    items = (data or {}).get("proposals")
    if not isinstance(items, list):
        return []

    proposals: List[Proposal] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        spec = it.get("spec")
        proposals.append({
            "token_index": it.get("token_index"),
            "kind": it.get("kind", "chart"),
            "spec": dict(spec) if isinstance(spec, dict) else {},
            "name": it.get("name") or _slugify(it.get("kind", "item")),
            "confidence": float(it.get("confidence", 0.0) or 0.0),
            "reason": it.get("reason", ""),
        })
    return proposals


def _validate_data_proposal(kind: str, spec: Dict, profile: Dict) -> "tuple[bool, str]":
    """Local validation for a data proposal (chart/indicator/summary/table).

    Reuses ``ask_engine.validate_recipe`` / ``CHART_REQS`` / ``INDICATOR_STATS``.
    A summary references columns via ``questions`` like a chart/table but is not a
    chart type, so its columns are checked against the profile directly.
    """
    if kind == "summary":
        source = spec.get("source") or "main"
        tp = profile.get(source)
        if tp is None:
            return False, f"unknown source table '{source}'"
        roles = {c["name"] for c in tp.get("columns", [])}
        cols = list(spec.get("questions") or [])
        if not cols:
            return False, "no columns specified"
        for c in cols:
            if c not in roles:
                return False, f"column '{c}' not found in '{source}'"
        return True, ""
    recipe = {**spec, "kind": kind}
    return ask_engine.validate_recipe(recipe, profile)


def _route_narrative(proposal: Proposal) -> Proposal:
    """Map a narrative proposal to a fixed report slot or an AI summary entry."""
    spec = dict(proposal.get("spec") or {})
    text = " ".join(str(x) for x in (proposal.get("name", ""), proposal.get("reason", ""),
                                     spec.get("prompt", ""))).lower()
    for slot in _NARRATIVE_SLOTS:
        keywords = _NARRATIVE_SLOT_KEYWORDS[slot]
        if any(kw in text for kw in keywords):
            proposal["name"] = slot
            proposal["spec"] = {}
            proposal["status"] = "ok"
            proposal["reason"] = f"narrative → {slot}"
            return proposal
    # Free-form narrative → a summaries entry with stat 'ai'; carry the placeholder
    # text as the prompt so the narrator fills it at build time.
    prompt_text = spec.get("prompt") or proposal.get("reason") or proposal.get("name", "")
    proposal["spec"] = {
        "name": proposal.get("name") or "narrative",
        "stat": "ai",
        "prompt": prompt_text,
    }
    proposal["status"] = "ok"
    proposal["reason"] = "free-form narrative → AI summary"
    return proposal


def _route_metadata(proposal: Proposal) -> Proposal:
    """Map a metadata proposal to a canonical ``report.*`` field."""
    key = str(proposal.get("name", "")).lower()
    field_name = _METADATA_FIELDS.get(key, "report.title")
    proposal["name"] = field_name
    proposal["status"] = "ok"
    proposal["reason"] = f"metadata → {field_name}"
    return proposal


def annotate_proposals(proposals: List[Proposal], profile: Dict) -> List[Proposal]:
    """Local, deterministic validation of inferred proposals (no AI).

    Stamps each proposal with ``status`` (``"ok"`` / ``"needs_attention"``) and a
    human-readable ``reason``. ``needs_attention`` is set when confidence is low,
    validation fails, or a referenced column is absent. Narrative and metadata
    kinds are routed to their fixed slots. Canonical ``name``s are deduped with a
    numeric suffix on collision.
    """
    profile = profile or {}
    out: List[Proposal] = []
    for p in proposals:
        ann = dict(p)
        ann.setdefault("spec", {})
        kind = ann.get("kind", "chart")

        if kind == "narrative":
            ann = _route_narrative(ann)
        elif kind == "metadata":
            ann = _route_metadata(ann)
        else:
            ok, reason = _validate_data_proposal(kind, ann.get("spec") or {}, profile)
            if not ok:
                ann["status"] = "needs_attention"
                ann["reason"] = reason
            elif float(ann.get("confidence", 0.0) or 0.0) < _CONFIDENCE_THRESHOLD:
                ann["status"] = "needs_attention"
                ann["reason"] = (
                    f"low confidence ({ann.get('confidence')}); please review"
                )
            else:
                ann["status"] = "ok"
                ann["reason"] = ann.get("reason") or "validated"
        out.append(ann)

    # Dedupe canonical names (suffix on collision).
    seen: set = set()
    for ann in out:
        base = ann.get("name") or ann.get("kind") or "item"
        name = base
        i = 2
        while name in seen:
            name = f"{base}_{i}"
            i += 1
        seen.add(name)
        ann["name"] = name
    return out
