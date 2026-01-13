import * as THREE from 'three';
import { BASE_ROTATION_SPEED } from '../config/constants.js';

/**
 * Body class represents a celestial body in the simulation
 * @param {object} scene - THREE.js scene to add body to
 */
export class Body {
    constructor(scene, name, mass, radius, color, position, velocity, isStar = false, texturePath = null, rotationPeriod = 0) {
        this.name = name;
        this.mass = mass;
        this.radius = radius;
        this.position = new THREE.Vector3(...position);
        this.velocity = new THREE.Vector3(...velocity);
        this.isStar = isStar;
        this.force = new THREE.Vector3();

        // Calculate rotation speed
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
