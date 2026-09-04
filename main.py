"""
HydroGrid Nowcast - FastAPI Backend Server
Provides REST APIs for urban flood nowcasting, spatial simulation telemetry,
and flood-aware dynamic route navigation.
"""

import json
import logging
from pathlib import Path
import threading
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
import networkx as nx
import osmnx as ox

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# File Paths
GRAPH_PATH = Path("data") / "base_graph.graphml"
SIMULATION_STATES_DIR = Path("data") / "simulation_states"

# Routing Penalty Constants
SURCHARGE_PENALTY = 100000.0

app = FastAPI(
    title="HydroGrid Nowcast API",
    description="Urban Flood Nowcasting System Backend with 1D Hydraulic Simulation",
    version="0.1.0",
)

# Enable CORS for frontend integration (e.g. Vite React on port 5173, Deck.gl)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup: Load the base street graph into memory
if not GRAPH_PATH.exists():
    logger.warning(f"Graph file not found at {GRAPH_PATH.resolve()}. Initializing empty graph.")
    G: nx.MultiDiGraph = nx.MultiDiGraph()
else:
    logger.info(f"Loading street network from {GRAPH_PATH.resolve()} into memory...")
    G: nx.MultiDiGraph = ox.load_graphml(filepath=GRAPH_PATH)
    logger.info(f"Graph loaded successfully with {len(G.nodes)} nodes and {len(G.edges)} edges.")

# Lock to ensure thread-safe edge weight manipulation across concurrent route requests
_route_lock = threading.Lock()


@app.get("/")
def read_root():
    """Root endpoint returning basic service metadata."""
    return {
        "service": "HydroGrid Nowcast API",
        "version": "0.1.0",
        "status": "online"
    }


@app.get("/ping")
def ping():
    """Health-check endpoint for service availability."""
    return {"status": "ok"}


@app.get("/api/state/{timestamp}")
def get_simulation_state(timestamp: int):
    """
    Retrieves the pre-computed hydrodynamic flood state for a specified time-step (0-35).
    """
    state_file = SIMULATION_STATES_DIR / f"state_{timestamp}.json"
    if not state_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Simulation state for timestamp {timestamp} not found."
        )

    try:
        with open(state_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        logger.error(f"Error reading {state_file}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load simulation state for timestamp {timestamp}."
        )


@app.get("/api/route")
def get_safe_route(
    start_lat: float = Query(..., description="Starting latitude"),
    start_lon: float = Query(..., description="Starting longitude"),
    end_lat: float = Query(..., description="Destination latitude"),
    end_lon: float = Query(..., description="Destination longitude"),
    timestamp: int = Query(..., description="Simulation time-step (0-35)"),
):
    """
    Calculates a flood-safe shortest path between start and end coordinates,
    imposing a heavy weight penalty on edges connected to surcharged street nodes.
    """
    if len(G.nodes) == 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Street network graph is not available."
        )

    # 1. Load the corresponding simulation state
    state_file = SIMULATION_STATES_DIR / f"state_{timestamp}.json"
    if not state_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Simulation state for timestamp {timestamp} not found."
        )

    try:
        with open(state_file, "r", encoding="utf-8") as f:
            state_data = json.load(f)
    except Exception as e:
        logger.error(f"Error reading state file {state_file}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read state data for timestamp {timestamp}."
        )

    # Extract surcharged node IDs
    surcharged_nodes = set()
    for node in state_data.get("nodes", []):
        if node.get("surcharged") == True:
            surcharged_nodes.add(node["osmid"])

    # Resolve nearest nodes to coordinates (Note: X is longitude, Y is latitude)
    try:
        source_node = ox.distance.nearest_nodes(G, start_lon, start_lat)
        target_node = ox.distance.nearest_nodes(G, end_lon, end_lat)
    except Exception as e:
        logger.error(f"Nearest node resolution failed: {e}")
        return {"normal_path": [], "safe_path": []}

    with _route_lock:
        # Apply penalty weight dynamically
        for u, v, key, data in G.edges(keys=True, data=True):
            base_length = data.get("length", 1.0)
            if u in surcharged_nodes or v in surcharged_nodes:
                data["safe_weight"] = base_length + 100000.0
            else:
                data["safe_weight"] = base_length

        # Calculate both paths
        try:
            normal_path_nodes = nx.shortest_path(G, source_node, target_node, weight="length")
        except Exception:
            normal_path_nodes = []

        try:
            safe_path_nodes = nx.shortest_path(G, source_node, target_node, weight="safe_weight")
        except Exception:
            safe_path_nodes = []

        # Return coordinates
        normal_coords = [[G.nodes[n]['x'], G.nodes[n]['y']] for n in normal_path_nodes]
        safe_coords = [[G.nodes[n]['x'], G.nodes[n]['y']] for n in safe_path_nodes]

    return {"normal_path": normal_coords, "safe_path": safe_coords, "path": safe_coords}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
