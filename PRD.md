# Product Requirements Document (PRD)

## Project
**HydroGrid Nowcast**: Urban Flood Nowcasting System

## Objective
HydroGrid Nowcast is an urban flood nowcasting system designed to simulate localized street-level stormwater runoff and drainage dynamics in real-time. The system couples street network topologies with heuristic 1D mass-balance hydraulic simulations to predict inundation risks before and during intense rainfall events.

## Target Geography
- **Primary Pilot Area**: Chennai, India
- **Initial Test Sector**: 500m x 500m bounding box (North: 13.085, South: 13.080, East: 80.275, West: 80.270)

## Core Capabilities
1. **1D Drainage Topology Extraction**:
   - Drivable street network extracted via OSMnx representing above-ground flow paths and proxy underground culverts/drains.
   - Offline GraphML persistence to enable zero-latency cold starts.
   - Assigned pipe/culvert drainage capacity per edge (nominal default: 100 units).
2. **Hydraulic Simulation Engine (Upcoming)**:
   - Heuristic 1D mass-balance simulation modeling rainfall hyetographs, surface runoff infiltration, pipe transport, and localized ponding at street intersections (nodes).
3. **API Backend**:
   - FastAPI server delivering health checks, simulation triggers, runoff telemetry, and GeoJSON overlays to the frontend.
4. **Interactive Dashboard**:
   - Vite + React frontend powered by Deck.gl and MapLibre for visualizing flood depths, velocity vectors, and edge surcharge states.

## Constraints & Standards
- Python 3.10+ compatibility.
- Offline graph caching in `data/base_graph.graphml`.
- Strictly adhere to specified coordinates and network types (`drive`).
- Clean separation of concerns between graph generation, simulation backend, and visualization UI.
