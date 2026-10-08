# Paste-ready GitHub workflow: OSRM route-geometry backfill

This folder exists for **one reason**: Arena's GitHub App connection currently
has no `workflows` permission, so no session can push a file into
`.github/workflows/` (GitHub rejects it server-side:
*"refusing to allow a GitHub App to create or update workflow … without
`workflows` permission"*). Everything else from the OSRM engine PR (#234) is
already on `main`; only the backfill workflow file could not be delivered.

So the workflow ships here as a **template**, byte-for-byte what belongs at:

```
.github/workflows/osrm-backfill.yml
```

## Install it (30 seconds, GitHub web UI)

1. Open
   <https://github.com/aaqibjavedcoding/school-bus-tracking/new/main?filename=.github/workflows/osrm-backfill.yml>
   (the `filename` query parameter pre-fills the path).
2. Paste the contents of [`osrm-backfill.yml`](./osrm-backfill.yml) into the editor.
3. Commit directly to `main` (or open a PR — your own account has the
   `workflows` permission; only the Arena App lacks it).

After that: **Actions → "OSRM route-geometry backfill" → Run workflow**.

Before the first run, set the repository secret
`OSRM_ADMIN_TOKEN` = a `SCHOOL_ADMIN` access token of the target school
(*Settings → Secrets and variables → Actions → New repository secret*). The
workflow's `admin_token` input exists only for one-off runs — secret preferred.

## Once the real file exists

Delete this folder in the same commit (or a follow-up): two copies of the same
workflow would drift. If Arena ever gains the `workflows` permission, a session
can simply move the file into place and remove this note.

See `infrastructure/README.md` → "OSRM routing engine" and
`docs/live-tracking-map.md` → "Road routing" for the full runbook.
