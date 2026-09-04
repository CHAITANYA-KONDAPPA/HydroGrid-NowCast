# HydroGrid Nowcast 🌊
**SIH 2026 - Problem Statement ID26085 (Urban Flood Nowcasting System)**

HydroGrid Nowcast is a high-speed, API-first Coupled 1D-2D Heuristic Routing Engine. Traditional Numerical Weather Prediction (NWP) and hydrodynamic models (like EPA SWMM) take hours to run on supercomputers. HydroGrid solves the 0–3 hour nowcasting challenge by abstracting city infrastructure into a mathematical Directed Graph, allowing it to predict street-level inundation and route emergency vehicles around flooded nodes in milliseconds.

---

## 🏗️ Core Architecture

*   **1D Subsystem (Underground):** Street networks and underground drainage are modeled as a Directed Graph using `OSMnx` and `NetworkX`. 
*   **Mass-Balance Physics:** Rainfall is simulated over a 3-hour window in 5-minute time-steps. When a graph node's water volume exceeds its hydraulic capacity, it "surcharges".
*   **Dynamic Safe Routing:** A modified A* algorithm dynamically penalizes street edges connected to surcharged nodes, generating flood-safe paths.
*   **WebGIS Dashboard:** A React + Deck.gl frontend polls the FastAPI backend to visualize water depth and safe routes on a hyper-local 500m x 500m city block.

---

## 🚀 Tech Stack

*   **Backend Engine:** Python 3.10, FastAPI, NetworkX, OSMnx, NumPy
*   **Frontend Dashboard:** React, Vite, Deck.gl, MapLibre
*   **Environment Manager:** Conda (for strict C-library spatial dependencies)

---

## ⚙️ Installation & Setup

You must use Conda for the backend to ensure C++ spatial binaries (Shapely, GEOS) compile correctly on Windows.

### 1. Backend Setup
Open a terminal in the root project directory and run:

```bash
# Create the environment with all spatial dependencies
conda create -n hydrogrid -c conda-forge python=3.10 osmnx geopandas networkx numpy pandas shapely -y

# Activate the environment
conda activate hydrogrid

# Install the API server
pip install fastapi uvicorn