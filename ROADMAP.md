# Roadmap

Planned work, grouped by area. Items here are intentionally *not* enabled in the
UI yet — they render as disabled "soon" affordances so users know they're coming.

## Output / export formats

The **Deliver → Output** tab ships **CSV** and **XLSX** data-file exports today
(`export.format`). The following targets are designed in the config schema and
have CLI/back-end support, but are gated off in the UI until verified
end-to-end per project:

- [ ] **JSON** — records array
- [ ] **MySQL** — remote table export (credentials in `export.database`)
- [ ] **PostgreSQL** — remote table export

When re-enabling a format, drop its `soon: true` flag in `FORMATS`
([frontend/src/pages/Sources.jsx](frontend/src/pages/Sources.jsx)) and confirm
the matching `_export_*` path in [src/data/transform.py](src/data/transform.py).
