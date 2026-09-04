"""
Unit and integration tests for HydroGrid Nowcast backend and base graph.
Supports execution via python -m unittest test_backend.py or pytest.
"""

from pathlib import Path
import unittest
from starlette.testclient import TestClient
import osmnx as ox
import networkx as nx

from main import app
from graph_builder import (
    DEFAULT_CAPACITY,
    assign_hydraulic_attributes,
)


class TestHydroGridBackend(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_ping_endpoint(self):
        """Test the /ping health-check endpoint."""
        response = self.client.get("/ping")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data, {"status": "ok"})

    def test_root_endpoint(self):
        """Test the root endpoint."""
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "online")

    def test_graphml_file_exists(self):
        """Verify that data/base_graph.graphml exists and is non-empty."""
        path = Path("data") / "base_graph.graphml"
        self.assertTrue(path.exists(), f"GraphML file not found at {path}")
        self.assertGreater(path.stat().st_size, 0, "GraphML file is empty")

    def test_graphml_content_and_capacities(self):
        """
        Verify that data/base_graph.graphml can be loaded, has nodes and edges,
        and every edge has the 'capacity' attribute assigned.
        """
        path = Path("data") / "base_graph.graphml"
        graph = ox.load_graphml(path)

        self.assertGreater(len(graph.nodes), 0, "Graph contains no nodes")
        self.assertGreater(len(graph.edges), 0, "Graph contains no edges")

        # Verify every edge has capacity attribute set to 100
        missing_capacity = []
        invalid_capacity = []

        for u, v, k, data in graph.edges(keys=True, data=True):
            if "capacity" not in data:
                missing_capacity.append((u, v, k))
            else:
                val = int(data["capacity"])
                if val != DEFAULT_CAPACITY:
                    invalid_capacity.append((u, v, k, val))

        self.assertEqual(
            len(missing_capacity),
            0,
            f"Edges missing capacity attribute: {len(missing_capacity)}"
        )
        self.assertEqual(
            len(invalid_capacity),
            0,
            f"Edges with unexpected capacity value: {invalid_capacity}"
        )

    def test_assign_hydraulic_attributes_helper(self):
        """Unit test for assign_hydraulic_attributes function."""
        g = nx.MultiDiGraph()
        g.add_edge(1, 2, key=0)
        g.add_edge(2, 3, key=0)

        enriched = assign_hydraulic_attributes(g, capacity=250)
        for _, _, _, d in enriched.edges(keys=True, data=True):
            self.assertEqual(d.get("capacity"), 250)

    def test_get_simulation_state_valid(self):
        """Test GET /api/state/{timestamp} with valid timestamp."""
        response = self.client.get("/api/state/0")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("timestamp", data)
        self.assertEqual(data["timestamp"], 0)
        self.assertIn("nodes", data)
        self.assertIsInstance(data["nodes"], list)
        self.assertGreater(len(data["nodes"]), 0)

    def test_get_simulation_state_not_found(self):
        """Test GET /api/state/{timestamp} with non-existent timestamp returns 404."""
        response = self.client.get("/api/state/999")
        self.assertEqual(response.status_code, 404)

    def test_get_safe_route_valid(self):
        """Test GET /api/route returns valid normal_path and safe_path coordinate pairs."""
        params = {
            "start_lat": 13.084,
            "start_lon": 80.270,
            "end_lat": 13.081,
            "end_lon": 80.274,
            "timestamp": 0,
        }
        response = self.client.get("/api/route", params=params)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("normal_path", data)
        self.assertIn("safe_path", data)
        self.assertIn("path", data)
        self.assertIsInstance(data["normal_path"], list)
        self.assertIsInstance(data["safe_path"], list)
        self.assertGreater(len(data["normal_path"]), 0)
        self.assertGreater(len(data["safe_path"]), 0)
        for pt in data["safe_path"]:
            self.assertEqual(len(pt), 2)
            lon, lat = pt
            self.assertTrue(80.26 <= lon <= 80.28)
            self.assertTrue(13.07 <= lat <= 13.09)

    def test_get_safe_route_invalid_timestamp(self):
        """Test GET /api/route with non-existent timestamp returns 404."""
        params = {
            "start_lat": 13.084,
            "start_lon": 80.270,
            "end_lat": 13.081,
            "end_lon": 80.274,
            "timestamp": 999,
        }
        response = self.client.get("/api/route", params=params)
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()

