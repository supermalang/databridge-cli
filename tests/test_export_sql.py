"""OUT-2 (MySQL) + OUT-3 (PostgreSQL) — remote table export via `_export_sql`.

Both cards drive the SAME `_export_sql` path (one dialect-parameterised function,
no Postgres-specific branch), so their AC-derived tests share this file.

The SQLAlchemy engine, the `pandas.DataFrame.to_sql` call, and the optional
DB-API driver import are all MOCKED — no live MySQL/Postgres server is required.

AC mapping
----------
OUT-2 (MySQL):
  - `_export_sql` calls `DataFrame.to_sql` with the correct table name and
    `if_exists="replace"`.                                  -> test_mysql_to_sql_table_and_replace
  - A missing `pymysql` driver surfaces a clear, user-visible error rather than
    an uncaught `ImportError`/`ModuleNotFoundError`.        -> test_mysql_missing_driver_user_visible_error
  - Redacted rows reach the SQL layer (PII gate applied before `_export_sql`).
                                                            -> test_mysql_redacted_rows_reach_sql_layer

OUT-3 (PostgreSQL):
  - `_export_sql` writes to the correct table with NO Postgres-specific code path
    (same `to_sql` mechanics as MySQL).                     -> test_postgres_to_sql_table_no_special_path
  - `if_exists="replace"` behaviour.                        -> test_postgres_if_exists_replace
  - Redacted columns are NOT present in the written rows.   -> test_postgres_redacted_columns_absent
"""

import pandas as pd
import pytest

import src.data.transform as transform
from src.data.transform import _export_sql, export_data


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #

class _FakeEngine:
    """Stand-in for a SQLAlchemy engine; records the URL it was built from."""

    def __init__(self, url):
        self.url = url


def _db_cfg(dialect, *, table="submissions", if_exists="replace", **pii):
    """Config with an `export.database` block for the given SQL dialect."""
    cfg = {
        "form": {"alias": "survey"},
        "export": {
            "format": dialect,  # 'mysql' | 'postgres'
            "database": {
                "host": "db.example.org",
                "port": 3306 if dialect == "mysql" else 5432,
                "name": "reporting",
                "user": "writer",
                "password": "secret",
                "table": table,
                "if_exists": if_exists,
            },
        },
    }
    if pii:
        cfg["pii"] = pii
    return cfg


@pytest.fixture
def captured_to_sql(monkeypatch):
    """Capture every `DataFrame.to_sql` call. Returns a list of recorded calls,
    each: {'self': df, 'name': table, 'engine': engine, 'if_exists': mode}."""
    calls = []

    def fake_to_sql(self, name, con, if_exists="fail", index=True, **kwargs):
        calls.append(
            {
                "self": self,
                "frame": self.copy(),
                "name": name,
                "engine": con,
                "if_exists": if_exists,
                "index": index,
                "kwargs": kwargs,
            }
        )
        return None

    monkeypatch.setattr(pd.DataFrame, "to_sql", fake_to_sql, raising=True)
    return calls


@pytest.fixture
def fake_engine_factory(monkeypatch):
    """Replace the engine builder with a fake; record URLs passed to it."""
    urls = []

    def fake_create_engine(url, *a, **k):
        urls.append(url)
        return _FakeEngine(url)

    monkeypatch.setattr(transform, "create_engine", fake_create_engine, raising=False)
    return urls


# --------------------------------------------------------------------------- #
# OUT-2 — MySQL
# --------------------------------------------------------------------------- #

def test_mysql_to_sql_table_and_replace(fake_engine_factory, captured_to_sql):
    """OUT-2: `_export_sql` writes to `export.database.table` with if_exists='replace'."""
    df = pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"]})
    cfg = _db_cfg("mysql", table="kobo_submissions", if_exists="replace")

    _export_sql(df, cfg, "mysql")

    assert len(captured_to_sql) == 1, "expected exactly one to_sql call (main table)"
    call = captured_to_sql[0]
    assert call["name"] == "kobo_submissions", "wrong target table name"
    assert call["if_exists"] == "replace", "main table must be written with if_exists='replace'"
    assert call["index"] is False, "index must not be written as a column"
    # Engine must have been built for the MySQL dialect.
    assert fake_engine_factory, "create_engine was never called"
    assert fake_engine_factory[0].startswith("mysql"), "MySQL engine URL expected"


def test_mysql_missing_driver_user_visible_error(monkeypatch, fake_engine_factory):
    """OUT-2: a missing `pymysql` driver must produce a clear, user-visible error,
    NOT an uncaught ImportError/ModuleNotFoundError bubbling out of pandas."""
    df = pd.DataFrame({"_id": [1], "Region": ["N"]})
    cfg = _db_cfg("mysql")

    def boom(self, name, con, **kwargs):
        # SQLAlchemy raises this when the DB-API driver package is absent.
        raise ModuleNotFoundError("No module named 'pymysql'")

    monkeypatch.setattr(pd.DataFrame, "to_sql", boom, raising=True)

    with pytest.raises(Exception) as exc:  # noqa: PT011 - asserting on type below
        _export_sql(df, cfg, "mysql")

    # The error must NOT be a raw ModuleNotFoundError/ImportError surfacing to the
    # user — it must be translated into a clear, actionable message.
    assert not isinstance(exc.value, ImportError), (
        "missing pymysql driver leaked as an uncaught ImportError/ModuleNotFoundError; "
        "it must be caught and re-raised as a clear user-facing error"
    )
    msg = str(exc.value).lower()
    assert "pymysql" in msg or "driver" in msg, (
        f"error message should name the missing driver / explain the fix, got: {exc.value!r}"
    )
    assert "no module named" != msg.strip(), "message must be human-readable, not the bare import error"


def test_mysql_redacted_rows_reach_sql_layer(fake_engine_factory, captured_to_sql):
    """OUT-2: rows handed to the SQL layer are the PII-gated/redacted ones.
    Routing mysql through `export_data` must apply enforce_pii before `_export_sql`."""
    df = pd.DataFrame(
        {
            "_id": [1, 2, 3],
            "Consent": ["yes", "no", "yes"],
            "Name": ["Alice", "Bob", "Cara"],  # dropped by redaction
            "Region": ["N", "S", "E"],
        }
    )
    cfg = _db_cfg(
        "mysql",
        consent_column="Consent",
        redact=[{"column": "Name", "strategy": "drop"}],
    )

    export_data(df, cfg)

    assert len(captured_to_sql) == 1, "expected one to_sql call for the main table"
    written = captured_to_sql[0]["frame"]
    # Consent gating: only the two consenting rows are written.
    assert len(written) == 2, "consent-rejected rows must not reach the SQL layer"
    # Redacted column must be absent from the rows passed to to_sql.
    assert "Name" not in written.columns, "redacted 'Name' column leaked to the SQL layer"
    assert set(written["Region"]) == {"N", "E"}


# --------------------------------------------------------------------------- #
# OUT-3 — PostgreSQL (reuses the same `_export_sql` path)
# --------------------------------------------------------------------------- #

def test_postgres_to_sql_table_no_special_path(fake_engine_factory, captured_to_sql):
    """OUT-3: Postgres writes to the configured table through the SAME to_sql
    mechanics as MySQL — no Postgres-specific code branch."""
    df = pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"]})
    cfg = _db_cfg("postgres", table="pg_submissions", if_exists="replace")

    _export_sql(df, cfg, "postgres")

    assert len(captured_to_sql) == 1, "expected exactly one to_sql call"
    call = captured_to_sql[0]
    assert call["name"] == "pg_submissions", "wrong target table name"
    assert call["index"] is False
    # Same generic to_sql(engine) call shape as MySQL — engine is the fake one.
    assert isinstance(call["engine"], _FakeEngine), "to_sql must receive the SQLAlchemy engine"
    assert fake_engine_factory and fake_engine_factory[0].startswith("postgres"), (
        "Postgres engine URL expected"
    )


def test_postgres_if_exists_replace(fake_engine_factory, captured_to_sql):
    """OUT-3: if_exists='replace' is honoured for the Postgres target table."""
    df = pd.DataFrame({"_id": [1], "Region": ["N"]})
    cfg = _db_cfg("postgres", if_exists="replace")

    _export_sql(df, cfg, "postgres")

    assert len(captured_to_sql) == 1
    assert captured_to_sql[0]["if_exists"] == "replace"


def test_postgres_redacted_columns_absent(fake_engine_factory, captured_to_sql):
    """OUT-3: redacted columns are not present in the rows written to Postgres."""
    df = pd.DataFrame(
        {
            "_id": [1, 2],
            "Consent": ["yes", "yes"],
            "Phone": ["111", "222"],  # dropped
            "Region": ["N", "S"],
        }
    )
    cfg = _db_cfg(
        "postgres",
        consent_column="Consent",
        redact=[{"column": "Phone", "strategy": "drop"}],
    )

    export_data(df, cfg)

    assert len(captured_to_sql) == 1, "expected one to_sql call for the main table"
    written = captured_to_sql[0]["frame"]
    assert "Phone" not in written.columns, "redacted 'Phone' column leaked to the SQL layer"
    assert list(written.columns) == ["_id", "Consent", "Region"]
    assert len(written) == 2
