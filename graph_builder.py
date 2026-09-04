"""
HydroGrid Nowcast - Street Network Graph Builder
Extracts a drivable street network graph for a 500m x 500m sector in Chennai,
enriches edges with hydraulic pipe capacity attributes, and serializes to GraphML.
"""

import inspect
import logging
from pathlib import Path
import networkx as nx
import osmnx as ox

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# Chennai 500m x 500m Bounding Box Coordinates
NORTH = 13.085
SOUTH = 13.080
EAST = 80.275
WEST = 80.270
NETWORK_TYPE = "drive"
DEFAULT_CAPACITY = 100
DEFAULT_OUTPUT_PATH = Path("data") / "base_graph.graphml"


def download_street_graph(
    north: float = NORTH,
    south: float = SOUTH,
    east: float = EAST,
    west: float = WEST,
    network_type: str = NETWORK_TYPE,
) -> nx.MultiDiGraph:
    """
    Downloads a drivable street network graph within the specified bounding box.
    Handles both OSMnx 2.x (bbox tuple) and OSMnx 1.x (separate arguments) APIs.
    """
    logger.info(
        f"Downloading street network for bounding box: "
        f"N={north}, S={south}, E={east}, W={west} with network_type='{network_type}'"
    )

    sig = inspect.signature(ox.graph_from_bbox)
    if "bbox" in sig.parameters:
        # OSMnx 2.x expects bbox=(left, bottom, right, top) -> (west, south, east, north)
        graph = ox.graph_from_bbox(
            bbox=(west, south, east, north),
            network_type=network_type
        )
    else:
        # OSMnx 1.x expects north, south, east, west
        graph = ox.graph_from_bbox(
            north=north,
            south=south,
            east=east,
            west=west,
            network_type=network_type
        )

    logger.info(
        f"Graph successfully downloaded: {len(graph.nodes)} nodes, {len(graph.edges)} edges"
    )
    return graph


def assign_hydraulic_attributes(
    graph: nx.MultiDiGraph,
    capacity: int = DEFAULT_CAPACITY
) -> nx.MultiDiGraph:
    """
    Assigns underground pipe drainage capacity attribute to all edges in the graph
    by iterating through the edges.
    """
    logger.info(f"Setting default edge capacity attribute = {capacity} across all edges")
    for u, v, k, data in graph.edges(keys=True, data=True):
        data["capacity"] = int(capacity)
    return graph


def save_graph_to_graphml(
    graph: nx.MultiDiGraph,
    output_path: Path | str = DEFAULT_OUTPUT_PATH
) -> Path:
    """
    Saves the graph to GraphML format at the specified path.
    """
    target_path = Path(output_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Saving graph to GraphML at: {target_path.resolve()}")
    ox.save_graphml(graph, filepath=target_path)
    logger.info(f"Successfully saved {target_path.name} ({target_path.stat().st_size} bytes)")
    return target_path


def build_and_save_graph(output_path: Path | str = DEFAULT_OUTPUT_PATH) -> Path:
    """
    Main orchestration function to download, enrich, and save the base street graph.
    """
    graph = download_street_graph()
    graph = assign_hydraulic_attributes(graph)
    saved_path = save_graph_to_graphml(graph, output_path=output_path)
    return saved_path


if __name__ == "__main__":
    print("=" * 60)
    print("HydroGrid Nowcast - Building Base Graph for Chennai")
    print("=" * 60)
    result_path = build_and_save_graph()
    print(f"\n[SUCCESS] Street network graph generated and saved to: {result_path}")
