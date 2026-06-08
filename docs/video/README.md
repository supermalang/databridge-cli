# Video assets — Databridge demo

Everything needed to cut a product demo video (made for **hyperframe**), aimed at prospective users.

| File | What it is |
|---|---|
| [`walkthrough.md`](walkthrough.md) | Marketing walkthrough — the pitch, who it's for, the 5-stage pipeline, benefits, with every screenshot embedded. Read this first. |
| [`shot-list.md`](shot-list.md) | Scene-by-scene video plan — timings, voiceover lines, and hyperframe motion/annotation hints. |
| `screenshots/` | 12 real captures of the app (1440×900 @2×), named in pipeline order. |
| `output-assets/` | The generated sample Word report + a curated set of real rendered charts. |

## Regenerating the screenshots

The screenshots were captured from the running app, not mocked:

1. Start a **dev-mode** instance (auth disabled) on `:8010` from the project root:
   ```bash
   set -a && . ./.env && set +a
   unset OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET   # disables auth -> dev user owns all
   PYTHONPATH=. uvicorn web.main:app --host 127.0.0.1 --port 8010
   ```
2. Run the capture (uses the Playwright chromium already installed in this dev container):
   ```bash
   node docs/video/../../scripts/capture.cjs   # or: node scripts/capture.cjs from the worktree
   ```

The capture script walks every stage/sub-tab, waits out async panels (Profile/Validate), and writes
the ordered PNGs into `screenshots/`. Re-running overwrites them identically.

> The demo project (`pcp_mauritanie_v1`) was populated with its charts/indicators and a built report
> so the Analyze and Deliver screens show real content. Relabel the project name in post if you want
> a generic "Demo Project".
