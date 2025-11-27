import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const CONFIG = {
    G: 0.000015,
    dt: 0.1, // Simulation speed (time step)
    softening: 0.1,
    shadowMapSize: 2048 // Shadow map size
};

// --- Scaling Factors ---
// These translate "Real Ratios" into "Three.js Units"
const SCALES = {
    MASS: 1.0,      // 1 unit mass = 1 Mercury Mass
    RADIUS: 0.5,    // 1 unit radius = 0.5 World Units (Visual size)
    DISTANCE: 30.0, // 1 unit distance (Mercury Orbit) = 30 World Units
};
const SUN_VISUAL_SCALE = 285
// --- State ---
const state = {
    bodies: [],
    cameraTarget: null,
    isDragging: false,
    timeScale: 1.0,
    pilotMode: false,
    spaceship: null,
    keys: { w: false, s: false }
};

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000000);
const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector('#bg'),
    antialias: true,
    logarithmicDepthBuffer: true // Critical for massive scale differences
});

// Enable shadow mapping for dynamic shadows
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Soft shadows

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

// Camera Position is now far away, behind (-Z), left (-X), and slightly above (+Y)
camera.position.set(-2000, 1000, -4000);
camera.lookAt(0, 0, 0); // Ensure it is centered on the Sun

// --- Lighting ---
// Very low ambient light for stark contrast between lit and dark sides
const ambientLight = new THREE.AmbientLight(0x111111, 0.5);
scene.add(ambientLight);

const pointLight = new THREE.PointLight(0xffffff, 0.5, 0, 0); // Intensity 1.5, Distance 0 (infinite), Decay 0 (no falloff)
pointLight.position.set(0, 0, 0); // Sun is at center

// Enable shadows for the sun's light
pointLight.castShadow = true;
pointLight.shadow.mapSize.width = 2048;
pointLight.shadow.mapSize.height = 2048;
pointLight.shadow.camera.near = 0.5;
pointLight.shadow.camera.far = 5000000;

scene.add(pointLight);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// --- Physics Engine ---
class Body {
    constructor(name, mass, radius, color, position, velocity, isStar = false, texturePath = null) {
        this.name = name;
        this.mass = mass;
        this.radius = radius;
        this.position = new THREE.Vector3(...position);
        this.velocity = new THREE.Vector3(...velocity);
        this.isStar = isStar;
        this.force = new THREE.Vector3();

        // Mesh
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        let material;

        if (isStar) {
            material = new THREE.MeshBasicMaterial({ color: color }); // Star glows (basic material)
        } else {
            const materialParams = { color: color };
            if (texturePath) {
                const textureLoader = new THREE.TextureLoader();
                textureLoader.crossOrigin = 'anonymous'; // Fix CORS issues
                // Load texture, but keep color as base/fallback
                const texture = textureLoader.load(texturePath);
                materialParams.map = texture;
                // If texture is provided, we might want to set color to white so it doesn't tint the texture
                materialParams.color = 0xffffff;
            }
            material = new THREE.MeshStandardMaterial(materialParams);
        }

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.userData = { body: this }; // Link mesh back to body for raycasting

        // Enable shadows for planets (not for stars)
        if (!isStar) {
            this.mesh.castShadow = true;
            this.mesh.receiveShadow = true;
        }

        scene.add(this.mesh);

        // Trail
        this.trailPoints = [];
        this.maxTrailPoints = 200;
        const trailGeometry = new THREE.BufferGeometry();
        const trailMaterial = new THREE.LineBasicMaterial({ color: color, opacity: 0.5, transparent: true });
        this.trailLine = new THREE.Line(trailGeometry, trailMaterial);
        scene.add(this.trailLine);

        // Name Label (Sprite)
        this.nameSprite = this.createNameSprite(name);
        this.nameSprite.visible = false; // Hidden by default
        scene.add(this.nameSprite);
    }

    createNameSprite(name) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        // Draw text
        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = 'Bold 24px Arial';
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.fillText(name, canvas.width / 2, canvas.height / 2 + 8);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(10, 2.5, 1);

        return sprite;
    }

    updateTrail() {
        this.trailPoints.push(this.position.clone());
        if (this.trailPoints.length > this.maxTrailPoints) {
            this.trailPoints.shift();
        }
        this.trailLine.geometry.setFromPoints(this.trailPoints);

        // Update name sprite position (above the body)
        this.nameSprite.position.copy(this.position);
        this.nameSprite.position.y += this.radius * 2;
    }
}

// Spaceship Class for Pilot Mode
class Spaceship extends Body {
    constructor(name, mass, radius, color, position, velocity, maxThrust) {
        super(name, mass, radius, color, position, velocity, false);

        this.maxThrust = maxThrust;
        this.currentThrust = 0;
        this.orientation = new THREE.Quaternion(); // Ship orientation
        this.forward = new THREE.Vector3(0, 0, -1); // Forward direction

        // Replace mesh with a cone to show direction
        scene.remove(this.mesh);
        const geometry = new THREE.ConeGeometry(radius, radius * 3, 8);
        const material = new THREE.MeshStandardMaterial({ color: color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.orientation);
        scene.add(this.mesh);
    }

    applyThrust() {
        // Calculate thrust force in forward direction
        const thrustForce = this.forward.clone().multiplyScalar(this.currentThrust);
        this.force.add(thrustForce);
    }

    rotate(deltaYaw, deltaPitch) {
        // Apply rotation based on mouse movement
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deltaYaw);
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deltaPitch);

        this.orientation.multiply(yawQuat).multiply(pitchQuat);
        this.orientation.normalize();

        // Update forward vector
        this.forward.set(0, 0, -1).applyQuaternion(this.orientation);

        // Update mesh orientation
        this.mesh.quaternion.copy(this.orientation);
    }

    updateMesh() {
        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.orientation);
    }
}

function updatePhysics(dt) {
    // Reset forces
    for (const body of state.bodies) {
        body.force.set(0, 0, 0);
    }

    // Apply spaceship thrust if in pilot mode
    if (state.pilotMode && state.spaceship) {
        state.spaceship.applyThrust();
    }

    // Calculate gravity
    for (let i = 0; i < state.bodies.length; i++) {
        for (let j = i + 1; j < state.bodies.length; j++) {
            const bodyA = state.bodies[i];
            const bodyB = state.bodies[j];

            const rVector = new THREE.Vector3().subVectors(bodyB.position, bodyA.position);
            const distance = rVector.length();

            // Collision detection
            if (distance < bodyA.radius + bodyB.radius) {
                // Elastic collision - bounce instead of absorb

                // Separate the bodies to prevent overlap
                const overlap = (bodyA.radius + bodyB.radius) - distance;
                const separationDirection = rVector.clone().normalize();

                // Move bodies apart proportional to their masses (lighter moves more)
                const totalMass = bodyA.mass + bodyB.mass;
                const moveA = overlap * (bodyB.mass / totalMass);
                const moveB = overlap * (bodyA.mass / totalMass);

                bodyA.position.sub(separationDirection.clone().multiplyScalar(moveA));
                bodyB.position.add(separationDirection.clone().multiplyScalar(moveB));

                // Elastic collision velocity calculation (1D along collision normal)
                // Get velocity components along collision normal
                const normal = separationDirection;
                const relativeVelocity = new THREE.Vector3().subVectors(bodyB.velocity, bodyA.velocity);
                const velocityAlongNormal = relativeVelocity.dot(normal);

                // Don't resolve if velocities are separating
                if (velocityAlongNormal > 0) continue;

                // Calculate restitution (coefficient of restitution = 1 for perfectly elastic)
                const restitution = 0.95; // Slightly less than 1 for realistic behavior

                // Calculate impulse scalar
                const impulseScalar = -(1 + restitution) * velocityAlongNormal / (1 / bodyA.mass + 1 / bodyB.mass);

                // Apply impulse
                const impulse = normal.multiplyScalar(impulseScalar);
                bodyA.velocity.sub(impulse.clone().divideScalar(bodyA.mass));
                bodyB.velocity.add(impulse.clone().divideScalar(bodyB.mass));

                continue;
            }

            const forceMagnitude = (CONFIG.G * bodyA.mass * bodyB.mass) / (distance * distance);
            const force = rVector.normalize().multiplyScalar(forceMagnitude);

            bodyA.force.add(force);
            bodyB.force.sub(force); // Newton's 3rd Law
        }
    }

    // Integrate (Velocity Verlet / Euler)
    for (const body of state.bodies) {
        const acceleration = body.force.clone().divideScalar(body.mass);
        body.velocity.add(acceleration.multiplyScalar(dt));

        // Cap spaceship speed at 0.99999c
        if (body === state.spaceship) {
            const speedOfLight = 638; // Simulation's c in units/tick
            const maxSpeed = speedOfLight * 0.99999;
            const currentSpeed = body.velocity.length();

            if (currentSpeed > maxSpeed) {
                body.velocity.normalize().multiplyScalar(maxSpeed);
            }
        }

        body.position.add(body.velocity.clone().multiplyScalar(dt));

        // Update Mesh
        body.mesh.position.copy(body.position);
        body.updateTrail();
    }
}


// --- Visuals ---
let starPositions = []; // Store star positions for streaking
let starStreaks = null; // Line geometry for streaks

function createStarfield() {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];

    // The maximum planetary distance is ~3045 (Pluto). We start the starfield at 4000 units.
    const MIN_RADIUS = 2000000; // Push stars WAY back
    const MAX_RADIUS = 4000000;

    for (let i = 0; i < 10000; i++) {
        // Generate stars in a spherical shell far from the solar system
        const radius = MIN_RADIUS + Math.random() * (MAX_RADIUS - MIN_RADIUS);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);

        vertices.push(x, y, z);
        starPositions.push(new THREE.Vector3(x, y, z));
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7 });
    const stars = new THREE.Points(geometry, material);
    scene.add(stars);

    // Create star streaks (initially empty)
    const streakGeometry = new THREE.BufferGeometry();
    const streakVertices = new Float32Array(starPositions.length * 6); // 2 points per star (start, end)
    streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakVertices, 3));
    const streakMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    starStreaks = new THREE.LineSegments(streakGeometry, streakMaterial);
    starStreaks.visible = false;
    scene.add(starStreaks);
}

createStarfield();

// Soft gradient glow around the sun using ShaderMaterial
// The Sun's body radius is now 150, so the glow must be significantly larger (e.g., )
const sunGlowGeometry = new THREE.SphereGeometry(450, 32, 32);

// The material code remains the same...
const sunGlowMaterial = new THREE.ShaderMaterial({
    // ... keep existing uniforms and shaders ...
    uniforms: {
        glowColor: { value: new THREE.Color(0xffff00) },
        viewVector: { value: camera.position }
    },
    vertexShader: `
        uniform vec3 viewVector;
        varying float intensity;
        void main() {
            vec3 vNormal = normalize(normalMatrix * normal);
            vec3 vNormel = normalize(normalMatrix * viewVector);
            intensity = pow(0.6 - dot(vNormal, vNormel), 4.0); // Adjusted coefficient 0.7 -> 0.6 for softer edge
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 glowColor;
        varying float intensity;
        void main() {
            vec3 glow = glowColor * intensity;
            gl_FragColor = vec4(glow, intensity);
        }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true
});
const sunGlow = new THREE.Mesh(sunGlowGeometry, sunGlowMaterial);
scene.add(sunGlow);

// --- Solar System Data ---
// Visual Scale: Distances and sizes are not 1:1 real scale, but proportional for visibility.
// Mass is relative.
function initSolarSystem() {
    // 1. The Sun
    // Real Ratios relative to Mercury:
    // Mass: ~6,035,000x | Radius: ~285x 
    // The physics (mass) remains accurate.
    const sunRadiusVisual = 285;
    const sunMass = 6035500;

    const sun = new Body("Sun", sunMass, sunRadiusVisual, 0xffff00, [0, 0, 0], [0, 0, 0], true);
    state.bodies.push(sun);

    // 2. The Planets
    // Data Sources: NASA Planetary Fact Sheet
    // All values are ratios relative to Mercury (Mass=1, Radius=1, SemiMajorAxis=1)
    const planetData = [
        {
            name: "Mercury", color: 0xaaaaaa,
            massRel: 1.0,
            radiusRel: 1.0,
            distRel: 1.0,
            eccentricity: 0.205,
            texture: ""
        },
        {
            name: "Venus", color: 0xffcc00,
            massRel: 14.77,
            radiusRel: 2.48,
            distRel: 1.86,
            eccentricity: 0.007,
            texture: ""
        },
        {
            name: "Earth", color: 0x0000ff,
            massRel: 18.10,
            radiusRel: 2.61,
            distRel: 2.58,
            eccentricity: 0.017,
            texture: ""
        },
        {
            name: "Mars", color: 0xff0000,
            massRel: 1.95,
            radiusRel: 1.39,
            distRel: 3.94,
            eccentricity: 0.094,
            texture: ""
        },
        {
            name: "Jupiter", color: 0xffaa00,
            massRel: 5756.0,
            radiusRel: 28.66,
            distRel: 13.44,
            eccentricity: 0.049,
            texture: ""
        },
        {
            name: "Saturn", color: 0xddcc99,
            massRel: 1722.0,
            radiusRel: 23.87,
            distRel: 24.75,
            eccentricity: 0.057,
            texture: ""
        },
        {
            name: "Uranus", color: 0x00ffff,
            massRel: 263.0,
            radiusRel: 10.40,
            distRel: 49.60,
            eccentricity: 0.046,
            texture: ""
        },
        {
            name: "Neptune", color: 0x0000aa,
            massRel: 309.0,
            radiusRel: 10.09,
            distRel: 77.62,
            eccentricity: 0.011,
            texture: ""
        },
        {
            name: "Pluto", color: 0xdddddd,
            massRel: 0.04,
            radiusRel: 0.49,
            distRel: 101.5,
            eccentricity: 0.244,
            texture: ""
        }
    ];

    planetData.forEach(p => {
        // Apply Scaling Factors
        const mass = p.massRel * SCALES.MASS;
        const radius = p.radiusRel * SCALES.RADIUS;
        const semiMajorAxis = p.distRel * SCALES.DISTANCE * SUN_VISUAL_SCALE;

        // Calculate Position at Perihelion (Closest approach)
        // r = a(1-e)
        const distPerihelion = semiMajorAxis * (1 - p.eccentricity);

        // Position: Start on X axis
        const x = distPerihelion;
        const z = 0;

        // Calculate Orbital Velocity (Vis-Viva Equation) at Perihelion
        // v = sqrt( G * M_sun * ( (1+e) / (a*(1-e)) ) )
        // Note: We use the actual physics mass of Sun here
        const num = CONFIG.G * sunMass * (1 + p.eccentricity);
        const den = semiMajorAxis * (1 - p.eccentricity);
        const v = Math.sqrt(num / den);

        // At perihelion, velocity is purely perpendicular to radius
        const vx = 0;
        const vz = v; // Orbit counter-clockwise

        const body = new Body(p.name, mass, radius, p.color, [x, 0, z], [vx, 0, vz], false, p.texture);
        state.bodies.push(body);

        // --- Visual Extras (Rings, Atmosphere) ---

        // Earth Atmosphere
        if (p.name === "Earth") {
            const atmoGeo = new THREE.SphereGeometry(radius * 1.2, 32, 32);
            const atmoMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.2, side: THREE.BackSide });
            body.mesh.add(new THREE.Mesh(atmoGeo, atmoMat));
        }

        // Saturn Rings (Scaled to new radius)
        if (p.name === "Saturn") {
            const ringGeo = new THREE.RingGeometry(radius * 1.4, radius * 2.5, 64);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0xaa8855, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2;
            body.mesh.add(ring);
        }

        // --- UI & Orbit Lines ---
        const option = document.createElement('option');
        option.value = p.name;
        option.innerText = p.name;
        document.getElementById('camera-target').appendChild(option);

        // Orbit Line Visualization
        // We need to calculate the semi-minor axis (b) for the ellipse
        const a = semiMajorAxis;
        const b = a * Math.sqrt(1 - p.eccentricity * p.eccentricity);
        const c = a * p.eccentricity; // Focus offset

        const curve = new THREE.EllipseCurve(-c, 0, a, b, 0, 2 * Math.PI, false, 0);
        const points = curve.getPoints(128);
        const orbitGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const orbitMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });
        const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
        orbitLine.rotation.x = Math.PI / 2;
        orbitLine.userData = { isOrbitLine: true };
        orbitLine.visible = document.getElementById('show-orbits').checked; // Respect current checkbox state
        scene.add(orbitLine);
    });

    // Moon removed as requested
}

// Toggle Orbit Lines
document.getElementById('show-orbits').addEventListener('change', (e) => {
    const show = e.target.checked;
    scene.traverse((object) => {
        if (object.userData.isOrbitLine) {
            object.visible = show;
        }
    });
});



// --- Camera & Interaction ---
// --- Camera & Interaction ---
function updateCamera() {
    if (state.cameraTarget && state.cameraTarget !== "Free" && state.cameraTarget !== "Sun") {
        const targetBody = state.bodies.find(b => b.name === state.cameraTarget);
        if (targetBody) {
            // Chase mode: Position camera relative to target based on its radius
            // We want to be close enough to see it well, but far enough to see the whole thing
            const desiredDistance = targetBody.radius * 5;

            // Calculate current direction from target to camera
            const direction = camera.position.clone().sub(targetBody.position).normalize();

            // If direction is zero (camera inside planet), pick a default
            if (direction.lengthSq() < 0.001) direction.set(0, 0.5, 1).normalize();

            // Set camera position at desired distance
            const targetPosition = targetBody.position.clone().add(direction.multiplyScalar(desiredDistance));

            // Smoothly interpolate camera position (optional, but good for "chase" feel)
            // For now, we'll just set it to keep it simple and responsive
            // But we only want to SNAP distance when we first switch. 
            // If the user is zooming in/out, we should respect that?
            // The user request implies "when clicking on a planet", i.e., initial switch.
            // However, updateCamera runs every frame.
            // To support scrolling, we should only enforce distance if we just switched?
            // Or, we can just enforce the *center* and let OrbitControls handle the distance,
            // BUT OrbitControls needs to be updated to the new target.

            // Actually, OrbitControls handles the distance from the target.
            // So we just need to set controls.target to the body.
            // AND update the camera position to be at the right distance relative to that new target.

            // We can check if the target CHANGED recently?
            // Better: The user said "when changing from large to small body".
            // This implies the initial snap.

            // Let's implement a "target changed" flag or similar logic in the event listener,
            // but since we are in the loop, we can just update the controls target.
            // The issue is OrbitControls maintains the *current* distance if we just move the target.
            // We need to manually move the camera closer/further.

            // We will handle the "snap" in the change event listener instead!
            // Here we just follow.

            const offset = camera.position.clone().sub(controls.target);
            controls.target.copy(targetBody.position);
            camera.position.copy(targetBody.position).add(offset);
        }
    } else if (state.cameraTarget === "Sun") {
        const sun = state.bodies.find(b => b.name === "Sun");
        if (sun) {
            const offset = camera.position.clone().sub(controls.target);
            controls.target.copy(sun.position);
            camera.position.copy(sun.position).add(offset);
        }
    }
}

// Event Listeners
document.getElementById('camera-target').addEventListener('change', (e) => {
    const prevTarget = state.cameraTarget;
    state.cameraTarget = e.target.value;

    if (state.cameraTarget === "Free") {
        // Optional: Reset controls or leave as is
    } else {
        // Snap camera to new target distance
        const targetBody = state.bodies.find(b => b.name === state.cameraTarget);
        if (targetBody) {
            // Set distance based on radius (e.g., 4x radius)
            const desiredDist = targetBody.radius * 4;

            // Keep current viewing angle if possible, or reset to a nice side view
            // Let's keep the angle but adjust magnitude
            let offset = camera.position.clone().sub(controls.target);
            if (offset.lengthSq() === 0) offset.set(0, 1, 2); // Default if at 0

            offset.normalize().multiplyScalar(desiredDist);

            controls.target.copy(targetBody.position);
            camera.position.copy(targetBody.position).add(offset);
            controls.update();
        }
    }
});

// Track mouse button for camera control detection
let mouseButton = -1;
renderer.domElement.addEventListener('mousedown', (e) => {
    mouseButton = e.button;
});

renderer.domElement.addEventListener('mouseup', () => {
    mouseButton = -1;
});

controls.addEventListener('start', () => {
    // Only snap to free mode on pan (right-click or middle-click)
    // button 2 = right click (pan in OrbitControls)
    // Allow zoom (wheel) and rotate (left-click) to work in chase mode
    if (state.cameraTarget !== "Free" && mouseButton === 2) {
        state.cameraTarget = "Free";
        document.getElementById('camera-target').value = "Free";
    }
});

// Update thrust based on key state
function updatePilotControls() {
    if (!state.pilotMode || !state.spaceship) return;

    // Adjust thrust based on W/S keys
    if (state.keys.w) {
        state.spaceship.currentThrust = Math.min(state.spaceship.currentThrust + 0.1, state.spaceship.maxThrust);
    } else if (state.keys.s) {
        state.spaceship.currentThrust = Math.max(state.spaceship.currentThrust - 0.1, -state.spaceship.maxThrust * 0.5);
    } else {
        // Gradual deceleration when no keys pressed
        state.spaceship.currentThrust *= 0.95;
    }
}

document.getElementById('time-scale').addEventListener('input', (e) => {
    state.timeScale = parseFloat(e.target.value);
    document.getElementById('time-scale-val').innerText = state.timeScale + 'x';
});

// Max Thrust Slider
document.getElementById('max-thrust').addEventListener('input', (e) => {
    const thrust = parseFloat(e.target.value);
    document.getElementById('max-thrust-val').innerText = thrust.toFixed(1);
});

// Reset Camera Button
document.getElementById('reset-camera-btn').addEventListener('click', () => {
    // Reset camera position to new default
    camera.position.set(-2000, 1000, -4000); // Updated default
    controls.target.set(0, 0, 0); // Target the Sun
    controls.update();

    // Reset camera target dropdown to Free
    state.cameraTarget = "Free";
    document.getElementById('camera-target').value = "Free";
});

// Show Trails Toggle
document.getElementById('show-trails').addEventListener('change', (e) => {
    const show = e.target.checked;
    state.bodies.forEach(body => {
        if (body.trailLine) {
            body.trailLine.visible = show;
        }
    });
});

// Show Names Toggle
document.getElementById('show-names').addEventListener('change', (e) => {
    const show = e.target.checked;
    state.bodies.forEach(body => {
        if (body.nameSprite) {
            body.nameSprite.visible = show;
        }
    });
});

// Reset Simulation Button
document.getElementById('reset-simulation-btn').addEventListener('click', () => {
    // Remove all bodies
    state.bodies.forEach(body => {
        scene.remove(body.mesh);
        scene.remove(body.trailLine);
        scene.remove(body.nameSprite);
    });
    state.bodies = [];

    // Clear dropdown except Free and Sun
    const dropdown = document.getElementById('camera-target');
    while (dropdown.options.length > 2) {
        dropdown.remove(2);
    }

    // Reset camera target
    state.cameraTarget = "Free";
    dropdown.value = "Free";

    // Reset time scale
    state.timeScale = 1.0;
    document.getElementById('time-scale').value = 1;
    document.getElementById('time-scale-val').innerText = '1x';

    // Reinitialize solar system
    initSolarSystem();
});

// Pilot Mode Toggle
const pilotModeBtn = document.getElementById('pilot-mode-btn');
const pilotInstructions = document.getElementById('pilot-instructions');

pilotModeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.pilotMode) {
        // Enter pilot mode - spawn spaceship at click location
        state.pilotMode = true;
        pilotModeBtn.innerText = "Click to Place Ship";
        pilotModeBtn.style.background = "#ff9900";
        pilotInstructions.style.display = "block";

        // Wait for user to click to place the ship
        const placeShip = (e) => {
            // Calculate position on ecliptic plane
            const pointer = new THREE.Vector2();
            pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
            pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(pointer, camera);
            const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const target = new THREE.Vector3();

            if (raycaster.ray.intersectPlane(spawnPlane, target)) {
                // Create spaceship at this position
                const maxThrust = parseFloat(document.getElementById('max-thrust').value);
                state.spaceship = new Spaceship(
                    "Spaceship",
                    1, // Small mass
                    0.5, // Small radius
                    0x00ff00, // Green color
                    [target.x, target.y, target.z],
                    [0, 0, 0], // Zero initial velocity
                    maxThrust
                );

                // Orient spaceship to face the sun
                const sunPos = new THREE.Vector3(0, 0, 0); // Sun is at origin
                const shipPos = state.spaceship.position.clone();
                const directionToSun = new THREE.Vector3().subVectors(sunPos, shipPos).normalize();

                // Calculate rotation to face the sun
                const forward = new THREE.Vector3(0, 0, -1); // Default forward direction
                const quaternion = new THREE.Quaternion().setFromUnitVectors(forward, directionToSun);
                state.spaceship.orientation.copy(quaternion);
                state.spaceship.forward.copy(directionToSun);
                state.spaceship.mesh.quaternion.copy(quaternion);

                state.bodies.push(state.spaceship);

                // Lock pointer for mouse control
                renderer.domElement.requestPointerLock();

                // Disable orbit controls
                controls.enabled = false;

                // Show HUD and Crosshair
                document.getElementById('pilot-hud').style.display = 'block';
                document.getElementById('crosshair').style.display = 'block';

                // Hide spaceship visuals (first-person view)
                state.spaceship.mesh.visible = false;
                state.spaceship.trailLine.visible = false;

                pilotModeBtn.innerText = "Exit Pilot Mode (ESC)";

                // Remove listener after successful placement
                renderer.domElement.removeEventListener('click', placeShip);
            }
        };

        // Add listener with delay to prevent immediate trigger
        setTimeout(() => {
            renderer.domElement.addEventListener('click', placeShip);
        }, 50);

    } else {
        // Exit pilot mode
        exitPilotMode();
    }
});

function exitPilotMode() {
    state.pilotMode = false;
    pilotModeBtn.innerText = "Launch Pilot Mode";
    pilotModeBtn.style.background = "#4facfe";
    pilotInstructions.style.display = "none";

    // Hide HUD and Crosshair
    document.getElementById('pilot-hud').style.display = 'none';
    document.getElementById('crosshair').style.display = 'none';

    // Exit pointer lock
    document.exitPointerLock();

    // Re-enable orbit controls
    controls.enabled = true;

    // Remove spaceship from simulation
    if (state.spaceship) {
        // Remove from bodies array
        const index = state.bodies.indexOf(state.spaceship);
        if (index > -1) {
            state.bodies.splice(index, 1);
        }

        // Remove visual elements
        scene.remove(state.spaceship.mesh);
        scene.remove(state.spaceship.trailLine);
        scene.remove(state.spaceship.nameSprite);

        state.spaceship = null;
    }

    // Hide visual effects
    const vignette = document.getElementById('speed-vignette');
    const blueShift = document.getElementById('blue-shift');
    const motionBlur = document.getElementById('motion-blur');
    if (vignette) {
        vignette.style.display = 'none';
        vignette.style.opacity = '0';
    }
    if (blueShift) {
        blueShift.style.display = 'none';
        blueShift.style.opacity = '0';
    }
    if (motionBlur) {
        motionBlur.style.display = 'none';
        motionBlur.style.opacity = '0';
    }

    // Hide star streaks
    if (starStreaks) {
        starStreaks.visible = false;
    }
}

// Keyboard Input for Thrust
window.addEventListener('keydown', (e) => {
    if (!state.pilotMode || !state.spaceship) return;

    if (e.key.toLowerCase() === 'w') {
        state.keys.w = true;
    } else if (e.key.toLowerCase() === 's') {
        state.keys.s = true;
    } else if (e.key === 'Escape') {
        exitPilotMode();
    }
});

window.addEventListener('keyup', (e) => {
    if (!state.pilotMode || !state.spaceship) return;

    if (e.key.toLowerCase() === 'w') {
        state.keys.w = false;
    } else if (e.key.toLowerCase() === 's') {
        state.keys.s = false;
    }
});

// Mouse Movement for Steering
renderer.domElement.addEventListener('mousemove', (e) => {
    if (!state.pilotMode || !state.spaceship) return;
    if (document.pointerLockElement !== renderer.domElement) return;

    // Get mouse movement
    const sensitivity = 0.002;
    const deltaYaw = -e.movementX * sensitivity;
    const deltaPitch = -e.movementY * sensitivity; // Normal (not inverted)

    state.spaceship.rotate(deltaYaw, deltaPitch);
});

// Spawning Logic
let spawnMode = false;
let isDraggingSpawn = false;
let spawnStartPos = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Ecliptic plane (y=0)

// Visual helper for aiming
const aimLineGeo = new THREE.BufferGeometry();
const aimLineMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const aimLine = new THREE.Line(aimLineGeo, aimLineMat);
scene.add(aimLine);
aimLine.visible = false;

const spawnBtn = document.getElementById('spawn-btn');
spawnBtn.addEventListener('click', () => {
    spawnMode = !spawnMode;
    spawnBtn.innerText = spawnMode ? "Click on Space to Place" : "Spawn (Click & Drag)";
    spawnBtn.style.background = spawnMode ? "#ff9900" : "#4facfe"; // Orange when active
});

// Mouse Events for Spawning
window.addEventListener('pointerdown', (e) => {
    if (!spawnMode) return;

    // Calculate pointer position in normalized device coordinates
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const target = new THREE.Vector3();

    // Raycast to the ecliptic plane
    if (raycaster.ray.intersectPlane(spawnPlane, target)) {
        isDraggingSpawn = true;
        spawnStartPos.copy(target);
        controls.enabled = false; // Disable camera controls while dragging

        // Show aim line
        aimLine.visible = true;
        const points = [spawnStartPos, spawnStartPos]; // Start with zero length
        aimLine.geometry.setFromPoints(points);
    }
});

window.addEventListener('pointermove', (e) => {
    if (!isDraggingSpawn) return;

    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const target = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(spawnPlane, target)) {
        // Draw line from start to current mouse pos (representing velocity)
        const points = [spawnStartPos, target];
        aimLine.geometry.setFromPoints(points);
    }
});

window.addEventListener('pointerup', (e) => {
    if (!isDraggingSpawn) return;

    isDraggingSpawn = false;
    spawnMode = false; // Reset mode
    controls.enabled = true; // Re-enable controls
    aimLine.visible = false;
    spawnBtn.innerText = "Spawn (Click & Drag)";
    spawnBtn.style.background = "#4facfe";

    // Calculate final position for velocity vector
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(spawnPlane, target);

    // Velocity is vector from start to end (drag direction)
    const velocity = new THREE.Vector3().subVectors(target, spawnStartPos);

    // Get user params
    const mass = parseFloat(document.getElementById('spawn-mass').value) || 10;
    const speedMult = parseFloat(document.getElementById('spawn-velocity').value) || 1;

    velocity.multiplyScalar(speedMult * 0.1); // Scale down

    // Create Body
    const name = "Asteroid_" + Math.floor(Math.random() * 1000);
    const radius = Math.cbrt(mass) * 0.5;
    const color = Math.random() * 0xffffff;

    const body = new Body(name, mass, radius, color, [spawnStartPos.x, spawnStartPos.y, spawnStartPos.z], [velocity.x, velocity.y, velocity.z]);
    state.bodies.push(body);

    // Add to Camera Target Dropdown
    const option = document.createElement('option');
    option.value = name;
    option.innerText = name;
    document.getElementById('camera-target').appendChild(option);
});

// Update HUD
function updateHUD() {
    if (!state.pilotMode || !state.spaceship) return;

    // Update Thrust Bar
    const thrustBar = document.getElementById('thrust-bar');
    const thrustVal = document.getElementById('thrust-val');

    if (thrustBar && thrustVal) {
        const percent = (state.spaceship.currentThrust / state.spaceship.maxThrust) * 100;

        // Handle reverse thrust visualization
        if (percent < 0) {
            thrustBar.style.width = `${Math.abs(percent)}%`;
            thrustBar.style.background = 'linear-gradient(90deg, #f00, #900)'; // Red for reverse
        } else {
            thrustBar.style.width = `${percent}%`;
            thrustBar.style.background = 'linear-gradient(90deg, #0f0, #0a0)'; // Green for forward
        }

        thrustVal.innerText = state.spaceship.currentThrust.toFixed(1);
    }

    // Update Speed Display
    const speedDisplay = document.getElementById('speed-display');
    if (speedDisplay) {
        // Display speed in 'c' (speed of light)
        const speedOfLight = 638; // Simulation's c in units/tick
        const speedC = state.spaceship.velocity.length() / speedOfLight;
        speedDisplay.innerText = `${speedC.toFixed(5)} c`;

        // Update relativistic visual effects based on speed
        const vignette = document.getElementById('speed-vignette');
        const blueShift = document.getElementById('blue-shift');
        const motionBlur = document.getElementById('motion-blur');

        // Show overlays when in pilot mode
        if (vignette && blueShift && motionBlur) {
            vignette.style.display = 'block';
            blueShift.style.display = 'block';
            motionBlur.style.display = 'block';

            // Vignette: starts at 0.5c, max at 0.99c
            const vignetteOpacity = Math.max(0, Math.min(1, (speedC - 0.5) / 0.5)) * 0.8;
            vignette.style.opacity = vignetteOpacity.toString();

            // Blue Shift: starts at 0.7c, max at 0.99c
            const blueShiftOpacity = Math.max(0, Math.min(1, (speedC - 0.7) / 0.3)) * 0.3;
            blueShift.style.opacity = blueShiftOpacity.toString();

            // Motion Blur: starts at 0.6c with CSS blur filter
            const blurAmount = Math.max(0, (speedC - 0.6) * 10);
            const motionBlurOpacity = Math.max(0, Math.min(1, (speedC - 0.6) / 0.4)) * 0.5;
            motionBlur.style.opacity = motionBlurOpacity.toString();
            motionBlur.style.filter = `blur(${blurAmount}px)`;
        }

        // Update star streaks based on velocity
        if (starStreaks && speedC > 0.3) {
            starStreaks.visible = true;
            const velocityNorm = state.spaceship.velocity.clone().normalize();
            const streakLength = Math.max(0, (speedC - 0.3) * 100000); // Streak length increases with speed

            const positions = starStreaks.geometry.attributes.position.array;
            for (let i = 0; i < starPositions.length; i++) {
                const star = starPositions[i];
                // Start point = star position
                positions[i * 6 + 0] = star.x;
                positions[i * 6 + 1] = star.y;
                positions[i * 6 + 2] = star.z;

                // End point = star position + velocity direction * streakLength
                positions[i * 6 + 3] = star.x + velocityNorm.x * streakLength;
                positions[i * 6 + 4] = star.y + velocityNorm.y * streakLength;
                positions[i * 6 + 5] = star.z + velocityNorm.z * streakLength;
            }
            starStreaks.geometry.attributes.position.needsUpdate = true;
            starStreaks.material.opacity = Math.min(1, speedC * 0.8);
        } else if (starStreaks) {
            starStreaks.visible = false;
        }
    }
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);

    // Update pilot controls if in pilot mode
    updatePilotControls();
    updateHUD();

    const totalDt = CONFIG.dt * state.timeScale;
    const subSteps = 10; // tune: 4-30 depending on stability/perf
    const stepDt = totalDt / subSteps;

    for (let i = 0; i < subSteps; i++) {
        updatePhysics(stepDt);
    }

    // Update sun glow position to follow the sun
    const sun = state.bodies.find(b => b.name === "Sun");
    if (sun) {
        sunGlow.position.copy(sun.position);
        // Update point light position
        pointLight.position.copy(sun.position);
    }

    // Update camera (chase or pilot mode)
    if (state.pilotMode && state.spaceship) {
        // First-person camera - position at spaceship, look in forward direction
        camera.position.copy(state.spaceship.position);
        const lookTarget = state.spaceship.position.clone().add(state.spaceship.forward.clone().multiplyScalar(10));
        camera.lookAt(lookTarget);
    } else {
        updateCamera(); // Normal chase/free camera
        controls.update();
    }

    renderer.render(scene, camera);
}

// Ensure DOM is ready
window.addEventListener('load', () => {
    console.log("Window loaded, initializing solar system...");
    try {
        initSolarSystem();
        console.log("Solar system initialized.");
    } catch (e) {
        console.error("Error initializing solar system:", e);
    }
    animate();
});

