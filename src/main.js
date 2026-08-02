// ---------------------------------------------------------------------------
// Milestone 2: First-person movement.
// WASD to move, mouse to look, Space to jump, colliding with the ground and
// boundary walls via Rapier's character controller.
//
// NOT built yet (later milestones):
// - No click-to-play/pause overlay, no Escape handling, no focus-loss
//   handling - just a minimal pointer-lock click prompt for now (2.5).
// - No arena obstacles/platforms, no crouch (3 and 7).
// - No shooting, health, bots (4-5).
// ---------------------------------------------------------------------------

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

// -----------------------------------------------------------------------
// Three.js setup: scene, camera, renderer
// -----------------------------------------------------------------------

const scene = new THREE.Scene();

// A flat sky-blue background color. This is a placeholder "simple
// background" for now - a skybox/skydome can replace this later in polish.
scene.background = new THREE.Color(0x87ceeb);

// PerspectiveCamera(fieldOfView, aspectRatio, nearClip, farClip).
// 75 degrees FOV is a common, comfortable default for FPS-style games.
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

// Three.js's default rotation order (XYZ) causes the camera to tilt/roll
// oddly once you combine looking up/down with looking left/right. "YXZ"
// (yaw applied before pitch) is the standard fix for FPS-style cameras.
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

// Append the renderer's <canvas> into the #app div from index.html.
document.getElementById("app").appendChild(renderer.domElement);

// Keep the camera/renderer in sync with the browser window size.
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// -----------------------------------------------------------------------
// Lighting
// -----------------------------------------------------------------------
// Without any light, MeshStandardMaterial surfaces render pure black, so we
// add a couple of simple lights to make the ground plane visible.

// Soft light from the "sky" (blue-ish) and "ground" (brownish) - gives
// gentle all-over illumination without needing shadows yet.
const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x444422, 1.2);
scene.add(hemisphereLight);

// A directional light acts like sunlight, giving surfaces some shading.
const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.position.set(10, 20, 10);
scene.add(sunLight);

// -----------------------------------------------------------------------
// Ground plane (visual)
// -----------------------------------------------------------------------

const GROUND_SIZE = 50;

const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x3a7d44 });
const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
// PlaneGeometry is created flat in the XY plane (facing the camera by
// default), so we rotate it -90 degrees around X to lay it flat on the
// ground (the XZ plane) like a floor.
groundMesh.rotation.x = -Math.PI / 2;
scene.add(groundMesh);

// -----------------------------------------------------------------------
// Boundary walls (visual)
// -----------------------------------------------------------------------
// Just enough of a wall around the edges of the ground to test wall
// collision this milestone. Milestone 3 replaces/extends this with the
// actual designed arena and interior obstacles.

const WALL_HEIGHT = 3;
const WALL_THICKNESS = 1;
const GROUND_HALF = GROUND_SIZE / 2;

// North/south walls span the full width (including the corners), and
// east/west walls fit snugly between them, so there are no corner gaps.
// { hx, hz } are half-extents (Rapier/box-geometry convention), { x, z }
// is the center position of the wall.
const wallDefs = [
  {
    hx: GROUND_HALF + WALL_THICKNESS,
    hz: WALL_THICKNESS / 2,
    x: 0,
    z: -(GROUND_HALF + WALL_THICKNESS / 2),
  }, // north
  {
    hx: GROUND_HALF + WALL_THICKNESS,
    hz: WALL_THICKNESS / 2,
    x: 0,
    z: GROUND_HALF + WALL_THICKNESS / 2,
  }, // south
  {
    hx: WALL_THICKNESS / 2,
    hz: GROUND_HALF,
    x: -(GROUND_HALF + WALL_THICKNESS / 2),
    z: 0,
  }, // west
  {
    hx: WALL_THICKNESS / 2,
    hz: GROUND_HALF,
    x: GROUND_HALF + WALL_THICKNESS / 2,
    z: 0,
  }, // east
];

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
for (const wall of wallDefs) {
  const wallGeometry = new THREE.BoxGeometry(
    wall.hx * 2,
    WALL_HEIGHT,
    wall.hz * 2
  );
  const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
  wallMesh.position.set(wall.x, WALL_HEIGHT / 2, wall.z);
  scene.add(wallMesh);
}

// -----------------------------------------------------------------------
// Input handling: keyboard state + mouse look + pointer lock
// -----------------------------------------------------------------------

// Tracks which keys are currently held down, keyed by event.code (layout-
// independent, e.g. "KeyW" is always the key in the W position).
const keysPressed = {};
window.addEventListener("keydown", (event) => {
  keysPressed[event.code] = true;
  // Stop Space from scrolling the page - there's nothing to scroll since
  // the page is a fixed full-screen canvas, but this avoids surprises.
  if (event.code === "Space") event.preventDefault();
});
window.addEventListener("keyup", (event) => {
  keysPressed[event.code] = false;
});

// Camera look angles, updated by mouse movement below and applied to the
// camera each frame in the render loop.
let yaw = 0;
let pitch = 0;
const MOUSE_SENSITIVITY = 0.0022;
// Clamp pitch so you can't look past straight up/down and flip the camera.
const PITCH_LIMIT = Math.PI / 2 - 0.01;

// Minimal pointer lock: click the canvas to lock the mouse cursor and start
// steering the camera with mouse movement. There's no pause/resume overlay
// or Escape handling yet (that's Milestone 2.5) - pressing Escape just lets
// the browser release the lock natively, and the hint text below reappears
// until you click again.
const pointerLockHint = document.getElementById("pointer-lock-hint");

renderer.domElement.addEventListener("click", () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  const isLocked = document.pointerLockElement === renderer.domElement;
  pointerLockHint.classList.toggle("hidden", isLocked);
});

document.addEventListener("mousemove", (event) => {
  // Ignore mouse movement while not pointer-locked, otherwise the camera
  // would spin whenever the mouse merely passes over the page.
  if (document.pointerLockElement !== renderer.domElement) return;

  yaw -= event.movementX * MOUSE_SENSITIVITY;
  pitch -= event.movementY * MOUSE_SENSITIVITY;
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
});

// -----------------------------------------------------------------------
// Player movement tuning constants
// -----------------------------------------------------------------------

const PLAYER_RADIUS = 0.4;
// Half-height of just the capsule's cylindrical middle section (not
// counting the rounded caps), so total capsule height = 2 * (half + radius).
const PLAYER_HALF_HEIGHT = 0.6;
// How far above the capsule's center point the camera sits (roughly eye
// level, a bit below the very top of the capsule).
const EYE_HEIGHT = 0.8;

const MOVE_SPEED = 5; // meters/second
const JUMP_SPEED = 6; // initial upward velocity, in meters/second
// A bit stronger than real-world gravity (9.81) for a snappier game feel -
// common in shooters so jumps don't feel floaty.
const GRAVITY = 20;
// Cap how large a single frame's delta-time can be (e.g. if the tab was
// backgrounded and just regained focus) to avoid the player tunneling
// through geometry in one huge simulated step.
const MAX_DELTA_TIME = 1 / 30;

// -----------------------------------------------------------------------
// Rapier physics setup
// -----------------------------------------------------------------------
// rapier3d-compat ships its physics engine as a WASM module, which has to
// be loaded asynchronously before we can use any RAPIER classes. That's why
// all of the physics setup below happens inside this async function instead
// of directly at the top level of the file.

async function initPhysics() {
  await RAPIER.init();

  // Standard downward gravity, matching Earth-ish scale (units are meters).
  // Note: this is Rapier's own built-in gravity, which only affects dynamic
  // rigid bodies. Our player is a *kinematic* body (see below), so it isn't
  // affected by this - we apply our own gravity to it manually instead.
  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  const world = new RAPIER.World(gravity);

  // A static collider matching the ground plane. Colliders don't need a
  // parent rigid body if they never move - Rapier treats "no parent" as
  // fixed in place, which is all the ground needs.
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
    GROUND_SIZE / 2,
    0.1, // thin slab instead of an infinitely-flat plane
    GROUND_SIZE / 2
  );
  world.createCollider(groundColliderDesc);

  // Boundary wall colliders, matching the wall meshes created above.
  for (const wall of wallDefs) {
    const wallColliderDesc = RAPIER.ColliderDesc.cuboid(
      wall.hx,
      WALL_HEIGHT / 2,
      wall.hz
    ).setTranslation(wall.x, WALL_HEIGHT / 2, wall.z);
    world.createCollider(wallColliderDesc);
  }

  // The player is a "kinematic" rigid body: we move it ourselves each frame
  // (via setNextKinematicTranslation) instead of letting Rapier's forces
  // push it around like a normal dynamic object. This gives precise,
  // responsive FPS-style control instead of physics-y/bouncy movement.
  const playerBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    0,
    3, // spawn above the ground so it visibly settles down on load
    5
  );
  const playerBody = world.createRigidBody(playerBodyDesc);
  const playerColliderDesc = RAPIER.ColliderDesc.capsule(
    PLAYER_HALF_HEIGHT,
    PLAYER_RADIUS
  );
  const playerCollider = world.createCollider(playerColliderDesc, playerBody);

  // Rapier's character controller does the hard work of colliding-and-
  // sliding the player capsule against the world (ground, walls, etc.) so
  // we don't have to hand-roll any collision detection ourselves. The
  // small number here is a tiny gap kept between the player and obstacles,
  // needed for numerical stability.
  const characterController = world.createCharacterController(0.01);

  return { world, playerBody, playerCollider, characterController };
}

// -----------------------------------------------------------------------
// Main render/physics loop
// -----------------------------------------------------------------------

function startRenderLoop({ world, playerBody, playerCollider, characterController }) {
  // THREE.Timer is the modern replacement for the older THREE.Clock -
  // update() must be called once per frame (with the requestAnimationFrame
  // timestamp) before getDelta() returns the correct value.
  const timer = new THREE.Timer();
  // Vertical speed accumulated by gravity/jumping. Positive = moving up.
  let verticalVelocity = 0;

  function computeHorizontalMovement(deltaTime) {
    // Read WASD as a simple -1/0/1 input vector, "forward"/"right" relative
    // to the player (not world axes yet).
    let inputForward = 0;
    let inputRight = 0;
    if (keysPressed["KeyW"]) inputForward += 1;
    if (keysPressed["KeyS"]) inputForward -= 1;
    if (keysPressed["KeyD"]) inputRight += 1;
    if (keysPressed["KeyA"]) inputRight -= 1;

    // Normalize so diagonal movement (e.g. W+D) isn't faster than moving
    // in a single direction.
    const inputLength = Math.hypot(inputForward, inputRight);
    if (inputLength > 0) {
      inputForward /= inputLength;
      inputRight /= inputLength;
    }

    // Rotate the input by the camera's yaw so "forward" always means "the
    // direction the player is looking", not a fixed world direction.
    // (Three.js's camera faces -Z at yaw = 0, which is where these
    // forward/right vectors come from.)
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const worldX = inputForward * -sinYaw + inputRight * cosYaw;
    const worldZ = inputForward * -cosYaw + inputRight * -sinYaw;

    return {
      x: worldX * MOVE_SPEED * deltaTime,
      z: worldZ * MOVE_SPEED * deltaTime,
    };
  }

  function tick(timestamp) {
    timer.update(timestamp);
    const deltaTime = Math.min(timer.getDelta(), MAX_DELTA_TIME);

    // computedGrounded() reflects the result of *last* frame's movement
    // computation. Using it to decide this frame's gravity/jump is a
    // one-frame-old check, but the delay is imperceptible in practice and
    // it's the standard approach for Rapier's character controller.
    if (characterController.computedGrounded()) {
      // Small constant downward speed (instead of 0) keeps the character
      // pressed against the floor so the "grounded" check stays true,
      // rather than flickering true/false due to tiny floating gaps.
      verticalVelocity = keysPressed["Space"] ? JUMP_SPEED : -0.5;
    } else {
      verticalVelocity -= GRAVITY * deltaTime;
    }

    const horizontal = computeHorizontalMovement(deltaTime);
    const desiredTranslation = {
      x: horizontal.x,
      y: verticalVelocity * deltaTime,
      z: horizontal.z,
    };

    characterController.computeColliderMovement(
      playerCollider,
      desiredTranslation
    );
    const correctedMovement = characterController.computedMovement();

    const currentPosition = playerBody.translation();
    playerBody.setNextKinematicTranslation({
      x: currentPosition.x + correctedMovement.x,
      y: currentPosition.y + correctedMovement.y,
      z: currentPosition.z + correctedMovement.z,
    });

    world.step();

    // Follow the player's new (post-collision) position with the camera.
    const playerPosition = playerBody.translation();
    camera.position.set(
      playerPosition.x,
      playerPosition.y + EYE_HEIGHT,
      playerPosition.z
    );
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
}

initPhysics()
  .then((physics) => startRenderLoop(physics))
  .catch((error) => {
    console.error("Failed to initialize Rapier physics:", error);
  });
