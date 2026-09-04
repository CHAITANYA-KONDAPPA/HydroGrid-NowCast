import { useState, useEffect } from 'react'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers'
import Map from 'react-map-gl/maplibre'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const INITIAL_VIEW_STATE = {
  longitude: 80.2725,
  latitude: 13.0825,
  zoom: 15,
  pitch: 45,
  bearing: 0,
}

export default function App() {
  const [timeStep, setTimeStep] = useState(0)
  const [floodData, setFloodData] = useState([])
  const [isPlaying, setIsPlaying] = useState(false)

  // Interactive Routing & Waypoint States
  const [startPoint, setStartPoint] = useState(null)
  const [endPoint, setEndPoint] = useState(null)
  // routeData stores { normal: [[lon, lat], ...], safe: [[lon, lat], ...] }
  const [routeData, setRouteData] = useState(null)
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false)
  const [routeStatus, setRouteStatus] = useState(null)

  // Hover Tooltip State
  const [hoverInfo, setHoverInfo] = useState(null)

  // Fetch flood state snapshot whenever timeStep changes
  useEffect(() => {
    let isMounted = true

    fetch(`http://127.0.0.1:8000/api/state/${timeStep}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for timestamp ${timeStep}`)
        }
        return res.json()
      })
      .then((data) => {
        if (isMounted) {
          setFloodData(data.nodes || [])
          // Invalidate existing route when storm state changes
          setRouteData(null)
          setRouteStatus(null)
        }
      })
      .catch((err) => {
        console.error('Error fetching flood state:', err)
      })

    return () => {
      isMounted = false
    }
  }, [timeStep])

  // Auto-play timeline progression (T=0 to T=35)
  useEffect(() => {
    if (!isPlaying) return

    const interval = setInterval(() => {
      setTimeStep((prev) => (prev >= 35 ? 0 : prev + 1))
    }, 700)

    return () => clearInterval(interval)
  }, [isPlaying])

  // Map Click Handler: Waypoint Selection
  const handleMapClick = (info) => {
    if (!info || !info.coordinate) return
    const [lon, lat] = info.coordinate

    if (!startPoint) {
      setStartPoint([lon, lat])
      setRouteStatus('Origin placed. Click map to set destination.')
    } else if (!endPoint) {
      setEndPoint([lon, lat])
      setRouteStatus('Waypoints selected. Click "Find Safe Route".')
    } else {
      setStartPoint([lon, lat])
      setEndPoint(null)
      setRouteData(null)
      setRouteStatus('New origin placed. Click map to set destination.')
    }
  }

  // Calculate Both Normal Shortest Path and Flood-Safe Route
  const calculateRoute = () => {
    if (!startPoint || !endPoint) return

    setIsCalculatingRoute(true)
    setRouteStatus('Calculating baseline and flood-safe routes...')

    const url = `http://127.0.0.1:8000/api/route?start_lat=${startPoint[1]}&start_lon=${startPoint[0]}&end_lat=${endPoint[1]}&end_lon=${endPoint[0]}&timestamp=${timeStep}`

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'No navigable path found avoiding surcharged zones at this time-step.'
              : `Routing query returned status ${res.status}`
          )
        }
        return res.json()
      })
      .then((data) => {
        const rawNormal = data.normal_path || []
        const rawSafe = data.safe_path || data.path || []

        // Prepend startPoint and append endPoint to visually bridge to click coordinates
        const normalPathFull = rawNormal.length > 0 ? [startPoint, ...rawNormal, endPoint] : []
        const safePathFull = rawSafe.length > 0 ? [startPoint, ...rawSafe, endPoint] : []

        setRouteData({
          normal: normalPathFull,
          safe: safePathFull,
        })

        if (safePathFull.length > 0) {
          setRouteStatus(
            `Routes resolved: Safe (${safePathFull.length} pts) vs Baseline (${normalPathFull.length} pts)`
          )
        } else if (normalPathFull.length > 0) {
          setRouteStatus('Baseline route available; safe detour currently impassable.')
        } else {
          setRouteStatus('No viable paths between selected waypoints.')
        }

        setIsCalculatingRoute(false)
      })
      .catch((err) => {
        console.error('Routing calculation error:', err)
        setRouteStatus(err.message)
        setIsCalculatingRoute(false)
      })
  }

  const clearWaypoints = () => {
    setStartPoint(null)
    setEndPoint(null)
    setRouteData(null)
    setRouteStatus(null)
  }

  // Deck.gl Layer Configurations
  const selectionPoints = []
  if (startPoint) {
    selectionPoints.push({
      coordinate: startPoint,
      type: 'Origin',
      color: [249, 115, 22, 255], // Contrasting vibrant orange
    })
  }
  if (endPoint) {
    selectionPoints.push({
      coordinate: endPoint,
      type: 'Destination',
      color: [234, 179, 8, 255], // Contrasting golden amber
    })
  }

  const layers = [
    // 1. Flood Nodes Layer
    // Deep blue [0, 75, 135, 200] for surcharged nodes, faint blue [173, 216, 230, 50] for normal
    new ScatterplotLayer({
      id: 'flood-nodes-layer',
      data: floodData,
      pickable: true,
      opacity: 0.9,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 6,
      radiusMaxPixels: 36,
      lineWidthMinPixels: 1.5,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: (d) =>
        d.surcharged ? [0, 75, 135, 200] : [173, 216, 230, 50],
      getLineColor: (d) =>
        d.surcharged ? [0, 50, 100, 240] : [140, 185, 205, 90],
      getRadius: (d) =>
        d.water_depth_cm > 0
          ? Math.max(10, Number(d.water_depth_cm) * 0.95 + 10)
          : 8,
      onHover: (info) => setHoverInfo(info),
      updateTriggers: {
        getFillColor: [timeStep],
        getLineColor: [timeStep],
        getRadius: [timeStep],
      },
    }),

    // 2. Normal Baseline Path Layer (Standard GPS routing into flood)
    new PathLayer({
      id: 'normal-route-layer',
      data: routeData?.normal && routeData.normal.length > 0 ? [{ path: routeData.normal }] : [],
      pickable: true,
      widthScale: 1,
      widthMinPixels: 3,
      jointRounded: true,
      capRounded: true,
      getPath: (d) => d.path,
      getColor: [255, 50, 50, 200], // Bright Red for hazardous baseline
      getWidth: 4,
      updateTriggers: {
        getPath: [routeData?.normal],
      },
    }),

    // 3. Safe Navigation Route Layer (Rendered after normal path so green sits on top)
    new PathLayer({
      id: 'safe-route-layer',
      data: routeData?.safe && routeData.safe.length > 0 ? [{ path: routeData.safe }] : [],
      pickable: true,
      widthScale: 1,
      widthMinPixels: 6,
      jointRounded: true,
      capRounded: true,
      getPath: (d) => d.path,
      getColor: [33, 160, 56, 255], // Thick Emerald Green for flood avoidance
      getWidth: 8,
      updateTriggers: {
        getPath: [routeData?.safe],
      },
    }),

    // 4. Selection Markers (Start / End)
    new ScatterplotLayer({
      id: 'SelectionLayer',
      data: selectionPoints,
      pickable: true,
      opacity: 1,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 9,
      radiusMaxPixels: 22,
      lineWidthMinPixels: 3,
      getPosition: (d) => d.coordinate,
      getFillColor: (d) => d.color,
      getLineColor: [244, 246, 244, 255], // Cream stroke
      getRadius: 18,
      updateTriggers: {
        getPosition: [startPoint, endPoint],
        getFillColor: [startPoint, endPoint],
      },
    }),
  ]

  // Telemetry Aggregations
  const surchargedCount = floodData.filter((d) => d.surcharged).length
  const maxDepth = floodData.length
    ? Math.max(...floodData.map((d) => d.water_depth_cm || 0)).toFixed(1)
    : '0.0'

  const hasRouteData = routeData && (routeData.safe?.length > 0 || routeData.normal?.length > 0)

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#eef2eb',
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      {/* Top Left Header & Telemetry Card */}
      <div
        style={{
          position: 'absolute',
          top: '24px',
          left: '24px',
          zIndex: 10,
          background: '#5C805A',
          color: '#F4F6F4',
          borderRadius: '20px',
          padding: '20px 24px',
          boxShadow: '0 14px 36px rgba(45, 65, 45, 0.22), 0 2px 6px rgba(0,0,0,0.06)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          minWidth: '320px',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: isPlaying ? '#A3E635' : '#F4F6F4',
              boxShadow: isPlaying
                ? '0 0 10px #A3E635'
                : '0 0 8px rgba(244, 246, 244, 0.6)',
            }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 700,
              letterSpacing: '-0.3px',
              color: '#F4F6F4',
            }}
          >
            HydroGrid Nowcast
          </h1>
        </div>
        <p
          style={{
            margin: '4px 0 0 0',
            fontSize: '12px',
            color: '#E2E8E2',
            fontWeight: 400,
          }}
        >
          Urban Flood Drainage Model • Chennai Sector
        </p>

        {/* Telemetry Metrics Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid rgba(244, 246, 244, 0.2)',
          }}
        >
          <div>
            <div style={{ color: '#D1DDD1', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>
              Surcharged
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#F4F6F4' }}>
              {surchargedCount} <span style={{ fontSize: '12px', fontWeight: 400, opacity: 0.8 }}>/ {floodData.length}</span>
            </div>
          </div>
          <div>
            <div style={{ color: '#D1DDD1', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>
              Peak Depth
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#F4F6F4' }}>
              {maxDepth} <span style={{ fontSize: '12px', fontWeight: 400, opacity: 0.8 }}>cm</span>
            </div>
          </div>
          <div>
            <div style={{ color: '#D1DDD1', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>
              Elapsed
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#F4F6F4' }}>
              +{timeStep * 5} <span style={{ fontSize: '12px', fontWeight: 400, opacity: 0.8 }}>min</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Right Route Status Card: Baseline vs Safe Route Comparison */}
      <div
        style={{
          position: 'absolute',
          top: '24px',
          right: '24px',
          zIndex: 10,
          background: '#5C805A',
          color: '#F4F6F4',
          borderRadius: '20px',
          padding: '18px 24px',
          boxShadow: '0 14px 36px rgba(45, 65, 45, 0.22), 0 2px 6px rgba(0,0,0,0.06)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          maxWidth: '360px',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px', color: '#D1DDD1' }}>
            Routing Intelligence
          </div>
          {hasRouteData && (
            <span
              style={{
                background: '#F4F6F4',
                color: '#2E502C',
                padding: '2px 8px',
                borderRadius: '10px',
                fontSize: '11px',
                fontWeight: 700,
              }}
            >
              Comparing Routes
            </span>
          )}
        </div>

        {hasRouteData ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 700 }}>
              <span style={{ fontSize: '18px' }}>🧭</span>
              <span>Baseline vs. Safe Route</span>
            </div>
            <p style={{ margin: '6px 0 10px 0', fontSize: '12px', color: '#E2E8E2', lineHeight: '1.4' }}>
              Standard GPS navigates into surcharged streets. HydroGrid redirects around active inundation.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', background: 'rgba(0, 0, 0, 0.15)', padding: '10px 12px', borderRadius: '12px' }}>
              {/* Safe Route Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '12px', height: '4px', borderRadius: '2px', backgroundColor: 'rgb(33, 160, 56)' }} />
                  <strong>Safe Path (Avoidance):</strong>
                </span>
                <span style={{ color: '#A3E635', fontWeight: 700 }}>
                  {routeData.safe?.length ? `${routeData.safe.length} pts` : 'Impassable'}
                </span>
              </div>

              {/* Baseline Route Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '12px', height: '3px', borderRadius: '2px', backgroundColor: 'rgb(255, 50, 50)' }} />
                  <strong>Standard GPS (Baseline):</strong>
                </span>
                <span style={{ color: '#FFA0A0', fontWeight: 600 }}>
                  {routeData.normal?.length ? `${routeData.normal.length} pts` : 'No Path'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 600 }}>
              <span style={{ fontSize: '16px' }}>📍</span>
              <span>
                {!startPoint ? 'Select Origin on Map' : !endPoint ? 'Select Destination' : 'Ready to Calculate'}
              </span>
            </div>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#E2E8E2', lineHeight: '1.4' }}>
              {!startPoint
                ? 'Click anywhere on the street map to drop your start waypoint.'
                : !endPoint
                  ? 'Click a second location to set your destination point.'
                  : 'Click "Find Safe Route" in the bottom panel to compare baseline vs. flood-safe routing.'}
            </p>
          </div>
        )}
      </div>

      {/* Floating Hover Tooltip */}
      {hoverInfo && hoverInfo.object && (
        <div
          style={{
            position: 'absolute',
            zIndex: 50,
            pointerEvents: 'none',
            left: hoverInfo.x + 14,
            top: hoverInfo.y + 14,
            background: '#F4F6F4',
            color: '#1E2D1F',
            padding: '10px 14px',
            borderRadius: '14px',
            boxShadow: '0 10px 24px rgba(0, 0, 0, 0.18)',
            border: '1.5px solid #5C805A',
            fontSize: '12px',
            lineHeight: '1.4',
            minWidth: '150px',
          }}
        >
          <div style={{ fontWeight: 700, color: '#3A5C38', fontSize: '13px', marginBottom: '2px' }}>
            Node #{hoverInfo.object.osmid}
          </div>
          <div>
            Water Depth: <strong>{Number(hoverInfo.object.water_depth_cm).toFixed(1)} cm</strong>
          </div>
          <div>
            Condition:{' '}
            <strong style={{ color: hoverInfo.object.surcharged ? '#004B87' : '#5C805A' }}>
              {hoverInfo.object.surcharged ? 'Surcharged' : 'Below Capacity'}
            </strong>
          </div>
          <div style={{ color: '#6B7A69', fontSize: '10px', marginTop: '3px' }}>
            {hoverInfo.object.lat.toFixed(4)}, {hoverInfo.object.lon.toFixed(4)}
          </div>
        </div>
      )}

      {/* Main DeckGL + MapLibre Canvas */}
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layers}
        onClick={handleMapClick}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'crosshair')}
      >
        <Map
          mapLib={maplibregl}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
          reuseMaps
        />
      </DeckGL>

      {/* Bottom Floating Legend Card */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '24px',
          zIndex: 15,
          background: '#5C805A',
          color: '#F4F6F4',
          borderRadius: '20px',
          padding: '14px 18px',
          boxShadow: '0 12px 30px rgba(45, 65, 45, 0.22), 0 2px 6px rgba(0,0,0,0.06)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          fontSize: '11px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.4px', color: '#D1DDD1' }}>
          Map Legend
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'rgb(0, 75, 135)' }} />
          <span>Surcharged Junction (&gt; 500 vol)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'rgb(173, 216, 230)', border: '1px solid #004B87' }} />
          <span>Normal Junction (Sub-capacity)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '16px', height: '5px', borderRadius: '2px', backgroundColor: 'rgb(33, 160, 56)' }} />
          <span>Safe Route (Avoidance, Green)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '16px', height: '3px', borderRadius: '2px', backgroundColor: 'rgb(255, 50, 50)' }} />
          <span>Standard GPS Route (Flooded, Red)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'rgb(249, 115, 22)' }} />
          <span>Start Point</span>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'rgb(234, 179, 8)', marginLeft: '6px' }} />
          <span>Destination</span>
        </div>
        <div style={{ color: '#D1DDD1', fontSize: '10px', fontStyle: 'italic', marginTop: '2px' }}>
          * Node radius scales with flood depth (cm)
        </div>
      </div>

      {/* Bottom Timeline & Routing Controls Panel */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          background: '#5C805A',
          color: '#F4F6F4',
          borderRadius: '20px',
          padding: '16px 24px',
          boxShadow: '0 18px 40px rgba(45, 65, 45, 0.28), 0 3px 8px rgba(0,0,0,0.08)',
          border: '1px solid rgba(255, 255, 255, 0.22)',
          width: 'min(90vw, 640px)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          pointerEvents: 'auto',
        }}
      >
        {/* Row 1: Timeline scrubbing & Playback */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                background: isPlaying ? '#D9534F' : '#F4F6F4',
                color: isPlaying ? '#FFFFFF' : '#3A5C38',
                border: 'none',
                borderRadius: '12px',
                padding: '6px 14px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>
              Time Step: {timeStep} <span style={{ color: '#E2E8E2', fontWeight: 400 }}>(T+{timeStep * 5} min)</span>
            </span>
          </div>

          <div style={{ fontSize: '12px', color: '#E2E8E2', fontWeight: 500 }}>
            3-Hour Storm Simulation
          </div>
        </div>

        {/* Row 2: Range Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: '#D1DDD1', fontWeight: 500 }}>T=0</span>
          <input
            type="range"
            min="0"
            max="35"
            value={timeStep}
            onChange={(e) => setTimeStep(Number(e.target.value))}
            style={{
              flex: 1,
              height: '8px',
              borderRadius: '4px',
              background: `linear-gradient(to right, #F4F6F4 ${(timeStep / 35) * 100}%, rgba(244, 246, 244, 0.3) ${(timeStep / 35) * 100}%)`,
              outline: 'none',
              cursor: 'pointer',
              accentColor: '#F4F6F4',
            }}
          />
          <span style={{ fontSize: '11px', color: '#D1DDD1', fontWeight: 500 }}>T=35</span>
        </div>

        {/* Row 3: Waypoint Telemetry & Action Buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '10px',
            borderTop: '1px solid rgba(244, 246, 244, 0.2)',
            gap: '12px',
            fontSize: '12px',
          }}
        >
          {/* Waypoints Status Indicator */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ color: startPoint ? '#F4F6F4' : '#D1DDD1', fontWeight: 600 }}>
                ● Start: {startPoint ? `${startPoint[1].toFixed(4)}, ${startPoint[0].toFixed(4)}` : 'Click Map'}
              </span>
              <span style={{ color: 'rgba(244, 246, 244, 0.5)' }}>➔</span>
              <span style={{ color: endPoint ? '#F4F6F4' : '#D1DDD1', fontWeight: 600 }}>
                ● End: {endPoint ? `${endPoint[1].toFixed(4)}, ${endPoint[0].toFixed(4)}` : 'Click Map'}
              </span>
            </div>
            {routeStatus && (
              <span style={{ fontSize: '11px', color: hasRouteData ? '#A3E635' : '#E2E8E2', fontStyle: 'italic' }}>
                {routeStatus}
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {(startPoint || endPoint) && (
              <button
                onClick={clearWaypoints}
                style={{
                  background: 'transparent',
                  color: '#F4F6F4',
                  border: '1px solid rgba(244, 246, 244, 0.4)',
                  borderRadius: '12px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Clear
              </button>
            )}

            <button
              onClick={calculateRoute}
              disabled={!startPoint || !endPoint || isCalculatingRoute}
              style={{
                background: !startPoint || !endPoint ? 'rgba(244, 246, 244, 0.3)' : '#F4F6F4',
                color: !startPoint || !endPoint ? 'rgba(60, 80, 60, 0.6)' : '#3A5C38',
                border: 'none',
                borderRadius: '12px',
                padding: '8px 18px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: !startPoint || !endPoint ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: startPoint && endPoint ? '0 4px 14px rgba(0,0,0,0.15)' : 'none',
              }}
            >
              {isCalculatingRoute ? 'Calculating...' : 'Compare Routes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
