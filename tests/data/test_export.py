"""Tests for src.data.transform._export_sql — if_exists option."""
from unittest.mock import patch, MagicMock
import pandas as pd

from src.data.transform import _export_sql


def _cfg(if_exists=None):
    db = {
        "host": "localhost", "port": 5432, "name": "test",
        "user": "u", "password": "p", "table": "submissions",
    }
    if if_exists is not None:
        db["if_exists"] = if_exists
    return {"export": {"format": "postgres", "database": db}}


def test_export_sql_default_uses_replace_for_back_compat():
    df = pd.DataFrame({"a": [1, 2]})
    with patch("src.data.transform.create_engine") as mock_engine, \
         patch.object(pd.DataFrame, "to_sql") as mock_to_sql:
        mock_engine.return_value = MagicMock()
        _export_sql(df, _cfg(), "postgres", None)
    assert mock_to_sql.call_args.kwargs.get("if_exists") == "replace"


def test_export_sql_respects_append():
    df = pd.DataFrame({"a": [1, 2]})
    with patch("src.data.transform.create_engine") as mock_engine, \
         patch.object(pd.DataFrame, "to_sql") as mock_to_sql:
        mock_engine.return_value = MagicMock()
        _export_sql(df, _cfg(if_exists="append"), "postgres", None)
    assert mock_to_sql.call_args.kwargs.get("if_exists") == "append"


def test_export_sql_rejects_invalid_if_exists():
    import pytest
    df = pd.DataFrame({"a": [1, 2]})
    with pytest.raises(ValueError, match="if_exists"):
        _export_sql(df, _cfg(if_exists="upsert_or_whatever"), "postgres", None)
