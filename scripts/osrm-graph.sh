#!/usr/bin/env bash
#
# osrm-graph.sh — one-shot build of the OSRM routing graph behind the
# road-following route geometry (the line the maps draw instead of the
# dashed stop-to-stop flight path).
#
# 100% free and keyless: the engine is the open-source BSD-2 OSRM Docker
# image (ghcr.io/project-osrm/osrm-backend), the map data is Geofabrik's
# free OpenStreetMap extract, and the optional bounding-box cut runs in
# the free osmium-tool image. No account, no API key, no card, no metered
# tier — the same product rule the map provider policy enforces.
#
# Pipeline (all inside Docker, nothing installed on the host):
#
#   download extract ──▶ optional bbox cut (osmium) ──▶ osrm-extract
#                                                   ──▶ osrm-partition
#                                                   ──▶ osrm-customize
#                                                          │
#                                                          ▼
#                                   infrastructure/osrm-data/<region>.osrm.*
#
# Usage (from anywhere; the script resolves the repo root itself):
#
#   ./scripts/osrm-graph.sh
#
# Configuration (environment variables):
#
#   EXTRACT_URL    OSM PBF extract to download.
#                  Default: https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf
#                  (Geofabrik's free download server; pick the extract that
#                  covers YOUR region — see the warning below.)
#   BBOX           Optional bounding box cut, "minLon,minLat,maxLon,maxLat".
#                  Default: 78.60,20.70,79.60,21.60 (the Nagpur region).
#                  Set BBOX="" to build the WHOLE downloaded extract
#                  (bigger graph, more RAM, slower build).
#   REGION         Base name of the artefacts inside infrastructure/osrm-data.
#                  Default: region   (⇒ region.osrm, region.osrm.hsgr, …)
#   OSRM_IMAGE     OSRM backend image. Default: ghcr.io/project-osrm/osrm-backend:v26.10.0-debian
#                  (multi-arch manifest; -amd64-debian / -arm64-debian are
#                  the arch-specific tags, `latest` tracks master).
#   OSMIUM_IMAGE   osmium-tool image for the bbox cut.
#                  Default: mschilde/osmium-tool:latest
#   REUSE_EXTRACT  Set to 1 to skip the download when the source extract is
#                  already in infrastructure/osrm-data (monthly refresh:
#                  leave it unset so the extract is re-downloaded).
#
# ⚠️  THE EXTRACT MUST COVER EVERY PLACE THE BUSES DRIVE. OSRM answers
#   NoRoute for coordinates outside the graph, and the app then falls back
#   to the honest dashed stop-to-stop line — a route silently drawn wrong
#   (straight) is worse than an error. Choose the Geofabrik extract (or a
#   BBOX) that contains every stop of every school using this deployment,
#   with margin for detours. Rebuild monthly: Geofabrik refreshes its
#   extracts daily, and new roads/closures change the routes drivers take.
#
# Output: infrastructure/osrm-data/ (git-ignored). Start the engine with
#
#   docker compose -f infrastructure/docker-compose.yml --profile routing up -d osrm
#
# and point the app at it (ROUTING_SERVICE_URL=http://localhost:5000), then
# backfill existing routes with the osrm-backfill workflow
# (.github/workflows/osrm-backfill.yml). Details: infrastructure/README.md.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OSRM_OUT_DIR:-$REPO_ROOT/infrastructure/osrm-data}"

EXTRACT_URL="${EXTRACT_URL:-https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf}"
BBOX="${BBOX:-78.60,20.70,79.60,21.60}"
REGION="${REGION:-region}"
OSRM_IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v26.10.0-debian}"
OSMIUM_IMAGE="${OSMIUM_IMAGE:-mschilde/osmium-tool:latest}"
REUSE_EXTRACT="${REUSE_EXTRACT:-0}"

SOURCE_PBF="$OUT_DIR/${REGION}-source.osm.pbf"
EXTRACT_PBF="$OUT_DIR/${REGION}.osm.pbf"

log() { printf '\n\033[1;36m==>%033[0m \033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR:\033[0m %s\n\n' "$*" >&2; exit 1; }

require_file() {
  # Fail loudly when an artefact is missing — a half-built graph makes
  # osrm-routed exit at boot, which is a much worse error message.
  local missing=0
  for artefact in "$@"; do
    if [ ! -f "$artefact" ]; then
      printf '  \033[1;31mmissing:\033[0m %s\n' "$artefact" >&2
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    die "graph artefacts missing in $OUT_DIR — the build above did not complete; re-run this script."
  fi
}

command -v docker >/dev/null 2>&1 \
  || die "docker not found — this script builds the graph inside containers."
docker info >/dev/null 2>&1 \
  || die "docker daemon not reachable — is Docker running?"

mkdir -p "$OUT_DIR"

log "OSRM graph build"
printf '  extract : %s\n' "$EXTRACT_URL"
printf '  bbox    : %s\n' "${BBOX:-<none — whole extract>}"
printf '  region  : %s\n' "$REGION"
printf '  out dir : %s\n' "$OUT_DIR"
printf '  image   : %s\n' "$OSRM_IMAGE"

# ── 1. Download the extract ────────────────────────────────────────────────
log "1/5 Downloading the OSM extract"
if [ "$REUSE_EXTRACT" = "1" ] && [ -f "$SOURCE_PBF" ]; then
  echo "  reusing $SOURCE_PBF (REUSE_EXTRACT=1)"
else
  curl -fL --retry 3 --connect-timeout 30 -o "$SOURCE_PBF.part" "$EXTRACT_URL" \
    || die "download failed: $EXTRACT_URL"
  mv "$SOURCE_PBF.part" "$SOURCE_PBF"
fi
echo "  $(du -h "$SOURCE_PBF" | cut -f1)  $SOURCE_PBF"

# ── 2. Optional bounding-box cut (osmium, free image) ─────────────────────
if [ -n "$BBOX" ]; then
  log "2/5 Cutting the extract to the bounding box ($BBOX) with osmium"
  docker run --rm \
    -v "$OUT_DIR":/data \
    "$OSMIUM_IMAGE" \
    osmium extract --strategy complete_ways --bbox "$BBOX" \
      -o "/data/$(basename "$EXTRACT_PBF")" "/data/$(basename "$SOURCE_PBF")" \
    || die "osmium extract failed (image: $OSMIUM_IMAGE)"
  require_file "$EXTRACT_PBF"
  echo "  $(du -h "$EXTRACT_PBF" | cut -f1)  $EXTRACT_PBF"
else
  log "2/5 No BBOX given — building the whole extract"
  cp "$SOURCE_PBF" "$EXTRACT_PBF"
fi

# ── 3. osrm-extract (car profile) ──────────────────────────────────────────
log "3/5 osrm-extract (profile /opt/car.lua) — the long step"
docker run --rm \
  -v "$OUT_DIR":/data \
  "$OSRM_IMAGE" \
  osrm-extract -p /opt/car.lua "/data/$(basename "$EXTRACT_PBF" .osm.pbf).osrm" \
  || die "osrm-extract failed (image: $OSRM_IMAGE)"
require_file "$OUT_DIR/$REGION.osrm.ebg" "$OUT_DIR/$REGION.osrm.geometry" \
  "$OUT_DIR/$REGION.osrm.names" "$OUT_DIR/$REGION.osrm.nbg_nodes"

# ── 4. osrm-partition (MLD) ────────────────────────────────────────────────
log "4/5 osrm-partition (MLD partition)"
docker run --rm \
  -v "$OUT_DIR":/data \
  "$OSRM_IMAGE" \
  osrm-partition "/data/$REGION.osrm" \
  || die "osrm-partition failed"
require_file "$OUT_DIR/$REGION.osrm.partition" "$OUT_DIR/$REGION.osrm.cells"

# ── 5. osrm-customize (MLD) ────────────────────────────────────────────────
log "5/5 osrm-customize (MLD customize)"
docker run --rm \
  -v "$OUT_DIR":/data \
  "$OSRM_IMAGE" \
  osrm-customize "/data/$REGION.osrm" \
  || die "osrm-customize failed"
require_file "$OUT_DIR/$REGION.osrm.hsgr"

# ── Done ───────────────────────────────────────────────────────────────────
log "Graph built: $OUT_DIR"
du -sh "$OUT_DIR"
echo "  artefacts (MLD needs all of these):"
for artefact in \
  "$REGION.osrm.ebg" "$REGION.osrm.geometry" "$REGION.osrm.names" \
  "$REGION.osrm.nbg_nodes" "$REGION.osrm.partition" "$REGION.osrm.cells" \
  "$REGION.osrm.hsgr"; do
  printf '    %s\n' "$artefact"
done

cat <<'NEXT'

Next steps:

  1. Start the engine (profile-gated — plain `docker compose up -d` does NOT
     start it):

       docker compose -f infrastructure/docker-compose.yml --profile routing up -d osrm

     (set OSRM_REGION/OSRM_PORT in the environment if you renamed the
     region or the port; the healthcheck needs the graph above).

  2. Point the app at it — web/.env (or the Render environment):

       ROUTING_SERVICE_URL=http://localhost:5000

     Blank/unset keeps road geometry DISABLED: every geometry endpoint
     answers { status: "unavailable" } and the maps draw the dashed
     stop-to-stop line, exactly as before.

  3. Backfill the routes that already exist (free GitHub-hosted runner):

       GitHub → Actions → "OSRM route-geometry backfill" → Run workflow

     (needs a SCHOOL_ADMIN access token — see the workflow inputs).

  4. Monthly: re-run this script with a fresh extract (Geofabrik updates
     daily) and re-run the backfill, so new roads and closures are picked
     up. Remember: the extract must cover every place the buses drive —
     outside it OSRM answers NoRoute and the map falls back to the dashed
     line.
NEXT
