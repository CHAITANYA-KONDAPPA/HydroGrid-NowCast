# Architecture Decision Records (ADR)

## ADR-001: Offline GraphML Storage for Street Drainage Topology
- **Status**: Accepted
- **Context**: Dynamic queries to the Overpass API during server boot or simulation cycles introduce latency (several seconds), potential rate-limiting, and network vulnerability.
- **Decision**: Pre-download and serialize the 500m x 500m Chennai street network into `data/base_graph.graphml` using `osmnx.save_graphml`. The FastAPI backend loads this local file instantly on startup.
- **Consequences**: Fast boot time, deterministic reproducibility, offline simulation capability.

## ADR-002: Upgrade OSMnx to 2.1.1 for Shapely 2.x Compatibility
- **Status**: Accepted
- **Context**: The existing base environment had `osmnx 1.0.1` installed alongside `shapely 2.1.2`. OSMnx 1.0.1 failed to import with `ImportError: cannot import name 'TopologicalError' from 'shapely.geos'` due to breaking changes in Shapely 2.0.
- **Decision**: Upgraded `osmnx` to `2.1.1` which natively supports Shapely 2.x and Geopandas 1.1+.
- **Consequences**: Graph bounding box calls use the standard 4-tuple format `bbox=(left, bottom, right, top)`.

## ADR-003: Default Edge Hydraulic Capacity Modeling
- **Status**: Accepted
- **Context**: The 1D hydraulic routing engine requires initial edge capacity representing subterranean drainage pipe or culvert throughput.
- **Decision**: Set a uniform default integer attribute `capacity = 100` on every edge in the graph.
- **Consequences**: Consistent baseline for mass-balance flood calculations without missing attribute exceptions.

## ADR-004: Precomputed Heuristic Hydraulic States for Low-Latency Nowcasting
- **Status**: Accepted
- **Context**: Computing live hydraulic routing and 1D mass-balance traversals on every API request is too latency-intensive for real-time frontend playback and hackathon responsiveness.
- **Decision**: Pre-compute 3-hour storm states at 5-minute intervals (36 time-steps, T=0 to T=35) with `simulate_flood.py`, serializing each time-step state into `data/simulation_states/state_X.json`.
- **Consequences**: Millisecond API response times via direct JSON reads, deterministic temporal playback in the UI, and offline demonstrability.

## ADR-005: Dynamic Surcharge Penalty Routing for Flood-Safe Navigation
- **Status**: Accepted
- **Context**: Standard Dijkstra/A* routing routes through the shortest physical distance regardless of standing water or manhole surcharge, potentially navigating vehicles into hazardous inundation zones.
- **Decision**: Implemented `GET /api/route` in `main.py` using dynamic edge cost assignment. Baseline edge weight equals edge `length`. If either adjacent junction node ($u$ or $v$) is flagged as `surcharged` at the given simulation timestamp, a severe weight penalty (`+100,000.0`) is added. Safe pathfinding is resolved via `nx.shortest_path(G, source, target, weight='safe_weight')`.
- **Consequences**: Deterministic detour routing around active flood nodes, sub-millisecond route calculation on the pre-loaded in-memory graph, and graceful 404 responses on non-existent timestamps or disconnected components.

## ADR-006: Reactive Deck.gl + MapLibre Urban Flood Visualization Architecture
- **Status**: Accepted
- **Context**: Hackathon stakeholders and emergency response operators need intuitive, real-time spatial visualization of localized stormwater inundation over the 3-hour storm progression.
- **Decision**: Built a WebGIS frontend in `hydrogrid-ui/src/App.jsx` coupling `@deck.gl/react` (`ScatterplotLayer`), `react-map-gl/maplibre`, and `maplibre-gl` with Carto Dark Matter base styling. The dashboard exposes a synchronized timeline slider ($T \in [0, 35]$) querying `http://127.0.0.1:8000/api/state/${timeStep}`, dynamically updating node radii by water depth and node colors by surcharge status (red for surcharged, blue for normal).
- **Consequences**: Smooth 60 FPS WebGL rendering, sub-millisecond state updates, interactive inspection tooltips, and zero overhead on backend compute.

## ADR-007: Interactive Map Waypoint Picking and Dynamic Path Layer Routing
- **Status**: Accepted
- **Context**: Users and emergency dispatchers need an intuitive way to pick origin and destination points directly on the GIS map interface to evaluate flood-safe evacuation corridors.
- **Decision**: Added an `onClick` picking handler to `<DeckGL>` in `hydrogrid-ui/src/App.jsx` that captures `[lon, lat]` coordinates. Managed 3-stage waypoint selection (`startPoint`, `endPoint`, reset). Added a multi-layer Deck.gl stack combining:
  1. `flood-nodes-layer` (`ScatterplotLayer` for stormwater node inundation)
  2. `route-layer` (`PathLayer` rendering green flood-safe route geometry)
  3. `SelectionLayer` (`ScatterplotLayer` rendering Green Start and Yellow End pin markers)
  Integrated with `GET /api/route` with automatic route invalidation on storm time-step change.
- **Consequences**: Direct click-to-route user experience, sub-second route retrieval, and visual verification of flood avoidance.

## ADR-008: Google Flood Hub Inspired Light-Mode Aesthetic & Interactive Hover Telemetry
- **Status**: Accepted
- **Context**: The generic dark-mode interface lacked professional cartographic legibility and institutional trust required for civic disaster intelligence.
- **Decision**: Overhauled the design system into a Google Flood Hub-inspired aesthetic:
  - Typography: Switched to `Poppins, sans-serif`.
  - Color Palette: Sage Green (`#5C805A`) with 20px border radius for elevated floating panels, Cream (`#F4F6F4`) for high-contrast legible typography.
  - Basemap: Switched to Carto Positron light style (`positron-gl-style`).
  - Symbology: Deep blue (`[0, 75, 135, 200]`) for surcharged nodes, faint light blue (`[173, 216, 230, 50]`) for normal network nodes, bold dark green (`[33, 160, 56]`, width 8) for safe evacuation corridors, and contrasting orange/amber for waypoints.
  - Interactivity: Added hover tracking (`onHover`) with floating depth cards, a dedicated Route Secured status card, and a map legend panel.
- **Consequences**: High-contrast readability, professional civic design feel, zero degradation in rendering performance.

## ADR-009: Frontend Waypoint Coordinate Prepending and Appending to Evacuation Path
- **Status**: Accepted
- **Context**: The backend routes along graph nodes resolved via nearest-neighbor distance (`ox.distance.nearest_nodes`), creating an apparent visual gap between the user's clicked start/destination markers and the street graph endpoints.
- **Decision**: In `calculateRoute()` within `hydrogrid-ui/src/App.jsx`, intercepted the API's `data.path` array and synthesized a continuous path: `const fullPath = rawPath.length > 0 ? [startPoint, ...rawPath, endPoint] : []`.
- **Consequences**: Continuous green evacuation line connecting directly to the user's Orange Origin and Amber Destination markers without requiring backend graph modifications.

## ADR-010: Baseline vs. Safe Dual-Route Comparative Analysis
- **Status**: Accepted
- **Context**: To demonstrate the tangible lifesaving value of hydrodynamic nowcasting, users and judges must visually compare what a standard flood-agnostic GPS router selects versus what HydroGrid calculates.
- **Decision**: Extended `/api/route` in `main.py` to calculate and return both `normal_path` (Dijkstra weighted by physical distance `length`) and `safe_path` (Dijkstra weighted by `safe_weight`). In `hydrogrid-ui/src/App.jsx`, created dual `PathLayer` components: a thinner bright red path (`[255, 50, 50]`, width 4) for the hazardous standard route, and a thick emerald green path (`[33, 160, 56]`, width 8) on top for the safe diversion corridor.
- **Consequences**: Immediate visual contrast showing standard navigation plunging into surcharged junctions while HydroGrid safely detours around active inundation zones.







