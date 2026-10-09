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

   | Secret                   | Used by                     | What it is                    |
   | ------------------------ | --------------------------- | ----------------------------- |
   | `OSRM_PLATFORM_EMAIL`    | `mode = platform` (default) | SUPER_ADMIN account e-mail    |
   | `OSRM_PLATFORM_PASSWORD` | `mode = platform`           | SUPER_ADMIN account password  |
   | `OSRM_SCHOOL_EMAIL`      | `mode = school`             | SCHOOL_ADMIN account e-mail   |
   | `OSRM_SCHOOL_PASSWORD`   | `mode = school`             | SCHOOL_ADMIN account password |

   Only the pair for the mode you run is needed. Nothing else is stored: the
   workflow signs in inside the run and masks the access token.

## Run it

**Actions → "OSRM route-geometry backfill" → Run workflow**

| Input | Default | Meaning |
| | --- | --- |
| `mode` | `platform` | `platform` = every school, one SUPER_ADMIN run; `school` = one school (SCHOOL_ADMIN) |
| `api_base` | `https://kidbus.onrender.com/api/v1` | API base including `/api/v1` |
| `school_code` | blank | `school` mode only: the school code (or UUID) to sign in to |
| `route_ids` | blank | `school` mode only: comma-separated route ids; blank = every missing route of the school |
| `extract_url` / `bbox` | India western zone / Nagpur box | Map extract to download and the box to cut. The extract must cover every place the buses drive |
| `build_graph_only` | false | Build the graph and stop; no API or sign-in |
| `upload_graph` | false | Also upload the graph as an artifact (skipped above 2 GB) |
| `dry_run` | false | **Preflight only.** Warm the API, sign in, write the per-school table. No graph build, no engine, no fill — the only cost is two minutes of runner time |

For the platform run, keep `mode = platform` and the default `api_base`. Each
run builds the graph from the current extract first, so the job has a
90-minute limit.

## Daily schedule (03:00 IST)

The workflow also runs every day at 03:00 IST (21:30 UTC) on the default
branch. A scheduled run has no inputs, so the workflow falls back to the
defaults (`mode = platform`, the default `api_base`, `extract_url` and
`bbox`). The preflight is the first step: when nothing is fillable the run
exits before the 15-minute graph build, so an idle day costs ~2 minutes of
runner time, not 90.

A schedule with missing `OSRM_PLATFORM_*` secrets is a no-op (`::notice::` +
exit 0): the badge stays green and the day-2 cost is zero. A manual run with
the same missing secrets is still a hard failure (`::error::` + exit 1), the
way the original step did.

## Reading the result

The preflight (also the first step of every manual run) writes a per-school
table to the run's step summary:

| Column | Meaning |
| | --- |
| missing | routes whose geometry was missing when the run started |
| outside bbox | only with a `bbox`: routes with at least one stop outside the OSM extract — the engine cannot give those routes a road; they need a separate run with the matching `extract_url` and `bbox` |
| fillable | only with a `bbox`: missing routes whose stops are all inside the box — the routes this run will actually try to fill |
| filled | stored by this run and confirmed by a re-check (now a cache hit) |
| no road route | OSRM has no road for those stops (outside the extract, or a stop far from a road). The map keeps the dashed line. Not a failure |
| failed | engine, transport or API trouble, or stops that changed mid-run. Re-run the workflow |
| left | still missing after the run |

The preflight also reports the deployed commit (read from
`/api/v1/health`). When the workflow gates the rest of the job on
`needs_run = fillable > 0` and the preflight said `false`, the table is the
only output — no graph was built, no engine started, no engine route
queried. A `dry_run=true` run is the same shape, by hand.

## Failure modes and what to do

| Symptom                                                    | Meaning                                                                                                                              | Next step                                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 404 on the missing list                                    | The deployed API does not yet have the platform endpoints                                                                            | Deploy `main` first, then re-run. The preflight catches this in seconds, not 15 minutes after the graph build                                                         |
| 401 / 403 on the sign-in or the list                       | The password was just rotated, or the account is not a `SUPER_ADMIN`                                                                 | Update `OSRM_PLATFORM_EMAIL` / `OSRM_PLATFORM_PASSWORD`, then re-run                                                                                                  |
| `NoRoute` / `NoSegment` for some routes                    | The stops fall outside the extract the engine is built from, or a stop is far from any road                                          | The run continues (the map keeps the dashed line for them). If many schools are affected, run a separate platform backfill with the matching `extract_url` and `bbox` |
| The preflight retries 6 times then exits 1                 | Render was cold-starting (a free instance sleeps) and `/health` never answered within 2 minutes                                      | Re-run. The schedule catches the next morning automatically                                                                                                           |
| Nothing is fillable (`needs_run = false`)                  | Every routable route is already cached                                                                                               | Nothing to do. The schedule checks again at 03:00 IST                                                                                                                 |
| A stop is inside the bbox but the route is still `NoRoute` | The stop is inside the extract's box but far from any road in the graph (a school in a newly-built area, a stop in a gated compound) | The route stays `missing` and shows in the summary. Update the stop coordinates when the road is real, then re-run                                                    |

## New routes later

**Re-run platform mode.** Only the routes still missing geometry are filled;
cached routes are not touched. Re-run it monthly as well: each run rebuilds the
graph from the current extract, so new roads and closures reach the routes.

## Related

- `infrastructure/README.md` → "OSRM routing engine" (the engine, the graph,
  the local command)
- `docs/live-tracking-map.md` → "Road routing" (the three fill paths and the
  API contract)
- `scripts/osrm-backfill.mjs` (the runner-side client; `ADMIN_MODE` and
  `CHECK_ONLY` select the flow)
- `scripts/osrm-graph.sh` (builds the graph)

## Install recipe, in order

1. **Deploy** `main` to Render. The 404-vs-401 check the preflight does
   only works against the platform endpoints the deploy carries — a
   missing deploy is the 404 case.
2. **Check the deployed commit** matches the merge commit:
   `GET https://<host>/api/v1/health` returns `{ "commit": "…" }`. The
   preflight prints the same value in its step summary; a mismatch means
   Render is still rolling out.
3. **Set the secrets** under Settings → Secrets and variables → Actions
   (`OSRM_PLATFORM_EMAIL` + `OSRM_PLATFORM_PASSWORD` for the default
   `mode = platform`).
4. **Paste this template** into `.github/workflows/osrm-backfill.yml`
   (the way the install section above describes — the Arena App cannot
   push there, you have to do it by hand).
5. **Dry run**: Actions → "OSRM route-geometry backfill" → Run workflow
   with `mode = platform` and `dry_run = true`. Read the per-school table
   in the step summary. No graph was built.
6. **Run for real**: same, with `dry_run = false` (or just leave it on
   the default). The preflight gates the graph on `needs_run = fillable >
0`, so an idle day is two minutes of runner time, not 90.
