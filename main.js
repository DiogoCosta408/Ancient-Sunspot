import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const CONFIG = {
    G: 0.1, // Gravitational constant (visual scale)
    dt: 0.005, // Time step (20x slower than 0.1)
    softening: 0.1 // To prevent singularities
};

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
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector('#bg'),
    antialias: true
});

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(50);
camera.position.setY(20);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x333333);
scene.add(ambientLight);

const pointLight = new THREE.PointLight(0xffffff, 2, 1000);
pointLight.position.set(0, 0, 0); // Sun is at center
scene.add(pointLight);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// --- Physics Engine ---
class Body {
    constructor(name, mass, radius, color, position, velocity, isStar = false) {
        this.name = name;
        this.mass = mass;
        this.radius = radius;
        this.position = new THREE.Vector3(...position);
        this.velocity = new THREE.Vector3(...velocity);
        this.isStar = isStar;
        this.force = new THREE.Vector3();

        // Mesh
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = isStar
            ? new THREE.MeshBasicMaterial({ color: color }) // Star glows (basic material)
            : new THREE.MeshStandardMaterial({ color: color });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.userData = { body: this }; // Link mesh back to body for raycasting
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
        body.position.add(body.velocity.clone().multiplyScalar(dt));

        // Update Mesh
        body.mesh.position.copy(body.position);
        body.updateTrail();
    }
}


// --- Visuals ---
function createStarfield() {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    for (let i = 0; i < 10000; i++) {
        // Generate stars in a spherical shell far from the solar system
        // Stars should be at least 500 units away, up to 2000 units
        const radius = 500 + Math.random() * 1500;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);

        vertices.push(x, y, z);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7 });
    const stars = new THREE.Points(geometry, material);
    scene.add(stars);
}

createStarfield();

// Sun Glow
const sunGlowGeo = new THREE.SpriteMaterial({
    map: new THREE.TextureLoader().load('https://threejs.org/examples/textures/sprites/glow.png'),
    color: 0xffff00,
    transparent: true,
    blending: THREE.AdditiveBlending
});
const sunGlow = new THREE.Sprite(sunGlowGeo);
sunGlow.scale.set(25, 25, 1);
scene.add(sunGlow);

// --- Solar System Data ---
// Visual Scale: Distances and sizes are not 1:1 real scale, but proportional for visibility.
// Mass is relative.
function initSolarSystem() {
    // Sun
    const sun = new Body("Sun", 10000, 5, 0xffff00, [0, 0, 0], [0, 0, 0], true);
    state.bodies.push(sun);

    // Planets (Name, Mass, Radius, Color, Distance, Velocity)
    // Velocity calculated for circular orbit: v = sqrt(G * M_sun / r)
    // v = sqrt(0.1 * 10000 / r) = sqrt(1000 / r)
    const planets = [
        { name: "Mercury", mass: 1, radius: 0.8, color: 0xaaaaaa, distance: 10 },
        { name: "Venus", mass: 2, radius: 1.2, color: 0xffcc00, distance: 15 },
        { name: "Earth", mass: 2, radius: 1.3, color: 0x0000ff, distance: 20 },
        { name: "Mars", mass: 1.5, radius: 1.0, color: 0xff0000, distance: 25 },
        { name: "Jupiter", mass: 50, radius: 3.5, color: 0xffaa00, distance: 40 },
        { name: "Saturn", mass: 40, radius: 3.0, color: 0xddcc99, distance: 55 },
        { name: "Uranus", mass: 20, radius: 2.0, color: 0x00ffff, distance: 70 },
        { name: "Neptune", mass: 20, radius: 2.0, color: 0x0000aa, distance: 85 },
        // Dwarf Planets
        { name: "Pluto", mass: 0.5, radius: 0.5, color: 0xdddddd, distance: 100 },
        { name: "Eris", mass: 0.6, radius: 0.6, color: 0xffffff, distance: 120 }
    ];

    planets.forEach(p => {
        const v = Math.sqrt((CONFIG.G * sun.mass) / p.distance);
        // Randomize start angle
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * p.distance;
        const z = Math.sin(angle) * p.distance;

        // Velocity perpendicular to position
        const vx = -Math.sin(angle) * v;
        const vz = Math.cos(angle) * v;

        const body = new Body(p.name, p.mass, p.radius, p.color, [x, 0, z], [vx, 0, vz]);
        state.bodies.push(body);

        // Atmosphere for Earth
        if (p.name === "Earth") {
            const atmoGeo = new THREE.SphereGeometry(p.radius * 1.2, 32, 32);
            const atmoMat = new THREE.MeshBasicMaterial({
                color: 0x00aaff,
                transparent: true,
                opacity: 0.2,
                side: THREE.BackSide
            });
            const atmo = new THREE.Mesh(atmoGeo, atmoMat);
            body.mesh.add(atmo);
        }

        // Rings for Saturn
        if (p.name === "Saturn") {
            const ringGeo = new THREE.RingGeometry(p.radius * 1.4, p.radius * 2.5, 32);
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0xaa8855,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.6
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2;
            body.mesh.add(ring);
        }

        // Add to UI
        const option = document.createElement('option');
        option.value = p.name;
        option.innerText = p.name;
        document.getElementById('camera-target').appendChild(option);

        // Orbit Line (Visual)
        const orbitGeo = new THREE.RingGeometry(p.distance - 0.05, p.distance + 0.05, 128);
        const orbitMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.1
        });
        const orbitMesh = new THREE.Mesh(orbitGeo, orbitMat);
        orbitMesh.rotation.x = Math.PI / 2;
        orbitMesh.visible = false; // Hidden by default
        orbitMesh.userData = { isOrbitLine: true };
        scene.add(orbitMesh);
    });

    // Moons (Simplified: Just Earth's Moon for now to test hierarchy/physics)
    // Moon orbits Earth. v_moon = v_earth + v_rel
    // v_rel = sqrt(G * M_earth / r_rel)
    const earth = state.bodies.find(b => b.name === "Earth");
    if (earth) {
        const rRel = 2.5;
        const vRel = Math.sqrt((CONFIG.G * earth.mass) / rRel);
        const moon = new Body("Moon", 0.1, 0.4, 0x888888,
            [earth.position.x + rRel, 0, earth.position.z],
            [earth.velocity.x, 0, earth.velocity.z + vRel] // Tangential velocity relative to Earth
        );
        state.bodies.push(moon);
    }
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
function updateCamera() {
    if (state.cameraTarget && state.cameraTarget !== "Free" && state.cameraTarget !== "Sun") {
        const targetBody = state.bodies.find(b => b.name === state.cameraTarget);
        if (targetBody) {
            // Keep relative offset or just look at it?
            // Simple chase: Look at target, keep camera at current distance but centered on target
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
    state.cameraTarget = e.target.value;
    if (state.cameraTarget === "Free") {
        // Optional: Reset controls or leave as is
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
    // Reset camera position to default
    camera.position.set(0, 20, 50);
    controls.target.set(0, 0, 0);
    controls.update();

    // Reset camera target dropdown to Free
    state.cameraTarget = "Free";
    document.getElementById('camera-target').value = "Free";
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
                state.bodies.push(state.spaceship);

                // Lock pointer for mouse control
                renderer.domElement.requestPointerLock();

                // Disable orbit controls
                controls.enabled = false;

                // Show HUD and Crosshair
                document.getElementById('pilot-hud').style.display = 'block';
                document.getElementById('crosshair').style.display = 'block';

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

    // Spaceship remains as a body in the simulation
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
        // Display speed (scaled for visual effect)
        const speed = state.spaceship.velocity.length() * 1000;
        speedDisplay.innerText = `${Math.floor(speed)} km/h`;
    }
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);

    // Update pilot controls if in pilot mode
    updatePilotControls();
    updateHUD();

    const dt = CONFIG.dt * state.timeScale;
    updatePhysics(dt);

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

