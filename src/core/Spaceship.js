import * as THREE from 'three';
import { Body } from './Body.js';

/**
 * Spaceship class for pilot mode
 * @param {object} scene - THREE.js scene
 */
export class Spaceship extends Body {
    constructor(scene, name, mass, radius, color, position, velocity, maxThrust) {
        super(scene, name, mass, radius, color, position, velocity, false);

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
