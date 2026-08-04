// ---------------------------------------------------------------------------
// Environment / atmosphere (modern-overhaul): physically-based renderer
// settings, an atmospheric-scattering sky with a real sun position, distance
// fog, and shadow-casting sunlight. All procedural — no image assets.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

// Late-afternoon sun angle: long shadows read dramatically without going
// full sunset-orange. Shared between the Sky shader and the light.
const SUN_ELEVATION_DEGREES = 32;
const SUN_AZIMUTH_DEGREES = 205;

export function configureRenderer(renderer) {
  // ACES filmic tone mapping is what gives modern engines their "graded"
  // look versus raw clamped RGB output.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

// Builds sky + fog + lights. Returns { sunLight } so the arena builder can
// re-fit the shadow camera when the arena size is known.
export function setupEnvironment(scene) {
  // --- Sky dome (three.js atmospheric scattering shader) ---
  const sky = new Sky();
  sky.scale.setScalar(2000);
  scene.add(sky);

  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 6;
  skyUniforms.rayleigh.value = 1.8;
  skyUniforms.mieCoefficient.value = 0.004;
  skyUniforms.mieDirectionalG.value = 0.8;

  const sunPosition = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEGREES);
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEGREES);
  sunPosition.setFromSphericalCoords(1, phi, theta);
  skyUniforms.sunPosition.value.copy(sunPosition);

  // --- Distance haze: softens far geometry like real outdoor air ---
  scene.fog = new THREE.Fog(0xb8c4cc, 40, 220);

  // --- Lights ---
  // Sky/ground bounce fill (cool sky, warm-ish dusty ground).
  const hemi = new THREE.HemisphereLight(0xbdd4e7, 0x6b655a, 0.85);
  scene.add(hemi);

  // The sun: warm directional key light with shadows.
  const sunLight = new THREE.DirectionalLight(0xfff1dd, 2.6);
  sunLight.position.copy(sunPosition).multiplyScalar(120);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 400;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);

  return { sunLight };
}

// Distant industrial silhouettes outside the arena walls so the horizon
// isn't an empty void — purely visual, no colliders (unreachable). Fog
// fades them naturally. Returns the meshes so main.js can dispose them
// when the arena is rebuilt at a different size.
export function buildSkyline(scene, groundHalf) {
  const meshes = [];
  const mat = new THREE.MeshStandardMaterial({
    color: 0x5c6166,
    roughness: 0.95,
    metalness: 0.05,
  });
  // Deterministic pseudo-random ring of "warehouse" blocks.
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const count = 26;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.15;
    const dist = groundHalf + 20 + rand() * 30;
    const w = 6 + rand() * 14;
    const h = 4 + rand() * 12;
    const d = 6 + rand() * 14;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(
      Math.cos(angle) * dist,
      h / 2,
      Math.sin(angle) * dist
    );
    mesh.rotation.y = rand() * Math.PI;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

// Fits the sun's orthographic shadow camera tightly around the current
// arena so shadow-map resolution isn't wasted (called from buildArena()).
export function fitSunShadowToArena(sunLight, groundHalf) {
  const extent = groundHalf + 8;
  const cam = sunLight.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.updateProjectionMatrix();
}
