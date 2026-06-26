"""OUT-1 — JSON export (records array).

AC-derived tests for the JSON branch of the file export path:
  - `_export_file(fmt='json')` writes a VALID JSON records array (list of dicts)
    to `export.output_dir`.
  - The file is created at `export.output_dir` with the expected name.
  - Round-trip value equality: reading the JSON back yields the same values as
    the source DataFrame.
  - With a PII config active, the JSON export goes through the same redaction
    gate as CSV/XLSX (via `export_data`) — only redacted fields are present.
"""

import json
from pathlib import Path

import pandas as pd

from src.data.transform import _export_file, export_data


def _cfg(tmp_path, fmt="json", **pii):
    cfg = {
        "form": {"alias": "survey"},
        "export": {"format": fmt, "output_dir": str(tmp_path)},
    }
    if pii:
        cfg["pii"] = pii
    return cfg


def _json_files(tmp_path):
    return sorted(Path(tmp_path).glob("*.json"))


def test_export_file_json_writes_records_array(tmp_path):
    """`_export_file(fmt='json')` writes a JSON array of row dicts."""
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "S", "E"]})
    cfg = _cfg(tmp_path)

    _export_file(df, cfg, "json")

    files = _json_files(tmp_path)
    assert len(files) == 1, f"expected exactly one .json file, got {files}"
    loaded = json.loads(files[0].read_text(encoding="utf-8"))
    # Records array == list of dicts, one per row.
    assert isinstance(loaded, list), f"JSON root must be an array, got {type(loaded)}"
    assert len(loaded) == len(df)
    assert all(isinstance(row, dict) for row in loaded)


def test_export_file_json_created_at_output_dir_with_expected_name(tmp_path):
    """The file lands in export.output_dir and matches the `{alias}_data_*.json` name."""
    df = pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"]})
    cfg = _cfg(tmp_path)

    _export_file(df, cfg, "json")

    files = _json_files(tmp_path)
    assert len(files) == 1
    out = files[0]
    assert out.parent == Path(tmp_path), "JSON must be written to export.output_dir"
    assert out.name.startswith("survey_data_"), f"unexpected filename {out.name}"
    assert out.suffix == ".json"


def test_export_file_json_round_trip_value_equality(tmp_path):
    """Reading the JSON back yields the same values as the source DataFrame."""
    df = pd.DataFrame(
        {
            "_id": [1, 2, 3],
            "Region": ["North", "South", "East"],
            "Score": [10, 20, 30],
            "Note": ["café", "naïve", "über"],  # non-ASCII must survive
        }
    )
    cfg = _cfg(tmp_path)

    _export_file(df, cfg, "json")

    files = _json_files(tmp_path)
    assert len(files) == 1
    loaded = json.loads(files[0].read_text(encoding="utf-8"))
    roundtrip = pd.DataFrame(loaded)[list(df.columns)]
    pd.testing.assert_frame_equal(
        roundtrip.reset_index(drop=True),
        df.reset_index(drop=True),
        check_dtype=False,
    )


def test_export_json_only_redacted_fields_when_pii_active(tmp_path):
    """With a PII config active, JSON export drops redacted columns and consent-gates
    rows — same gate as CSV/XLSX (applied at the export_data boundary)."""
    df = pd.DataFrame(
        {
            "_id": [1, 2, 3],
            "Consent": ["yes", "no", "yes"],
            "Name": ["Alice", "Bob", "Cara"],  # to be dropped
            "Region": ["N", "S", "E"],
        }
    )
    cfg = _cfg(
        tmp_path,
        consent_column="Consent",
        redact=[{"column": "Name", "strategy": "drop"}],
    )

    export_data(df, cfg)

    files = _json_files(tmp_path)
    assert len(files) == 1, f"expected one .json file, got {files}"
    loaded = json.loads(files[0].read_text(encoding="utf-8"))

    assert isinstance(loaded, list)
    # Consent gating: only the two consenting rows survive.
    assert len(loaded) == 2
    # Redacted column must not be present in ANY record.
    assert all("Name" not in row for row in loaded), "redacted 'Name' leaked into JSON"
    # Non-PII columns round-trip.
    assert all("Region" in row for row in loaded)
    regions = {row["Region"] for row in loaded}
    assert regions == {"N", "E"}
