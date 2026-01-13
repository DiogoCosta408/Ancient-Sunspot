# Ancient Sunspot

A 3D interactive solar system simulation with real-time N-body gravity physics, built with Three.js.

## Overview

Explore our solar system through two distinct visualization modes. Watch planets orbit the sun with accurate elliptical orbits, spawn new celestial bodies, or pilot your own spaceship through the cosmos.

## Simulation Modes

### 🔮 Solar Compact
A stylized, visually-focused experience designed for accessibility and ease of interaction.

| Feature | Description |
|---------|-------------|
| **Scale** | Compressed distances for easy viewing |
| **Distances** | Planets range from 25-200 units from the Sun |
| **Camera** | Starts close at position (0, 20, 50) |
| **Physics** | Higher G constant (0.1) for faster, visible orbits |
| **Bodies** | Includes Earth's Moon |
| **Stars** | Background stars at 500-2000 units |
| **Best For** | Quick exploration, demonstrations, casual viewing |

### 🌌 Solar Realistic
A scientifically accurate representation with proper mass and distance ratios.

| Feature | Description |
|---------|-------------|
| **Scale** | Realistic ratios relative to Mercury |
| **Distances** | True orbital distance ratios (Sun radius: 285 units, Pluto at ~101x Mercury's distance) |
| **Camera** | Starts far back at position (-2000, 1000, -4000) with logarithmic depth buffer |
| **Physics** | Calibrated G constant (0.000015) for accurate orbital mechanics |
| **Masses** | Real mass ratios (Sun: 6,035,500x Mercury, Jupiter: 5,756x Mercury) |
| **Stars** | Background stars at 2,000,000 - 4,000,000 units |
| **Extras** | Speed capped at 0.99999c (speed of light), star streaking at high velocities |
| **Best For** | Educational purposes, understanding true scale, immersive space travel |

## Features

### 🎮 Interaction Modes

#### **Free Camera Mode**
- **Orbit** - Left-click and drag to rotate around the focal point
- **Pan** - Right-click and drag to move the view
- **Zoom** - Mouse wheel to zoom in/out

#### **Chase Camera Mode**
- Select any celestial body from the dropdown menu
- Camera automatically follows the selected object
- Maintains relative viewing angle while tracking

#### **Pilot Mode** 🚀
Take control of your own spaceship and fly through the solar system!
- **W/S** - Increase/decrease thrust
- **Mouse** - Steer the ship
- **ESC** - Exit pilot mode
- **HUD Display** - Real-time thrust and speed indicators
- **Relativistic Effects** (Realistic mode) - Vignette and visual effects at high speeds

### 🌍 Celestial Bodies
- **The Sun** with shader-based glow effect
- **All 8 planets** with proper orbital mechanics
- **Dwarf planets** - Pluto (Compact mode includes Eris)
- **Saturn's rings**
- **Earth's atmosphere** (visual effect)
- **Earth's Moon** (Compact mode)

### ⚡ Spawn System
Create your own celestial bodies!
1. Click "Spawn Body" to enter spawn mode
2. Configure mass and velocity
3. Click and drag on the ecliptic plane to set position and initial velocity

### 🔧 Controls Panel
| Control | Function |
|---------|----------|
| **Camera Target** | Select a body to follow |
| **Time Scale** | Speed up or slow down simulation (0-100x) |
| **Show Trails** | Toggle orbital path trails |
| **Show Orbit Lines** | Toggle predicted elliptical orbits |
| **Show Names** | Display body labels |
| **Max Thrust** | Configure spaceship thrust power |
| **Reset Camera** | Return to default view |
| **Reset Simulation** | Restart the solar system |

## Physics

The simulation uses real N-body gravitational physics:

- **Gravitational Force**: F = G × (m₁ × m₂) / r²
- **Elliptical Orbits**: Calculated using vis-viva equation at perihelion
- **Elastic Collisions**: Bodies bounce off each other realistically
- **Velocity Verlet Integration**: Stable numerical integration

## Tech Stack

- **Three.js** - 3D rendering engine
- **OrbitControls** - Camera interaction
- **Vanilla JavaScript** - ES6 modules
- **HTML5/CSS3** - UI and styling

## Project Structure

```
├── index.html           # Main entry (identical UI for both modes)
├── main.js              # Core simulation for root level
├── style.css            # UI styling
├── solar-compact/       # Compact scale mode
│   ├── index.html
│   ├── main.js
│   └── style.css
├── solar-realistic/     # Realistic scale mode
│   ├── index.html
│   ├── main.js
│   └── style.css
├── src/                 # Shared source files
│   ├── config/
│   └── core/
├── music/               # Background music tracks
└── textures/            # Planet textures
```

## Running Locally

Open any `index.html` file in a modern browser, or use a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .
```

Then navigate to:
- `http://localhost:8000/solar-compact/` - For the compact stylized view
- `http://localhost:8000/solar-realistic/` - For the realistic scale simulation

## Controls Summary

| Input | Action |
|-------|--------|
| **Left-click + Drag** | Rotate camera |
| **Right-click + Drag** | Pan camera |
| **Mouse Wheel** | Zoom |
| **W** (Pilot Mode) | Increase thrust |
| **S** (Pilot Mode) | Decrease thrust |
| **Mouse** (Pilot Mode) | Steer spaceship |
| **ESC** | Exit pilot mode |

---

*Explore the cosmos. Witness gravity. Become a pilot.*
