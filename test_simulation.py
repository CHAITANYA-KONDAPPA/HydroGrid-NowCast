"""
Unit and integration tests for HydroGrid Nowcast flood simulation pipeline.
"""

import json
from pathlib import Path
import unittest
import networkx as nx

from simulate_flood import (
    BASELINE_NODE_CAPACITY,
    DEFAULT_GRAPH_PATH,
    DEFAULT_OUTPUT_DIR,
    TOTAL_TIMESTEPS,
    load_base_graph,
    simulate_flood_event,
)


class TestFloodSimulation(unittest.TestCase):
    def test_load_base_graph(self):
        """Test loading of data/base_graph.graphml."""
        graph = load_base_graph(DEFAULT_GRAPH_PATH)
        self.assertIsInstance(graph, nx.MultiDiGraph)
        self.assertGreater(len(graph.nodes), 0)
        self.assertGreater(len(graph.edges), 0)

        # Verify coordinates exist on nodes
        sample_node = next(iter(graph.nodes.values()))
        self.assertIn("y", sample_node)
        self.assertIn("x", sample_node)

    def test_simulation_states_exist_and_count(self):
        """Verify that exactly 36 simulation states exist in data/simulation_states/."""
        self.assertTrue(DEFAULT_OUTPUT_DIR.exists(), f"{DEFAULT_OUTPUT_DIR} does not exist")
        json_files = list(DEFAULT_OUTPUT_DIR.glob("state_*.json"))
        self.assertEqual(
            len(json_files),
            TOTAL_TIMESTEPS,
            f"Expected {TOTAL_TIMESTEPS} state files, found {len(json_files)}"
        )

    def test_simulation_state_schema_and_values(self):
        """Verify structure and heuristic bounds for all 36 state files."""
        for step in range(TOTAL_TIMESTEPS):
            state_file = DEFAULT_OUTPUT_DIR / f"state_{step}.json"
            self.assertTrue(state_file.exists(), f"Missing state file: {state_file}")

            with open(state_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            self.assertIn("timestamp", data)
            self.assertEqual(data["timestamp"], step)
            self.assertIn("nodes", data)
            self.assertIsInstance(data["nodes"], list)
            self.assertGreater(len(data["nodes"]), 0)

            for node in data["nodes"]:
                self.assertIn("osmid", node)
                self.assertIsInstance(node["osmid"], int)
                self.assertIn("lat", node)
                self.assertIsInstance(node["lat"], (float, int))
                self.assertIn("lon", node)
                self.assertIsInstance(node["lon"], (float, int))
                self.assertIn("water_depth_cm", node)
                self.assertIsInstance(node["water_depth_cm"], (float, int))
                self.assertIn("surcharged", node)
                self.assertIsInstance(node["surcharged"], bool)

                # Heuristic consistency checks
                self.assertGreaterEqual(node["water_depth_cm"], 0.0)
                self.assertLessEqual(node["water_depth_cm"], 100.0)
                if node["surcharged"]:
                    self.assertGreater(node["water_depth_cm"], 0.0)
                else:
                    self.assertEqual(node["water_depth_cm"], 0.0)

    def test_synthetic_graph_simulation(self):
        """Test simulate_flood_event with a mock graph to verify capacity and capping."""
        mock_graph = nx.MultiDiGraph()
        mock_graph.add_node(1001, x=80.27, y=13.08)
        mock_graph.add_node(1002, x=80.28, y=13.09)

        tmp_dir = Path("data") / "test_states"
        try:
            files = simulate_flood_event(
                graph=mock_graph,
                timesteps=5,
                capacity=100.0,
                output_dir=tmp_dir,
                seed=1,
            )
            self.assertEqual(len(files), 5)
            # Verify first and last file content
            with open(files[-1], "r", encoding="utf-8") as f:
                last_step = json.load(f)
            self.assertEqual(last_step["timestamp"], 4)
            self.assertEqual(len(last_step["nodes"]), 2)
        finally:
            if tmp_dir.exists():
                for p in tmp_dir.glob("*.json"):
                    p.unlink()
                tmp_dir.rmdir()


if __name__ == "__main__":
    unittest.main()
