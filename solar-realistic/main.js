import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const CONFIG = {
    G: 0.000015,
    dt: 0.05, // Reduced from 0.1 to 0.05 (Half speed)
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
    spawnMode: false,
    spaceship: null,
    keys: { w: false, s: false }
};

// --- Music Manager ---
class MusicManager {
    constructor() {
        this.audio = new Audio();
        this.simulatorTracks = [];
        this.pilotTracks = [];
        this.currentMode = 'simulator';
        this.currentPlaylist = [];
        this.currentIndex = 0;
        this.audio.volume = 0.3;
        this.isInitialized = false;

        this.audio.addEventListener('ended', () => this.playNext());
    }

    async loadTracks() {
        const simulatorFiles = await this.detectFiles('../music/simulator/');
        const pilotFiles = await this.detectFiles('../music/pilot/');

        this.simulatorTracks = simulatorFiles;
        this.pilotTracks = pilotFiles;

        console.log(`Loaded ${this.simulatorTracks.length} simulator tracks, ${this.pilotTracks.length} pilot tracks`);
        this.isInitialized = true;
    }

    async detectFiles(folder) {
        try {
            const response = await fetch(`${folder}manifest.json`);
            if (response.ok) {
                const manifest = await response.json();
                return manifest.files.map(f => `${folder}${f}`);
            }
        } catch (e) {
            console.log(`No manifest found for ${folder}`);
        }
        return [];
    }

    shuffle(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    switchMode(mode) {
        if (!this.isInitialized || this.currentMode === mode) return;

        this.currentMode = mode;
        const tracks = mode === 'pilot' ? this.pilotTracks : this.simulatorTracks;

        if (tracks.length === 0) {
            this.pause();
            return;
        }

        this.currentPlaylist = this.shuffle(tracks);
        this.currentIndex = 0;
        this.play();
    }

    play() {
        if (this.currentPlaylist.length === 0) return;
        this.audio.src = this.currentPlaylist[this.currentIndex];
        this.audio.play().catch(e => console.log('Audio requires user interaction'));
    }

    playNext() {
        this.currentIndex = (this.currentIndex + 1) % this.currentPlaylist.length;
        if (this.currentIndex === 0) {
            this.currentPlaylist = this.shuffle(this.currentPlaylist);
        }
        this.play();
    }

    pause() {
        this.audio.pause();
    }
}

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
    constructor(name, mass, radius, color, position, velocity, isStar = false, texturePath = null, rotationPeriod = 0) {
        this.name = name;
        this.mass = mass;
        this.radius = radius;
        this.position = new THREE.Vector3(...position);
        this.velocity = new THREE.Vector3(...velocity);
        this.isStar = isStar;
        this.force = new THREE.Vector3();

        // Calculate rotation speed
        // Base speed for Earth (period = 1) to rotate in 30s at dt=0.05 (60fps)
        // Speed = 0.07 rad/sim_unit
        const BASE_ROTATION_SPEED = 0.035; // Halved from 0.07
        this.rotationSpeed = rotationPeriod !== 0 ? BASE_ROTATION_SPEED / rotationPeriod : 0;

        // Mesh
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        let material;

        if (isStar) {
            const materialParams = { color: color };
            if (texturePath) {
                const textureLoader = new THREE.TextureLoader();
                textureLoader.crossOrigin = 'anonymous';
                const texture = textureLoader.load(texturePath);
                materialParams.map = texture;
                materialParams.color = 0xffffff; // White so texture shows true colors
            }
            material = new THREE.MeshBasicMaterial(materialParams);
        } else {
            const materialParams = { color: color };
            if (texturePath) {
                const textureLoader = new THREE.TextureLoader();
                textureLoader.crossOrigin = 'anonymous';
                const texture = textureLoader.load(texturePath);
                materialParams.map = texture;
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

        // Rotate planets (visual only)
        if (!body.isStar && body !== state.spaceship) {
            body.mesh.rotation.y += body.rotationSpeed * dt;

            // Rotate clouds if Earth
            if (body.name === "Earth" && body.cloudsMesh) {
                body.cloudsMesh.rotation.y += body.rotationSpeed * dt * 1.1; // Clouds rotate slightly faster
            }
        }
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
    uniforms: {
        glowColor: { value: new THREE.Color(0xffaa00) }, // Orange-Gold for better blend
        viewVector: { value: camera.position }
    },
    vertexShader: `
        uniform vec3 viewVector;
        varying float intensity;
        void main() {
            vec3 vNormal = normalize(normalMatrix * normal);
            vec3 vNormel = normalize(normalMatrix * viewVector);
            intensity = pow(0.6 - dot(vNormal, vNormel), 4.0);
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

// --- Keplerian Orbit Helper ---
function calculateOrbitalState(a, e, M, centralMass) {
    // 1. Solve Kepler's Equation: M = E - e * sin(E) for E (Eccentric Anomaly)
    // Newton-Raphson iteration
    let E = M;
    for (let i = 0; i < 10; i++) {
        const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
        E += dE;
        if (Math.abs(dE) < 1e-6) break;
    }

    // 2. Calculate Position in orbital plane (z is up in standard math, but we use y as up, so x, z plane)
    // Using P (perihelion) along X axis
    const x = a * (Math.cos(E) - e);
    const z = a * Math.sqrt(1 - e * e) * Math.sin(E);

    // 3. Calculate Velocity
    // r is distance from focus
    const r = a * (1 - e * Math.cos(E));
    const mu = CONFIG.G * centralMass;
    const vFactor = Math.sqrt(mu * a) / r;

    const vx = -vFactor * Math.sin(E);
    const vz = vFactor * Math.sqrt(1 - e * e) * Math.cos(E);

    return { pos: { x, z }, vel: { x: vx, z: vz } };
}

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

    const sun = new Body("Sun", sunMass, sunRadiusVisual, 0xffff00, [0, 0, 0], [0, 0, 0], true, "../textures/2k_sun.jpg", 27.0);
    // Make Sun texture almost transparent as requested
    sun.mesh.material.transparent = true;
    sun.mesh.material.opacity = 0.1;
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
            texture: "../textures/2k_mercury.jpg",
            rotationPeriod: 58.6
        },
        {
            name: "Venus", color: 0xffcc00,
            massRel: 14.77,
            radiusRel: 2.48,
            distRel: 1.86,
            eccentricity: 0.007,
            texture: "../textures/2k_venus_surface.jpg",
            rotationPeriod: -243
        },
        {
            name: "Earth", color: 0x0000ff,
            massRel: 18.10,
            radiusRel: 2.61,
            distRel: 2.58,
            eccentricity: 0.017,
            texture: "../textures/2k_earth_daymap.jpg",
            rotationPeriod: 1.0
        },
        {
            name: "Mars", color: 0xff0000,
            massRel: 1.95,
            radiusRel: 1.39,
            distRel: 3.94,
            eccentricity: 0.094,
            texture: "../textures/2k_mars.jpg",
            rotationPeriod: 1.03
        },
        {
            name: "Jupiter", color: 0xffaa00,
            massRel: 5756.0,
            radiusRel: 28.66,
            distRel: 13.44,
            eccentricity: 0.049,
            texture: "../textures/2k_jupiter.jpg",
            rotationPeriod: 0.41
        },
        {
            name: "Saturn", color: 0xddcc99,
            massRel: 1722.0,
            radiusRel: 23.87,
            distRel: 24.75,
            eccentricity: 0.057,
            texture: "../textures/2k_saturn.jpg",
            rotationPeriod: 0.45
        },
        {
            name: "Uranus", color: 0x00ffff,
            massRel: 263.0,
            radiusRel: 10.40,
            distRel: 49.60,
            eccentricity: 0.046,
            texture: "../textures/2k_uranus.jpg",
            rotationPeriod: -0.72
        },
        {
            name: "Neptune", color: 0x0000aa,
            massRel: 309.0,
            radiusRel: 10.09,
            distRel: 77.62,
            eccentricity: 0.011,
            texture: "../textures/2k_neptune.jpg",
            rotationPeriod: 0.67
        },
        {
            name: "Pluto", color: 0xdddddd,
            massRel: 0.04,
            radiusRel: 0.49,
            distRel: 101.5,
            eccentricity: 0.244,
            texture: "", // No texture for Pluto provided
            rotationPeriod: 6.39
        }
    ];

    planetData.forEach(p => {
        // Apply Scaling Factors
        const mass = p.massRel * SCALES.MASS;
        const radius = p.radiusRel * SCALES.RADIUS;
        const semiMajorAxis = p.distRel * SCALES.DISTANCE * SUN_VISUAL_SCALE;

        // Calculate Orbital State using Kepler's Equation for random starting position
        const meanAnomaly = Math.random() * Math.PI * 2; // Random start angle
        const { pos, vel } = calculateOrbitalState(semiMajorAxis, p.eccentricity, meanAnomaly, sunMass);

        const body = new Body(p.name, mass, radius, p.color, [pos.x, 0, pos.z], [vel.x, 0, vel.z], false, p.texture, p.rotationPeriod);
        state.bodies.push(body);

        // --- Visual Extras (Rings, Atmosphere) ---

        // Earth Atmosphere & Clouds
        if (p.name === "Earth") {
            // Atmosphere (Shader-based Glow)
            const atmoGeo = new THREE.SphereGeometry(radius * 1.2, 32, 32);
            const atmoMat = new THREE.ShaderMaterial({
                uniforms: {
                    glowColor: { value: new THREE.Color(0x00aaff) },
                    viewVector: { value: camera.position }
                },
                vertexShader: `
                    varying vec3 vNormal;
                    varying vec3 vViewPosition;
                    void main() {
                        vNormal = normalize(normalMatrix * normal);
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        vViewPosition = -mvPosition.xyz;
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform vec3 glowColor;
                    varying vec3 vNormal;
                    varying vec3 vViewPosition;
                    void main() {
                        vec3 normal = normalize(vNormal);
                        vec3 viewDir = normalize(vViewPosition);
                        float intensity = pow(0.6 - dot(normal, viewDir), 4.0);
                        gl_FragColor = vec4(glowColor, 1.0) * intensity;
                    }
                `,
                side: THREE.FrontSide, // FrontSide for halo effect
                blending: THREE.AdditiveBlending,
                transparent: true
            });
            body.mesh.add(new THREE.Mesh(atmoGeo, atmoMat));

            // Clouds (New)
            const cloudGeo = new THREE.SphereGeometry(radius * 1.02, 32, 32); // Slightly larger than Earth
            const textureLoader = new THREE.TextureLoader();
            const cloudTexture = textureLoader.load('../textures/2k_earth_clouds.jpg');
            const cloudMat = new THREE.MeshStandardMaterial({
                map: cloudTexture,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending, // Assumes black background for clouds
                side: THREE.DoubleSide
            });
            const cloudsMesh = new THREE.Mesh(cloudGeo, cloudMat);
            body.mesh.add(cloudsMesh);
            body.cloudsMesh = cloudsMesh; // Reference for rotation
        }

        // Saturn Rings (Scaled to new radius)
        if (p.name === "Saturn") {
            const ringGeo = new THREE.RingGeometry(radius * 1.4, radius * 2.5, 64);
            const textureLoader = new THREE.TextureLoader();
            const ringTexture = textureLoader.load('../textures/2k_saturn_ring_alpha.png');

            // Adjust UVs for ring texture (planar mapping)
            const pos = ringGeo.attributes.position;
            const v3 = new THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
                v3.fromBufferAttribute(pos, i);
                ringGeo.attributes.uv.setXY(i, v3.length() < (radius * 1.95) ? 0 : 1, 1);
            }

            const ringMat = new THREE.MeshBasicMaterial({
                map: ringTexture,
                color: 0xaa8855,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.8
            });
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
        state.spaceship.currentThrust = Math.min(state.spaceship.currentThrust + 0.05, state.spaceship.maxThrust);
    } else if (state.keys.s) {
        state.spaceship.currentThrust = Math.max(state.spaceship.currentThrust - 0.05, -state.spaceship.maxThrust * 0.5);
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
        waitingForShipPlacement = true; // Prevent body spawning while placing ship

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
                    0.005, // Tiny radius (100x smaller than Mercury)
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

                // Switch camera to pilot mode
                // We don't change cameraTarget to "Spaceship" because we handle pilot camera manually in animate()
                // But we can reset the dropdown
                document.getElementById('camera-target').value = "Free";
                state.cameraTarget = "Free";

                pilotModeBtn.innerText = "Exit Pilot Mode";
                pilotModeBtn.style.background = "#ff4444";
                pilotInstructions.innerText = "WASD to Move | Mouse to Steer | ESC to unlock mouse";

                // Show crosshair
                crosshair.style.display = 'block';
                crosshairH.style.display = 'block';

                // Request pointer lock
                renderer.domElement.requestPointerLock();
                musicManager.switchMode('pilot');

                // No longer waiting for ship placement
                waitingForShipPlacement = false;

                // Remove this event listener
                renderer.domElement.removeEventListener('click', placeShip);
            }
        };

        renderer.domElement.addEventListener('click', placeShip);

    } else {
        // Exit pilot mode
        state.pilotMode = false;
        if (state.spaceship) {
            // Remove spaceship
            scene.remove(state.spaceship.mesh);
            scene.remove(state.spaceship.trailLine);
            scene.remove(state.spaceship.nameSprite);
            state.bodies = state.bodies.filter(b => b !== state.spaceship);
            state.spaceship = null;
        }

        pilotModeBtn.innerText = "Launch Pilot Mode";
        pilotModeBtn.style.background = "#00cc00";
        pilotInstructions.style.display = "none";
        pilotInstructions.innerText = "Click anywhere to spawn ship";

        // Hide crosshair
        crosshair.style.display = 'none';
        crosshairH.style.display = 'none';

        // Exit pointer lock
        if (document.pointerLockElement === renderer.domElement) {
            document.exitPointerLock();
            musicManager.switchMode('simulator');
        }

        // Reset camera
        camera.position.set(-2000, 1000, -4000);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();
    }
});

// --- Spawn Mode Toggle ---
const spawnModeBtn = document.getElementById('spawn-btn');

spawnModeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.spawnMode = !state.spawnMode;

    if (state.spawnMode) {
        spawnModeBtn.innerText = "Exit Spawn Mode";
        spawnModeBtn.style.background = "#ff4444";
        controls.enabled = false; // Disable camera controls
    } else {
        spawnModeBtn.innerText = "Spawn (Click & Drag)";
        spawnModeBtn.style.background = ""; // Reset to default
        controls.enabled = true; // Enable camera controls
    }
});

// Keyboard controls for spaceship
window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'W') state.keys.w = true;
    if (e.key === 's' || e.key === 'S') state.keys.s = true;
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'W') state.keys.w = false;
    if (e.key === 's' || e.key === 'S') state.keys.s = false;
});

// ESC to exit pointer lock
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.pilotMode && document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
    }
});

// Mouse movement for steering
window.addEventListener('mousemove', (e) => {
    if (state.pilotMode && state.spaceship) {
        const sensitivity = 0.002;
        const deltaX = e.movementX * sensitivity;
        const deltaY = e.movementY * sensitivity;

        // Invert Y for natural flight controls (up = pitch up) -> Actually user requested NO inversion
        // So up mouse = pitch up (negative rotation around X axis)
        state.spaceship.rotate(-deltaX, -deltaY);
    }
});

// --- Body Spawner with Drag for Velocity ---
let waitingForShipPlacement = false; // Track if we're waiting to place ship
let spawnStartPos = null;
let spawnStartScreen = null;
let isDraggingSpawn = false;
let velocityArrow = null;

renderer.domElement.addEventListener('mousedown', (e) => {
    // Don't spawn if in pilot mode with spaceship already placed
    if (state.pilotMode && state.spaceship) return;
    // Don't spawn if waiting to place ship
    if (waitingForShipPlacement) return;
    if (e.button === 2) return; // Don't spawn on right-click
    if (e.button !== 0) return; // Only left click

    // Only spawn if in Spawn Mode
    if (!state.spawnMode) return;

    // Calculate spawn position on ecliptic plane
    const pointer = new THREE.Vector2();
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(spawnPlane, target)) {
        spawnStartPos = target.clone();
        spawnStartScreen = { x: e.clientX, y: e.clientY };
        isDraggingSpawn = true;

        // Camera controls are already disabled in Spawn Mode

        // Create arrow helper for visualization
        const dir = new THREE.Vector3(0, 0, 1);
        const origin = target;
        const length = 1;
        const hex = 0x00ff00;
        velocityArrow = new THREE.ArrowHelper(dir, origin, length, hex, 0.5, 0.3);
        scene.add(velocityArrow);
    }
});

renderer.domElement.addEventListener('mousemove', (e) => {
    if (!isDraggingSpawn || !spawnStartPos) return;

    // Calculate current position
    const pointer = new THREE.Vector2();
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const currentPos = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(spawnPlane, currentPos)) {
        // Update arrow
        const direction = new THREE.Vector3().subVectors(currentPos, spawnStartPos);
        const length = direction.length();
        if (length > 0.1) {
            direction.normalize();
            velocityArrow.setDirection(direction);
            velocityArrow.setLength(length, 0.5, 0.3);
        }
    }
});

renderer.domElement.addEventListener('mouseup', (e) => {
    if (!isDraggingSpawn || !spawnStartPos) return;
    if (e.button !== 0) return;

    // Calculate velocity from drag
    const pointer = new THREE.Vector2();
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const endPos = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(spawnPlane, endPos)) {
        // Calculate velocity (scale factor for reasonable speeds)
        const velocityVector = new THREE.Vector3().subVectors(endPos, spawnStartPos);
        const velocityScale = 0.1; // Adjust this to change how fast spawned bodies move
        const vx = velocityVector.x * velocityScale;
        const vz = velocityVector.z * velocityScale;

        // Spawn the body
        const mass = 10;
        const radius = 2;
        const color = Math.random() * 0xffffff;

        const body = new Body(
            `Body${state.bodies.length}`,
            mass,
            radius,
            color,
            [spawnStartPos.x, 0, spawnStartPos.z],
            [vx, 0, vz],
            false,
            null,
            1.0
        );
        state.bodies.push(body);
        console.log('Spawned body with velocity:', vx, vz);
    }

    // Clean up
    if (velocityArrow) {
        scene.remove(velocityArrow);
        velocityArrow = null;
    }
    isDraggingSpawn = false;
    spawnStartPos = null;
    spawnStartScreen = null;

    // Do NOT re-enable camera controls here, as we are in Spawn Mode
});

// --- HUD ---
const hudDiv = document.createElement('div');
hudDiv.id = 'hud';
hudDiv.style.position = 'absolute';
hudDiv.style.bottom = '20px';
hudDiv.style.left = '50%';
hudDiv.style.transform = 'translateX(-50%)';
hudDiv.style.color = '#00ff00';
hudDiv.style.fontFamily = 'monospace';
hudDiv.style.fontSize = '24px';
hudDiv.style.textAlign = 'center';
hudDiv.style.pointerEvents = 'none';
hudDiv.style.textShadow = '0 0 5px #00ff00';
hudDiv.style.display = 'none'; // Hidden by default
document.body.appendChild(hudDiv);

// --- Crosshair ---
const crosshair = document.createElement('div');
crosshair.id = 'crosshair';
crosshair.style.position = 'absolute';
crosshair.style.top = '50%';
crosshair.style.left = '50%';
crosshair.style.width = '4px';
crosshair.style.height = '20px';
crosshair.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
crosshair.style.transform = 'translate(-50%, -50%)';
crosshair.style.pointerEvents = 'none';
crosshair.style.display = 'none';
document.body.appendChild(crosshair);

const crosshairH = document.createElement('div');
crosshairH.style.position = 'absolute';
crosshairH.style.top = '50%';
crosshairH.style.left = '50%';
crosshairH.style.width = '20px';
crosshairH.style.height = '4px';
crosshairH.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
crosshairH.style.transform = 'translate(-50%, -50%)';
crosshairH.style.pointerEvents = 'none';
crosshairH.style.display = 'none';
document.body.appendChild(crosshairH);

function updateHUD() {
    if (!state.pilotMode || !state.spaceship) {
        // Hide pilot HUD when not in pilot mode
        const pilotHud = document.getElementById('pilot-hud');
        if (pilotHud) pilotHud.style.display = 'none';

        // Hide relativistic effects
        const vignette = document.getElementById('speed-vignette');
        const blueShift = document.getElementById('blue-shift');
        const motionBlur = document.getElementById('motion-blur');
        if (vignette) vignette.style.display = 'none';
        if (blueShift) blueShift.style.display = 'none';
        if (motionBlur) motionBlur.style.display = 'none';

        // Hide star streaks
        if (starStreaks) starStreaks.visible = false;
        return;
    }

    // Show pilot HUD
    const pilotHud = document.getElementById('pilot-hud');
    if (pilotHud) pilotHud.style.display = 'block';

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

const musicManager = new MusicManager();
musicManager.loadTracks();

// Start music on first user interaction
let musicStarted = false;
document.addEventListener('click', () => {
    if (!musicStarted && musicManager.isInitialized) {
        musicManager.switchMode('simulator');
        musicStarted = true;
    }
}, { once: true });

// --- Initialization ---
initSolarSystem();

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

animate();
