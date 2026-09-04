"""
HydroGrid Nowcast - 1D Heuristic Flood Simulation Pipeline
Pre-computes node-level stormwater inundation states across a 3-hour rainfall event
in 5-minute intervals (36 time-steps) and exports them to data/simulation_states/.
"""

import json
import logging
from pathlib import Path
import random
from typing import Any, Dict, List, Optional
import networkx as nx
import osmnx as ox

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# Simulation Configuration & Heuristic Constants
DEFAULT_GRAPH_PATH = Path("data") / "base_graph.graphml"
DEFAULT_OUTPUT_DIR = Path("data") / "simulation_states"
TOTAL_TIMESTEPS = 36  # 3 hours at 5-minute intervals: t=0 .. t=35
BASELINE_NODE_CAPACITY = 500.0  # Volume units before node surcharging begins
MIN_RAIN_PER_STEP = 10  # Min volume added per node per step
MAX_RAIN_PER_STEP = 50  # Max volume added per node per step
DEPTH_COEFFICIENT = 0.15  # Conversion: water_depth_cm = (volume - capacity) * 0.15
MAX_DEPTH_CM = 100.0  # Maximum cap for flood depth (1 meter)


def load_base_graph(graph_path: Path | str = DEFAULT_GRAPH_PATH) -> nx.MultiDiGraph:
    """
    Loads the street network graph from GraphML using OSMnx.
    """
    target_path = Path(graph_path)
    if not target_path.exists():
        raise FileNotFoundError(f"Base graph not found at {target_path.resolve()}")

    logger.info(f"Loading base graph from {target_path.resolve()} using osmnx...")
    graph = ox.load_graphml(filepath=target_path)
    logger.info(f"Base graph loaded successfully: {len(graph.nodes)} nodes, {len(graph.edges)} edges")
    return graph


def simulate_flood_event(
    graph: nx.MultiDiGraph,
    timesteps: int = TOTAL_TIMESTEPS,
    capacity: float = BASELINE_NODE_CAPACITY,
    output_dir: Path | str = DEFAULT_OUTPUT_DIR,
    seed: Optional[int] = 42,
) -> List[Path]:
    """
    Simulates a rainfall event using a heuristic 1D mass-balance accumulation model.

    For each timestep:
      1. Adds randomized rainfall volume (10-50 units) to each node's cumulative volume.
      2. Evaluates surcharge condition: volume > capacity (500).
      3. Computes water depth in cm: (volume - capacity) * 0.15, capped at 100.0 cm.
      4. Serializes the snapshot state as state_{t}.json into output_dir.

    Returns:
      List of Path objects for all written JSON files.
    """
    if seed is not None:
        random.seed(seed)

    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"Target directory verified: {target_dir.resolve()}")

    # Extract static node spatial metadata (osmid, lat/y, lon/x)
    node_metadata: Dict[Any, Dict[str, float]] = {}
    for node_id, data in graph.nodes(data=True):
        lat = float(data.get("y", 0.0))
        lon = float(data.get("x", 0.0))
        node_metadata[node_id] = {"lat": lat, "lon": lon}

    # Initialize current water volume per node to 0.0
    current_volumes: Dict[Any, float] = {node_id: 0.0 for node_id in graph.nodes}

    written_files: List[Path] = []

    logger.info(
        f"Beginning simulation: {timesteps} timesteps, {len(graph.nodes)} nodes, "
        f"capacity={capacity}, depth_coeff={DEPTH_COEFFICIENT}, max_depth={MAX_DEPTH_CM}cm"
    )

    for t in range(timesteps):
        nodes_state: List[Dict[str, Any]] = []

        for node_id in graph.nodes:
            # Step 5: Add randomized rainfall volume
            rain = random.randint(MIN_RAIN_PER_STEP, MAX_RAIN_PER_STEP)
            current_volumes[node_id] += rain
            vol = current_volumes[node_id]

            # Step 6: Heuristic surcharge & depth calculation
            if vol > capacity:
                surcharged = True
                depth = (vol - capacity) * DEPTH_COEFFICIENT
                water_depth_cm = round(min(depth, MAX_DEPTH_CM), 2)
            else:
                surcharged = False
                water_depth_cm = 0.0

            nodes_state.append({
                "osmid": int(node_id),
                "lat": node_metadata[node_id]["lat"],
                "lon": node_metadata[node_id]["lon"],
                "water_depth_cm": water_depth_cm,
                "surcharged": surcharged,
            })

        state_payload = {
            "timestamp": t,
            "nodes": nodes_state,
        }

        output_file = target_dir / f"state_{t}.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(state_payload, f, indent=2)

        written_files.append(output_file)

    logger.info(f"Simulation completed. Successfully generated {len(written_files)} state snapshots.")
    return written_files


def run_simulation(
    graph_path: Path | str = DEFAULT_GRAPH_PATH,
    output_dir: Path | str = DEFAULT_OUTPUT_DIR,
    timesteps: int = TOTAL_TIMESTEPS,
    seed: Optional[int] = 42,
) -> List[Path]:
    """
    Orchestration wrapper to load the street graph and run the flood simulation.
    """
    graph = load_base_graph(graph_path=graph_path)
    return simulate_flood_event(
        graph=graph,
        timesteps=timesteps,
        capacity=BASELINE_NODE_CAPACITY,
        output_dir=output_dir,
        seed=seed,
    )


if __name__ == "__main__":
    print("=" * 60)
    print("HydroGrid Nowcast - Heuristic Flood State Generator")
    print("=" * 60)
    files = run_simulation()
    print(f"\n[SUCCESS] Generated {len(files)} flood simulation states in {DEFAULT_OUTPUT_DIR.resolve()}")
