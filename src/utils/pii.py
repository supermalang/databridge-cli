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
