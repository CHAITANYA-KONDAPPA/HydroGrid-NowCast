# Architecture Specification

## HydroGrid Nowcast System Architecture

```
                 +---------------------------------------+
                 |       OpenStreetMap / Overpass        |
                 +-------------------+-------------------+
                                     |
                                     | (osmnx download, offline)
                                     v
                 +-------------------+-------------------+
                 |           graph_builder.py            |
                 |  - Bounding box extraction            |
                 |  - Set edge capacity (100)            |
                 +-------------------+-------------------+
                                     |
                                     v
                 +-------------------+-------------------+
                 |        data/base_graph.graphml        |
                 |  - Localized 1D NetworkX graph        |
                 +-------------------+-------------------+
                                     |
                                     v
+------------------------+  REST/JSON  +-----------------------------------+
|  React + Deck.gl UI   | <---------> |        FastAPI Backend (main.py)  |
|  (Vite port 5173)     |             |  - Health endpoints (/ping)       |
|                       |             |  - Simulation runner (future)     |
+------------------------+             +-----------------------------------+
```

## Component Architecture

### 1. Data Pipeline (`graph_builder.py` -> `data/base_graph.graphml`)
- **Source**: OpenStreetMap via Overpass API queried through `osmnx`.
- **Bounding Box**: Chennai urban sector:
  - North: `13.085`, South: `13.080`, East: `80.275`, West: `80.270`
  - In OSMnx 2.x parameter format: `bbox=(80.270, 13.080, 80.275, 13.085)` (left, bottom, right, top).
- **Topology**: Directed multi-graph (`nx.MultiDiGraph`), filtered by `network_type='drive'`.
- **Hydraulic Edge Attributes**:
  - `capacity`: Integer (default: `100`), modeling stormwater conveying capacity.
- **Persistence**: Saved via `osmnx.save_graphml` into `data/base_graph.graphml`.

### 2. Hydraulic Simulation Engine (`simulate_flood.py` -> `data/simulation_states/`)
- **Execution**: Discrete time-step simulation over a 3-hour rainfall storm (36 time-steps, T=0 to T=35 at 5-minute intervals).
- **Heuristic Mass-Balance**:
  - Baseline node capacity: `500` volume units.
  - Stochastic rainfall influx: randomized `10 - 50` volume units accumulated per node per step.
  - Surcharge trigger: `volume > 500`.
  - Inundation depth: `water_depth_cm = min(100.0, (volume - 500) * 0.15)`.
- **Snapshots**: Serialized as `state_0.json` .. `state_35.json` for O(1) retrieval during frontend playback.

### 3. Application Backend (`main.py`)
- **Framework**: FastAPI (Starlette ASGI).
- **Middleware**: CORS middleware enabling requests from `localhost:5173` (Vite dev server) and wildcard origins during development.
- **Endpoints**:
  - `GET /`: Service metadata and operational status.
  - `GET /ping`: Health-check endpoint.
  - `GET /api/state/{timestamp}`: Retrieves pre-computed hydrodynamic snapshot for time-step `timestamp` (0-35).
  - `GET /api/route`: Dynamic flood-safe shortest path route between `start_lat, start_lon` and `end_lat, end_lon` at `timestamp`.
- **Future Endpoints**:
  - `POST /simulate`: Trigger live custom rainfall-runoff hydraulic simulations.
  - `GET /graph/geojson`: Export nodes and edges with calculated flood metrics.

### 4. Frontend (`hydrogrid-ui`)
- Vite React SPA with Deck.gl and MapLibre GL for spatial map rendering and dynamic inundation heatmaps.

