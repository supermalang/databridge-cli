"""PII redaction helpers — applied at report/preview render time.

Configs declare redaction rules + an optional consent gate under cfg["pii"]:

    pii:
      consent_column: "Consent"
      consent_value:  "yes"          # default
      redact:
        - {column: "Name",  strategy: drop}
        - {column: "Phone", strategy: hash}
        - {column: "GPS",   strategy: generalize_geo, decimals: 2}
        - {column: "DOB",   strategy: generalize_date}
        - {column: "ID",    strategy: mask}

When the pii block is absent, every helper is a no-op.
"""
from __future__ import annotations
import hashlib
import logging
from typing import Dict, Tuple

import pandas as pd

log = logging.getLogger(__name__)

_DEFAULT_CONSENT_VALUE = "yes"


class PIIConfigError(ValueError):
    """Raised by the strict PII gate when a configured consent/redact column is
    missing from the data, or a redaction strategy is unknown."""


_KNOWN_STRATEGIES = {"drop", "hash", "mask", "generalize_geo", "generalize_date"}


def validate_pii_config(df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame], cfg: Dict) -> None:
    """Strict, fail-closed validation of the pii block against actual columns.

    Raises PIIConfigError when:
      - a configured consent_column is absent from the main table, or
      - a redact-target column is absent from BOTH the main table and every
        repeat table, or
      - a redact rule uses an unknown strategy.
    No-op when cfg has no pii block.
    """
    pii_cfg = cfg.get("pii") or {}
    if not pii_cfg:
        return None
    consent_col = pii_cfg.get("consent_column")
    if consent_col and consent_col not in df.columns:
        raise PIIConfigError(f"pii.consent_column '{consent_col}' not found in data")
    available = set(df.columns)
    for rdf in (repeat_tables or {}).values():
        available.update(rdf.columns)
    for rule in pii_cfg.get("redact") or []:
        col = rule.get("column")
        strategy = rule.get("strategy")
        if not col or col not in available:
            raise PIIConfigError(f"pii.redact column '{col}' not found in data")
        if strategy not in _KNOWN_STRATEGIES:
            raise PIIConfigError(f"pii.redact unknown strategy '{strategy}' for column '{col}'")
    return None


def enforce_pii(df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame], cfg: Dict) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Strict, fail-closed PII gate for the EXPORT boundary.

    Order: validate config (raises PIIConfigError on misconfig) -> consent-gate
    the main table -> prune orphaned repeat rows whose parent was filtered out ->
    apply redaction (via the lenient per-table apply_redaction). No-op when cfg
    has no pii block.
    """
    repeat_tables = repeat_tables or {}
    if not (cfg.get("pii") or {}):
        return df, repeat_tables
    validate_pii_config(df, repeat_tables, cfg)

    pii_cfg = cfg["pii"]
    consent_col = pii_cfg.get("consent_column")
    gated = df
    if consent_col:
        expected = pii_cfg.get("consent_value", _DEFAULT_CONSENT_VALUE)
        mask = df[consent_col].astype(str).str.strip() == str(expected)
        gated = df[mask].reset_index(drop=True)

    id_col = next((c for c in ("_id", "_index", "_uuid") if c in gated.columns), None)
    surviving = set(gated[id_col]) if id_col is not None else None
    pruned: Dict[str, pd.DataFrame] = {}
    for name, rdf in repeat_tables.items():
        if surviving is not None and "_parent_index" in rdf.columns:
            rdf = rdf[rdf["_parent_index"].isin(surviving)]
        pruned[name] = rdf

    out_df = apply_redaction(gated, cfg)
    out_repeats = {name: apply_redaction(rdf, cfg) for name, rdf in pruned.items()}
    return out_df, out_repeats


def apply_consent(df: pd.DataFrame, cfg: Dict) -> pd.DataFrame:
    """Filter rows by the consent column. No-op when no consent column configured."""
    pii_cfg = cfg.get("pii") or {}
    col = pii_cfg.get("consent_column")
    if not col:
        return df
    if col not in df.columns:
        log.warning(f"PII: consent_column '{col}' not found in data — passing through unfiltered")
        return df
    expected = pii_cfg.get("consent_value", _DEFAULT_CONSENT_VALUE)
    mask = df[col].astype(str).str.strip() == str(expected)
    return df[mask].reset_index(drop=True)


def _hash_value(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return v
    return hashlib.sha256(str(v).encode("utf-8")).hexdigest()[:8]


def _mask_value(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return v
    return "***"


def _generalize_geo_value(v, decimals: int) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return v
    s = str(v).strip()
    if "," in s:
        try:
            lat_str, lon_str = s.split(",", 1)
            lat = round(float(lat_str.strip()), decimals)
            lon = round(float(lon_str.strip()), decimals)
            return f"{lat},{lon}"
        except (ValueError, TypeError):
            return v
    try:
        return f"{round(float(s), decimals)}"
    except (ValueError, TypeError):
        return v


def _generalize_date_value(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return v
    try:
        return str(pd.to_datetime(v).year)
    except (ValueError, TypeError):
        return v


def apply_redaction(df: pd.DataFrame, cfg: Dict) -> pd.DataFrame:
    """Apply the column-by-column redaction rules from cfg["pii"]["redact"].

    Skips rules whose column doesn't exist in df. Unknown strategies pass through with a warning.
    Returns a NEW DataFrame; the input is not mutated.
    """
    pii_cfg = cfg.get("pii") or {}
    rules = pii_cfg.get("redact") or []
    if not rules:
        return df
    out = df.copy()
    for rule in rules:
        col = rule.get("column")
        strategy = rule.get("strategy")
        if not col or col not in out.columns:
            continue
        if strategy == "drop":
            out = out.drop(columns=[col])
        elif strategy == "hash":
            out[col] = out[col].map(_hash_value)
        elif strategy == "mask":
            out[col] = out[col].map(_mask_value)
        elif strategy == "generalize_geo":
            decimals = int(rule.get("decimals", 2))
            out[col] = out[col].map(lambda v: _generalize_geo_value(v, decimals))
        elif strategy == "generalize_date":
            out[col] = out[col].map(_generalize_date_value)
        else:
            log.warning(f"PII: unknown redaction strategy '{strategy}' for column '{col}' — ignored")
    return out


def apply_pii(df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame], cfg: Dict) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Apply consent gating + column redaction to main df + all repeat tables.

    Returns (df, repeat_tables). The inputs are not mutated.
    """
    out_df = apply_redaction(apply_consent(df, cfg), cfg)
    out_repeats = {name: apply_redaction(rdf, cfg) for name, rdf in (repeat_tables or {}).items()}
    return out_df, out_repeats


def pii_summary(cfg: Dict) -> str:
    """Short one-line summary of the configured PII rules; '' when no rules."""
    pii_cfg = cfg.get("pii") or {}
    consent_col = pii_cfg.get("consent_column")
    rules = pii_cfg.get("redact") or []
    if not consent_col and not rules:
        return ""
    parts = []
    if consent_col:
        parts.append(f"consent={consent_col}")
    if rules:
        parts.append(f"{len(rules)} columns redacted")
    return ", ".join(parts)
