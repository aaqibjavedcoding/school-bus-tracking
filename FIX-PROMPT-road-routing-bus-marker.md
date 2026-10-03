# FIX PROMPT — Road-by-Road Map Navigation Route & Persistent Bus Marker Visibility

## Context (repo: aaqibjavedcoding/school-bus-tracking, monorepo)
- `mobile/` — Expo React Native app (`mobile/src/features/crew/DriverTripMap.tsx`, `mobile/src/features/map/LiveMapSurface.tsx`, `mobile/src/features/crew/trip-map-geometry.ts`).
- `web/` — Next.js admin/parent console (`web/src/features/map/MapViewInner.tsx`, `web/src/features/map/map-overlays.ts`).
- Routing & Directions: `mobile/src/lib/navigation.ts`, `mobile/src/features/crew/TripNavigationCard.tsx`.

---

## Field Report (Issues Identified)
1. **Airway / Flight-like straight polyline:** When a driver starts a trip, the map shows straight Euclidean lines passing directly over terrain/buildings (like flight lines) instead of road-by-road routing geometry following streets and turns.
2. **Intermittent Bus Marker Visibility:** The bus marker appears and disappears inconsistently across driver, conductor, parent, and admin maps.

---

## Root Causes in Code

### 1. Straight "Air Way" Lines
- `mobile/src/features/crew/trip-map-geometry.ts` (`buildPlannedLegsLine`) and `web/src/features/map/MapViewInner.tsx` (`lineCoords` & `sbt-route-line`) construct GeoJSON `LineString` by connecting consecutive stop points directly with straight segments:
  ```ts
  coordinates.push([stop.longitude, stop.latitude]);
  ```
- No road routing engine (such as OSRM / OpenStreetMap routing) is queried to provide intermediate street-level waypoint geometries.
- Turn-by-turn navigation is currently offloaded to external apps (`buildDirectionsUrl` / `google.navigation:q=`), but the in-app map renders straight stop-to-stop lines.

### 2. Intermittent Bus Marker Visibility
- In `web/src/features/map/map-overlays.ts` (`syncBusMarker`) and `mobile/src/features/map/useBusMarkerMotion.ts`:
  When `fix` is null (e.g. during initial GPS acquisition, temporary socket reconnection, or brief signal dropout), the marker is completely unmounted/removed from the map rather than retaining its last-known position in a desaturated/stale state.
- In `mobile/src/features/crew/tracking-lifecycle.ts`:
  If the driver's device screen locks without active background location permission, the OS pauses `watchPositionAsync`, halting GPS transmission and causing observer maps to drop the marker.

---

## Action Plan & Fix Architecture

### A. Road-by-Road Routing Polyline
1. Add an OSRM / OpenStreetMap routing utility (`fetchRoadPolyline([start, ...waypoints, end])`) with graceful fallback to straight-line connection if network fails or offline.
2. In `mobile/src/features/map/LiveMapSurface.tsx` and `web/src/features/map/MapViewInner.tsx`:
   Update the `sbt-route` and `sbt-planned` GeoJSON LineString sources to render the street-level coordinate array.

### B. Persistent Bus Marker Visibility
1. In `map-overlays.ts` and `useBusMarkerMotion.ts`:
   Preserve last-known fix and show the marker in a desaturated visual state with a "Last known position" status rather than calling `marker.remove()`.
2. In `DriverTripMap.tsx`:
   Provide a clear "Acquiring GPS fix..." state before the first fix arrives.
