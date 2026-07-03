# Output / export formats — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **OUT-3 — PostgreSQL remote table export**

  **Created:** 2026-06-17 · **Completed:** 2026-06-25

  Same as OUT-2 for PostgreSQL.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_sql`)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - PostgreSQL chip selectable; `export.database` fields shown
  - `download` creates/replaces the target table with redacted rows
  - Reuses the `_export_sql` path (no Postgres-specific branch needed)

  **Unit tests:** `tests/test_export_sql.py` — mock a PostgreSQL engine and assert `_export_sql` writes to the correct table without a Postgres-specific code path; assert `if_exists="replace"` behaviour; assert redacted columns are not present in the written rows.

  **E2E:** N/A (no UI surface)

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** point `export.database` at a scratch Postgres, run `download --sample 20`,
  inspect the table.

---

- [x] **OUT-2 — MySQL remote table export**

  **Created:** 2026-06-17 · **Completed:** 2026-06-25

  Enable the MySQL target (credentials in `export.database`) once verified against a live DB.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_sql`)

  **Config/schema impact:** None — `export.database` schema exists; `sqlalchemy` + driver are
  optional imports inside `_export_sql`.

  **Acceptance criteria**
  - MySQL chip selectable; `export.database` fields shown
  - `download` creates/replaces `export.database.table` with redacted rows
  - Missing driver → clear, non-crashing error message

  **Unit tests:** `tests/test_export_sql.py` — mock a MySQL engine and assert `_export_sql` calls `DataFrame.to_sql` with the correct table name and `if_exists="replace"`; assert a missing `pymysql` driver raises a user-visible error rather than an uncaught `ImportError`; assert redacted rows are passed to the SQL layer.

  **E2E:** N/A (no UI surface)

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** point `export.database` at a scratch MySQL, run `download --sample 20`, inspect
  the table.

---

- [x] **OUT-1 — JSON export (records array)**

  **Created:** 2026-06-17 · **Completed:** 2026-06-25

  Surface JSON in the format chip-tabs and verify the `_export_file` JSON branch end-to-end.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_file`)

  **Config/schema impact:** None — `export.format: json` already accepted.

  **Acceptance criteria**
  - JSON chip selectable in Deliver → Output (no `soon` badge)
  - `download` writes a records-array `.json` to `export.output_dir`
  - Round-trips with PII redaction applied (same gate as CSV/XLSX)

  **Unit tests:** `tests/test_export_json.py` — assert `_export_file` writes a valid JSON records array; assert output contains only redacted fields when PII config is active; assert file is created at `export.output_dir`; assert round-trip value equality against source DataFrame.

  **E2E:** N/A (no UI surface)

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** set `export.format: json`, run `download --sample 20`, open the output file.

---

