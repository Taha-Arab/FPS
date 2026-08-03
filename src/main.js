// ---------------------------------------------------------------------------
// Milestone 2: First-person movement (WASD to move, mouse to look, Space to
// jump, colliding with the ground and boundary walls via Rapier's character
// controller).
//
// Milestone 2.5: Click-to-play / pause overlay. The game starts paused, and
// pauses again on Escape, on losing pointer lock, or on losing window/tab
// focus - simulation is fully frozen while paused so nothing moves or falls
// while the player can't see/control it, and clicking the overlay always
// reliably resumes.
//
// Milestone 3: Arena with obstacles. The arena is sized per the 1v1/3v3/5v5
// scaling rule (defaulting to "1v1"/small since there's no pre-match menu
// yet), plus a varied mix of boxes/pillars/a ramp laid out for competitive
// flow (chokepoints, broken sightlines, mixed cover density) rather than
// an even grid - no jump-on-top/walk-under platforms yet (Milestone 7).
//
// NOT built yet (later milestones):
// - No platforms or crouch yet (7).
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

// Arena size (meters) per the team-size scaling rule in AGENTS.md. There's
// no pre-match menu yet (Milestone 9 adds one) - default to the smallest
// (1v1) size for now; Milestone 9 will pick one of these based on the
// player's menu selection instead of always using "1v1".
const ARENA_SIZES = { "1v1": 30, "3v3": 45, "5v5": 60 };
const GROUND_SIZE = ARENA_SIZES["1v1"];

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
// These were added back in Milestone 2 just to test wall collision, but
// since they're computed from GROUND_SIZE they already scale correctly
// with the arena sizing above, so Milestone 3 reuses them as-is and just
// adds interior obstacles alongside them (below).

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
// Interior obstacles (visual)
// -----------------------------------------------------------------------
// Laid out for competitive flow, not just visual variety - modeled loosely
// on small symmetric shooter maps (think COD's "Shipment"-style close
// combat): no sightline should reach across the whole arena unbroken, a
// couple of chokepoints funnel movement instead of one open field, and
// obstacle density varies by area (tighter cover in firefight pockets,
// sparser in movement lanes) rather than being spaced evenly. Still just
// plain solid shapes, no jump-on-top/walk-under "platforms" yet (Milestone
// 7 adds that mechanic - see the note there about reusing these).
//
// The player spawns at (0, _, 5) (see playerBodyDesc below). There's no
// enemy bot yet (Milestone 5 adds one), but we reserve a mirrored clear
// spot at (0, _, -5) for its future spawn now, so this layout won't need
// reworking later just to make room for it.

// Box obstacles. { hx, hy, hz } are half-extents, { x, z } is the center
// position (each rests on the ground, so its world Y position is just its
// own half-height).
const boxObstacleDefs = [
  // Center chokepoint: a tall wall split into two halves with a ~2.4m gap
  // between them. This is the main sightline-breaker - it blocks the long
  // spawn-to-spawn view straight down the middle of the arena, and the gap
  // is the single narrow lane through it (players can also go around
  // either end, but that means giving up the direct route).
  { hx: 0.6, hy: 1.5, hz: 3.5, x: -1.8, z: 0 }, // chokepoint, west half
  { hx: 0.6, hy: 1.5, hz: 3.5, x: 1.8, z: 0 }, // chokepoint, east half

  // West side: a tighter, cover-heavy lane for close firefights. This
  // crate pairs with the west pillar below - the gap between them forms a
  // second, narrower chokepoint on this flank.
  { hx: 1.1, hy: 1.0, hz: 1.0, x: -9, z: 5 }, // crate
  { hx: 1.2, hy: 0.8, hz: 1.2, x: -7, z: -9 }, // crate, far side

  // East side: kept sparser than the west - an open lane for repositioning
  // instead of matching cover-for-cover (a mirrored layout was the exact
  // "too uniform" problem from before).
  { hx: 0.5, hy: 0.9, hz: 2.2, x: 8, z: -6 }, // lone wall segment

  // Minor cover near the far spawn area (kept well clear of the actual
  // spawn point) so that end of the map isn't completely bare.
  { hx: 2.0, hy: 0.5, hz: 0.5, x: 4, z: -12 }, // low wall

  // Light cover on the direct approach to the chokepoint from each spawn -
  // enough to duck behind mid-fight, not enough to block the spawn itself.
  { hx: 0.9, hy: 0.7, hz: 0.9, x: 4, z: 3 }, // near player's spawn side
];

// Pillar obstacles: round cover, a shape boxes alone can't give. Cylinders
// are Y-axis-aligned by default in both Three.js and Rapier, so no
// rotation is needed. { height } is the FULL height (not a half-extent),
// and they rest on the ground the same way as the boxes above.
const pillarObstacleDefs = [
  // Paired with the west crate above: the ~2m gap between them is a
  // second, narrower chokepoint on the west flank.
  { radius: 0.6, height: 2.2, x: -5.3, z: 5 },
  // East flank kept deliberately sparse (see the box comment above) -
  // just one pillar, far out, for a bit of cover without closing the lane.
  { radius: 0.5, height: 2.4, x: 11, z: 6 },
  // Light cover near the chokepoint's east exit, giving a spot to hold an
  // angle after passing through without blocking the passage itself.
  { radius: 0.55, height: 2.6, x: 5, z: -1 },
  // Mirrors the "light cover near spawn approach" role from the box list
  // above, but on the far side and using a different shape - keeps the
  // two ends functionally balanced without looking like a mirrored copy.
  { radius: 0.5, height: 2.0, x: -4, z: -3 },
];

// Ramp obstacle: a box tilted around the X axis so one edge rises off the
// ground. ~15 degrees is comfortably under Rapier's default max climbable
// slope (45 degrees), so the character controller walks straight up it
// with no extra configuration. Simplification: rotating a box around its
// own center means its low edge dips slightly below y = 0 - harmless here
// since it only overlaps the (also static, non-moving) ground collider,
// and the dip is hidden underneath the ramp's own mesh.
const rampObstacleDef = {
  hx: 1.8,
  hy: 0.3,
  hz: 2.5,
  x: -5,
  z: 10,
  tiltRadians: 0.26, // ~15 degrees
};

// A distinct crate-like color (vs. the neutral grey boundary walls) so
// obstacles read as separate, purpose-placed cover at a glance. Shared by
// every obstacle shape below to keep the greybox look consistent.
const obstacleMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6d3f });

for (const box of boxObstacleDefs) {
  const boxGeometry = new THREE.BoxGeometry(
    box.hx * 2,
    box.hy * 2,
    box.hz * 2
  );
  const boxMesh = new THREE.Mesh(boxGeometry, obstacleMaterial);
  boxMesh.position.set(box.x, box.hy, box.z);
  scene.add(boxMesh);
}

for (const pillar of pillarObstacleDefs) {
  // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments) -
  // equal top/bottom radius gives a plain cylinder rather than a cone.
  const pillarGeometry = new THREE.CylinderGeometry(
    pillar.radius,
    pillar.radius,
    pillar.height,
    12
  );
  const pillarMesh = new THREE.Mesh(pillarGeometry, obstacleMaterial);
  pillarMesh.position.set(pillar.x, pillar.height / 2, pillar.z);
  scene.add(pillarMesh);
}

const rampGeometry = new THREE.BoxGeometry(
  rampObstacleDef.hx * 2,
  rampObstacleDef.hy * 2,
  rampObstacleDef.hz * 2
);
const rampMesh = new THREE.Mesh(rampGeometry, obstacleMaterial);
rampMesh.position.set(rampObstacleDef.x, rampObstacleDef.hy, rampObstacleDef.z);
rampMesh.rotation.x = rampObstacleDef.tiltRadians;
scene.add(rampMesh);

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

// -----------------------------------------------------------------------
// Pause state + click-to-play/resume overlay (Milestone 2.5)
// -----------------------------------------------------------------------
// The game starts paused (isPaused = true) and stays paused until the
// player clicks the overlay and pointer lock is granted. It pauses again
// any time pointer lock is lost - whether from pressing Escape, the browser
// force-releasing it, or our own focus-loss handling below - so there's a
// single source of truth for "is the game actually playable right now".

let isPaused = true;
// Tracks whether the player has ever successfully entered play, just so we
// can show a different overlay title ("Click to Play" vs "Paused") without
// needing two separate overlay elements.
let hasPlayedBefore = false;

const pauseOverlay = document.getElementById("pause-overlay");
const pauseOverlayTitle = document.getElementById("pause-overlay-title");

function showPauseOverlay() {
  isPaused = true;
  pauseOverlayTitle.textContent = hasPlayedBefore
    ? "Paused \u2014 Click to Resume"
    : "Click to Play";
  pauseOverlay.classList.remove("hidden");

  // Release any keys that were held down when we paused. Without this, if
  // the player is holding W and then alt-tabs away, "KeyW" would stay true
  // forever (the keyup event never fires while the tab isn't focused), so
  // resuming would have the player silently walking forward.
  for (const key in keysPressed) {
    keysPressed[key] = false;
  }
}

function hidePauseOverlay() {
  isPaused = false;
  hasPlayedBefore = true;
  pauseOverlay.classList.add("hidden");
}

// Chrome (and some other browsers) enforce a short "cooldown" - roughly
// 1-2 seconds - before allowing pointer lock to be re-requested right after
// Escape releases it. This is a browser anti-abuse measure we can't bypass,
// but without handling it, a click during the cooldown just silently fails
// (see pointerlockerror below), making the game feel stuck/unresponsive.
// We fix that by quietly retrying in the background every 150ms until it
// succeeds, so the single click the player already made "sticks" the
// instant the browser allows it, instead of requiring a second click.
let lockRetryTimeoutId = null;

function clearLockRetry() {
  if (lockRetryTimeoutId !== null) {
    clearTimeout(lockRetryTimeoutId);
    lockRetryTimeoutId = null;
  }
}

// Clicking the overlay is the only way to (re-)request pointer lock. Once
// locked, the overlay is hidden, so this listener simply can't fire again
// until we're paused - no risk of accidentally re-requesting an active lock.
pauseOverlay.addEventListener("click", () => {
  clearLockRetry();
  renderer.domElement.requestPointerLock();
});

// This single handler covers every way pointer lock can be gained or lost:
// clicking the overlay (locked), pressing Escape (browser releases the lock
// natively), and our own document.exitPointerLock() calls below.
document.addEventListener("pointerlockchange", () => {
  const isLocked = document.pointerLockElement === renderer.domElement;
  if (isLocked) {
    clearLockRetry();
    hidePauseOverlay();
  } else {
    showPauseOverlay();
  }
});

// Fires when a requestPointerLock() call fails - most commonly the Escape
// cooldown described above. Keep retrying on a short timer as long as we're
// still paused and the window still has focus; this stops on its own once
// the lock succeeds (pointerlockchange above clears the timer) or the
// player is no longer trying to resume.
document.addEventListener("pointerlockerror", () => {
  clearLockRetry();
  lockRetryTimeoutId = setTimeout(() => {
    lockRetryTimeoutId = null;
    if (isPaused && document.hasFocus()) {
      renderer.domElement.requestPointerLock();
    }
  }, 150);
});

// Safety net for focus loss (alt-tab, clicking another window/app, switching
// tabs): most browsers already auto-release pointer lock on blur, which
// would trigger the pointerlockchange handler above on its own. These
// listeners force the same outcome explicitly, in case a browser doesn't
// auto-release it, so the game can never keep simulating while unfocused.
function pauseForFocusLoss() {
  clearLockRetry();
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
  showPauseOverlay();
}
window.addEventListener("blur", pauseForFocusLoss);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseForFocusLoss();
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

  // Interior obstacle colliders, matching the obstacle meshes created
  // above. Same "no parent rigid body" static pattern as the ground/walls.
  // Being real Rapier colliders (not just visuals) means they'll already
  // block a future hitscan raycast in Milestone 4 with no extra work then.
  for (const box of boxObstacleDefs) {
    const boxColliderDesc = RAPIER.ColliderDesc.cuboid(
      box.hx,
      box.hy,
      box.hz
    ).setTranslation(box.x, box.hy, box.z);
    world.createCollider(boxColliderDesc);
  }

  for (const pillar of pillarObstacleDefs) {
    // Rapier's cylinder collider takes a half-height (not full height),
    // matching the halving we already do for box half-extents above.
    const pillarColliderDesc = RAPIER.ColliderDesc.cylinder(
      pillar.height / 2,
      pillar.radius
    ).setTranslation(pillar.x, pillar.height / 2, pillar.z);
    world.createCollider(pillarColliderDesc);
  }

  // The ramp needs a rotated collider to match its tilted mesh. Rapier
  // expects rotations as a quaternion {x, y, z, w} - rather than hand-
  // writing that math, we let THREE.Quaternion compute it from the same
  // Euler angle used for the mesh's rotation.x above, then copy it over.
  const rampQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rampObstacleDef.tiltRadians, 0, 0)
  );
  const rampColliderDesc = RAPIER.ColliderDesc.cuboid(
    rampObstacleDef.hx,
    rampObstacleDef.hy,
    rampObstacleDef.hz
  )
    .setTranslation(rampObstacleDef.x, rampObstacleDef.hy, rampObstacleDef.z)
    .setRotation({
      x: rampQuaternion.x,
      y: rampQuaternion.y,
      z: rampQuaternion.z,
      w: rampQuaternion.w,
    });
  world.createCollider(rampColliderDesc);

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

    // Freeze the entire simulation while paused (overlay showing) - no
    // gravity, no movement, no physics stepping - so the player can't fall,
    // slide, or otherwise keep moving while they have no control over the
    // game. The scene still renders below so the frame doesn't go blank.
    if (!isPaused) {
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
    }

    // Follow the player's current position with the camera. Runs even while
    // paused so the camera stays put at the player's last known position
    // instead of needing separate paused/unpaused render paths.
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
