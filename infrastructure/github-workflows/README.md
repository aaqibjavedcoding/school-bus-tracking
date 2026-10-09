# GitHub workflow: OSRM route-geometry backfill

`osrm-backfill.yml` in this folder is the **source copy** of the workflow that
fills the road-geometry cache for every school. It is kept here, not in
`.github/workflows/`, because Arena's GitHub App connection has no `workflows`
permission, so an automated session cannot push into `.github/workflows/`.
Anyone with write access can install it through the GitHub web UI.

The file is already on `main` as `.github/workflows/osrm-backfill.yml` (an
earlier version). Installing this one means **editing that existing file**,
not creating a new one.

## Install or update it (web UI, about a minute)

1. Open `infrastructure/github-workflows/osrm-backfill.yml` on `main` and
   click **Raw**. Select all and copy.
2. Open `.github/workflows/osrm-backfill.yml` on `main`, click the pencil
   (**Edit this file**), select all, paste, and commit directly to `main` (or
   open a PR from your own account; your account has the `workflows`
   permission, the Arena App does not).
3. Create the secrets under **Settings → Secrets and variables → Actions →
   New repository secret**:

   | Secret | Used by | What it is |
   | --- | --- | --- |
   | `OSRM_PLATFORM_EMAIL` | `mode = platform` (default) | SUPER_ADMIN account e-mail |
   | `OSRM_PLATFORM_PASSWORD` | `mode = platform` | SUPER_ADMIN account password |
   | `OSRM_SCHOOL_EMAIL` | `mode = school` | SCHOOL_ADMIN account e-mail |
   | `OSRM_SCHOOL_PASSWORD` | `mode = school` | SCHOOL_ADMIN account password |

   Only the pair for the mode you run is needed. Nothing else is stored: the
   workflow signs in inside the run and masks the access token. The retired
   `OSRM_ADMIN_TOKEN` secret (a 15-minute JWT) is no longer read and can be
   deleted.

## Run it

**Actions → "OSRM route-geometry backfill" → Run workflow**

| Input | Default | Meaning |
| --- | --- | --- |
| `mode` | `platform` | `platform` = every school, one SUPER_ADMIN run; `school` = one school (SCHOOL_ADMIN) |
| `api_base` | — (required) | API base including `/api/v1`, e.g. `https://kidbus.onrender.com/api/v1` |
| `school_code` | blank | `school` mode only: the school code (or UUID) to sign in to |
| `route_ids` | blank | `school` mode only: comma-separated route ids; blank = every missing route of the school |
| `extract_url` / `bbox` | India western zone / Nagpur box | Map extract to download and the box to cut. The extract must cover every place the buses drive |
| `build_graph_only` | false | Build the graph and stop; no API or sign-in |
| `upload_graph` | false | Also upload the graph as an artifact (skipped above 2 GB) |

For the platform run, use `mode = platform` and `api_base =
https://kidbus.onrender.com/api/v1`. Each run builds the graph from the
current extract first, so the job has a 90-minute limit.

### Reading the result

The run prints, and the **step summary** repeats, a table with one row per
school that has missing routes:

| Column | Meaning |
| --- | --- |
| missing | routes whose geometry was missing when the run started |
| filled | stored by this run and confirmed by a re-check (now a cache hit) |
| no road route | OSRM has no road for those stops (outside the extract, or a stop far from a road). The map keeps the dashed line. Not a failure |
| failed | engine, transport or API trouble, or stops that changed mid-run. Re-run the workflow |
| left | still missing after the run |

### New routes later

**Re-run platform mode.** Only the routes still missing geometry are filled;
cached routes are not touched. Re-run it monthly as well: each run rebuilds the
graph from the current extract, so new roads and closures reach the routes.

## Related

- `infrastructure/README.md` → "OSRM routing engine" (the engine, the graph,
  the local command)
- `docs/live-tracking-map.md` → "Road routing" (the three fill paths and the
  API contract)
- `scripts/osrm-backfill.mjs` (the runner-side client; `ADMIN_MODE` selects
  the flow)
- `scripts/osrm-graph.sh` (builds the graph)
