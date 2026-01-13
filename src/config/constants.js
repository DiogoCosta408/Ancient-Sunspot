// Configuration constants for the solar system simulator

export const CONFIG = {
    G: 0.000015,
    dt: 0.05, // Reduced from 0.1 to 0.05 (Half speed)
    softening: 0.1,
    shadowMapSize: 2048 // Shadow map size
};

export const SCALES = {
    MASS: 1.0,      // 1 unit mass = 1 Mercury Mass
    RADIUS: 0.5,    // 1 unit radius = 0.5 World Units (Visual size)
    DISTANCE: 30.0, // 1 unit distance (Mercury Orbit) = 30 World Units
};

export const SUN_VISUAL_SCALE = 285;

export const BASE_ROTATION_SPEED = 0.035; // Halved from 0.07
