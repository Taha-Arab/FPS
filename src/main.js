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
// Milestone 4: Shooting + health. Holding left-click fires a full-auto
// Rapier raycast gun ("hitscan" - instant, no travel time) from the
// camera at a fixed fire rate, which already hits every wall/obstacle
// collider from Milestone 3 for free. A tracer line + impact flash give
// hit feedback, and a magazine/reload system (R to reload, ammo shown
// near the crosshair) adds a bit of arcade-shooter pacing. Since
// Milestone 5's real AI bot doesn't exist yet, this milestone adds two
// TEMPORARY stand-ins so the damage pipeline can be tested end-to-end: a
// shootable red capsule ("test target") at the reserved future-bot spawn
// spot, and a debug "T" key that damages the player directly (since
// nothing can shoot back yet). Both are commented where they appear so
// they're easy to find and replace in Milestone 5.
//
// NOT built yet (later milestones):
// - No platforms or crouch yet (7).
// - No AI bots or respawn yet (5-6) - see the temporary stand-ins above.
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
// Player movement tuning constants
// -----------------------------------------------------------------------
// Declared here (before the test target below, which reuses PLAYER_RADIUS/
// PLAYER_HALF_HEIGHT for its own capsule shape) rather than further down
// near the Rapier setup that mostly uses them, so both can rely on it.

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

// Gun tuning constants (Milestone 4). The gun is "hitscan" - it's an
// instant raycast rather than a physical bullet that travels over time,
// which is standard for simple FPS games and much easier to get right.
const GUN_DAMAGE = 25; // 4 hits destroys the 100-health test target
const GUN_RANGE = 100; // meters

// Where the tracer *looks* like it starts from - offset to the
// lower-right of the camera, like a held gun, in the camera's own local
// space (+X = right, +Y = up, -Z = forward). This is ONLY used to draw the
// tracer; the actual hit-detection ray below still fires from the exact
// camera center for accuracy. Without this offset, shooting straight
// ahead makes the tracer perfectly line up with the camera's view, so it
// renders end-on and is invisible (a line viewed along its own length has
// no visible width).
const MUZZLE_OFFSET = new THREE.Vector3(0.25, -0.25, -0.5);

// Full-auto fire rate: 750 rounds/minute is a typical real-world assault
// rifle rate (close to the in-game rate of e.g. COD's M4), which reads as
// snappy/arcade-y without being a laser beam. Converted to milliseconds
// between shots since that's what we actually compare timestamps against.
const FIRE_RATE_RPM = 750;
const FIRE_INTERVAL_MS = 60000 / FIRE_RATE_RPM;

// Magazine + reload tuning - simple "arcade shooter" numbers (a full
// COD-style assault rifle mag, ~1.5-2s reload), not meant to be realistic.
const MAGAZINE_SIZE = 30;
const RELOAD_TIME_MS = 1800;
// Ammo is shown/flashed as "low" once at or below this fraction of a full
// magazine (30 * 0.2 = 6 rounds) - just a HUD warning cue, doesn't affect
// firing itself (that's still gated purely on currentAmmo > 0).
const LOW_AMMO_RATIO = 0.2;

// -----------------------------------------------------------------------
// TEMPORARY: shootable test target (Milestone 4 stand-in for Milestone 5's
// real AI bot)
// -----------------------------------------------------------------------
// Milestone 4 needs *something* with health for the gun to damage, to prove
// the raycast-hit -> damage pipeline actually works before real bots exist.
// This is a plain red capsule (RED = enemy team color, per the Visual Style
// rule in AGENTS.md) sitting at (0, _, -5) - the exact spot the Milestone 3
// obstacle layout already reserved and kept clear for the future enemy bot
// spawn. Milestone 5 should replace this whole section with the real bot
// (reusing the same position/capsule look) instead of extending it further.

const TARGET_MAX_HEALTH = 100;
const TARGET_POSITION = { x: 0, z: -5 };
const TARGET_COLOR = 0xcc3333;

let targetHealth = TARGET_MAX_HEALTH;
let targetDestroyed = false;

// Same capsule dimensions as the player, so it reads as a person-sized
// target and can reuse the player's own collider size/shape below.
const targetMaterial = new THREE.MeshStandardMaterial({ color: TARGET_COLOR });
const targetGeometry = new THREE.CapsuleGeometry(
  PLAYER_RADIUS,
  PLAYER_HALF_HEIGHT * 2,
  4,
  8
);
const targetMesh = new THREE.Mesh(targetGeometry, targetMaterial);
targetMesh.position.set(
  TARGET_POSITION.x,
  PLAYER_HALF_HEIGHT + PLAYER_RADIUS,
  TARGET_POSITION.z
);
scene.add(targetMesh);

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

  // TEMPORARY (Milestone 4): pressing "T" deals test damage to the player,
  // so the health bar/death state can be verified before Milestone 5 adds
  // a real bot that can actually shoot back. Remove this once that exists.
  // Checked once per key-press here (not via keysPressed each frame like
  // WASD), since holding it down should not deal damage every frame.
  if (event.code === "KeyT" && !isPaused && !isDead) {
    damagePlayer(20);
  }

  // Manual reload (Milestone 4 extension). Checked once per key-press,
  // same reasoning as "T" above - holding R should only start one reload,
  // not restart it every frame.
  if (event.code === "KeyR" && !isPaused && !isDead) {
    startReload();
  }
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

  // Same idea for the mouse button (Milestone 4 extension): without this,
  // alt-tabbing away while holding left-click would leave `isFiring` stuck
  // true, since mouseup never fires while the tab isn't focused, and the
  // gun would start full-auto firing the instant the player resumes.
  isFiring = false;
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
// Player health + HUD (Milestone 4)
// -----------------------------------------------------------------------
// A simple health bar (HTML/CSS, matching the pause overlay's DOM-based
// approach) plus a death state. There's no respawn yet - that's Milestone
// 6's job - so dying just freezes the game and shows a message for now.

const PLAYER_MAX_HEALTH = 100;
// Below this health percentage, the screen-edge vignette fades in as a
// warning cue - purely visual, doesn't affect gameplay.
const LOW_HEALTH_VIGNETTE_THRESHOLD = 25;
let playerHealth = PLAYER_MAX_HEALTH;
let isDead = false;

const healthBarFill = document.getElementById("health-bar-fill");
const deathOverlay = document.getElementById("death-overlay");
const vignette = document.getElementById("vignette");

// Reduces the player's health, updates the HUD bar, and triggers the death
// state once health reaches 0. `amount` is however much damage was dealt -
// currently only ever called by the temporary "T" debug key below, until
// Milestone 5's bot can call this for real.
function damagePlayer(amount) {
  if (isDead) return;

  playerHealth = Math.max(0, playerHealth - amount);

  const healthPercent = (playerHealth / PLAYER_MAX_HEALTH) * 100;
  healthBarFill.style.width = `${healthPercent}%`;
  // Simple threshold-based coloring (green/orange/red) rather than a
  // continuous gradient - easier to read at a glance and simpler to code.
  if (healthPercent > 50) {
    healthBarFill.style.backgroundColor = "#4caf50"; // green
  } else if (healthPercent > 20) {
    healthBarFill.style.backgroundColor = "#ff9800"; // orange
  } else {
    healthBarFill.style.backgroundColor = "#f44336"; // red
  }

  // Fade in the low-health vignette once below the threshold - but not
  // once actually dead, since the #death-overlay covers the whole screen
  // anyway at that point and would just be hidden behind it.
  const isLowHealth =
    healthPercent > 0 && healthPercent <= LOW_HEALTH_VIGNETTE_THRESHOLD;
  vignette.classList.toggle("active", isLowHealth);

  if (playerHealth === 0) {
    isDead = true;
    deathOverlay.classList.remove("hidden");
  }
}

// -----------------------------------------------------------------------
// Ammo + reload (Milestone 4 extension: full-auto + magazine)
// -----------------------------------------------------------------------
// Kept at module scope (rather than inside startRenderLoop, like the
// actual firing logic below) since none of this needs the Rapier world -
// it's just bookkeeping plus the HUD text - and it needs to be reachable
// from both the "R" key handler up in the Input Handling section and the
// firing logic below.

let currentAmmo = MAGAZINE_SIZE;
let isReloading = false;
// True for as long as the left mouse button is held down while pointer-
// locked - checked every frame in tick() so holding the button fires
// continuously (full-auto) instead of once per click.
let isFiring = false;

const ammoHud = document.getElementById("ammo-hud");
const ammoText = document.getElementById("ammo-text");

function updateAmmoDisplay() {
  if (isReloading) {
    ammoText.textContent = "Reloading...";
    // Don't flash "low ammo" red while the "Reloading..." text is already
    // showing - the two cues would fight each other visually.
    ammoHud.classList.remove("ammo-low");
    return;
  }

  ammoText.textContent = `${currentAmmo} / ${MAGAZINE_SIZE}`;
  const isLowAmmo = currentAmmo <= MAGAZINE_SIZE * LOW_AMMO_RATIO;
  ammoHud.classList.toggle("ammo-low", isLowAmmo);
}
updateAmmoDisplay(); // show a full magazine before the player fires at all

function startReload() {
  // Ignore if already reloading, or if the magazine's already full - no
  // point restarting a reload that wouldn't change anything.
  if (isReloading || currentAmmo === MAGAZINE_SIZE) return;

  isReloading = true;
  updateAmmoDisplay();

  setTimeout(() => {
    currentAmmo = MAGAZINE_SIZE;
    isReloading = false;
    updateAmmoDisplay();
  }, RELOAD_TIME_MS);
}

// -----------------------------------------------------------------------
// Shooting visual feedback: tracer line + impact flash (Milestone 4)
// -----------------------------------------------------------------------
// Per the Visual Style spec: "a thin glowing tracer line from gun to
// impact point, plus a small flash/particle at the impact point" - no
// bullet model needed. Both are just added to the scene and removed a
// few milliseconds later with setTimeout, so they read as a fast instant
// flash rather than a persistent laser beam.

const TRACER_LIFETIME_MS = 70;
const IMPACT_FLASH_LIFETIME_MS = 120;

function spawnTracer(start, end) {
  const tracerGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(start.x, start.y, start.z),
    new THREE.Vector3(end.x, end.y, end.z),
  ]);
  const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xfff59d });
  const tracerLine = new THREE.Line(tracerGeometry, tracerMaterial);
  scene.add(tracerLine);

  setTimeout(() => {
    scene.remove(tracerLine);
    tracerGeometry.dispose();
    tracerMaterial.dispose();
  }, TRACER_LIFETIME_MS);
}

function spawnImpactFlash(point) {
  const flashGeometry = new THREE.SphereGeometry(0.08, 8, 8);
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffffaa });
  const flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
  flashMesh.position.set(point.x, point.y, point.z);
  scene.add(flashMesh);

  setTimeout(() => {
    scene.remove(flashMesh);
    flashGeometry.dispose();
    flashMaterial.dispose();
  }, IMPACT_FLASH_LIFETIME_MS);
}

// Briefly flashes the test target white to show a hit landed, then damages
// it and destroys it (removes mesh + collider) once its health runs out.
// TEMPORARY (Milestone 4) - see the comment where targetMesh is created;
// Milestone 5 should replace this along with the rest of the test target.
function damageTarget(world, targetCollider) {
  if (targetDestroyed) return;

  targetHealth -= GUN_DAMAGE;
  targetMaterial.color.set(0xffffff);
  setTimeout(() => {
    if (!targetDestroyed) targetMaterial.color.set(TARGET_COLOR);
  }, 80);

  if (targetHealth <= 0) {
    targetDestroyed = true;
    scene.remove(targetMesh);
    world.removeCollider(targetCollider, true);
  }
}

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
  // Being real Rapier colliders (not just visuals) means they already
  // block the Milestone 4 gun's hitscan raycast (below) with no extra work.
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

  // TEMPORARY (Milestone 4): a static collider matching the test target
  // mesh above, using the same capsule shape as the player. This is what
  // lets the gun's raycast (below) actually detect a hit on the target.
  const targetColliderDesc = RAPIER.ColliderDesc.capsule(
    PLAYER_HALF_HEIGHT,
    PLAYER_RADIUS
  ).setTranslation(
    TARGET_POSITION.x,
    PLAYER_HALF_HEIGHT + PLAYER_RADIUS,
    TARGET_POSITION.z
  );
  const targetCollider = world.createCollider(targetColliderDesc);

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

  return {
    world,
    playerBody,
    playerCollider,
    characterController,
    targetCollider,
  };
}

// -----------------------------------------------------------------------
// Main render/physics loop
// -----------------------------------------------------------------------

function startRenderLoop({
  world,
  playerBody,
  playerCollider,
  characterController,
  targetCollider,
}) {
  // THREE.Timer is the modern replacement for the older THREE.Clock -
  // update() must be called once per frame (with the requestAnimationFrame
  // timestamp) before getDelta() returns the correct value.
  const timer = new THREE.Timer();
  // Vertical speed accumulated by gravity/jumping. Positive = moving up.
  let verticalVelocity = 0;

  // -----------------------------------------------------------------
  // Shooting (Milestone 4, full-auto extension): holding left-click fires
  // repeated instant raycasts from the camera at a fixed fire rate. Set up
  // here (rather than at module scope) because it needs
  // `world`/`playerCollider`/`targetCollider`, which only exist once
  // Rapier has finished initializing.
  // -----------------------------------------------------------------

  // The timestamp (matching tick()'s requestAnimationFrame timestamp/
  // performance.now() clock) that the next shot is allowed to fire at.
  // Starts at -Infinity so the very first shot never has to wait.
  let lastShotTime = -Infinity;

  // All the conditions that must be true for the gun to be allowed to
  // fire at all, independent of fire-rate timing - reused by both the
  // "fire immediately on click" path and the full-auto "keep firing every
  // frame while held" path in tick() below.
  function canFire() {
    return (
      !isPaused &&
      !isDead &&
      !isReloading &&
      currentAmmo > 0 &&
      document.pointerLockElement === renderer.domElement
    );
  }

  // Does the actual raycast + damage + visual feedback for a single shot.
  // Assumes the caller has already checked canFire() and the fire-rate
  // cooldown - this function just fires, unconditionally.
  function fireShot() {
    currentAmmo -= 1;
    updateAmmoDisplay();

    // Auto-reload (Milestone 4 extension): as soon as the last round is
    // fired, automatically start reloading - on top of the existing
    // manual "R" key, matching how most arcade shooters behave so the
    // player doesn't have to remember to reload themselves.
    if (currentAmmo === 0) startReload();

    const origin = camera.position;
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const ray = new RAPIER.Ray(origin, direction);

    // The tracer's visual start point only - see the MUZZLE_OFFSET comment
    // above for why. localToWorld() converts a point from the camera's
    // local space into world space using its current matrix, so this
    // "muzzle" always stays glued to the lower-right of wherever the
    // camera is currently looking.
    camera.updateMatrixWorld();
    const muzzlePosition = camera.localToWorld(MUZZLE_OFFSET.clone());

    // Exclude the player's own collider so the ray can't hit ourselves
    // point-blank. `solid: true` treats every shape as solid rather than
    // hollow, which is the expected behavior for a bullet.
    const hit = world.castRayAndGetNormal(
      ray,
      GUN_RANGE,
      true,
      undefined,
      undefined,
      playerCollider
    );

    if (hit) {
      const hitPoint = {
        x: origin.x + direction.x * hit.timeOfImpact,
        y: origin.y + direction.y * hit.timeOfImpact,
        z: origin.z + direction.z * hit.timeOfImpact,
      };
      spawnTracer(muzzlePosition, hitPoint);
      spawnImpactFlash(hitPoint);

      if (hit.collider === targetCollider) {
        damageTarget(world, targetCollider);
      }
    } else {
      // Missed everything - draw the tracer out to the max range so a
      // whiffed shot still gets the same visual feedback as a hit.
      const missPoint = {
        x: origin.x + direction.x * GUN_RANGE,
        y: origin.y + direction.y * GUN_RANGE,
        z: origin.z + direction.z * GUN_RANGE,
      };
      spawnTracer(muzzlePosition, missPoint);
    }
  }

  // Fires a shot if (and only if) both canFire() and the fire-rate cooldown
  // allow it right now. `now` should be on the same clock as tick()'s
  // requestAnimationFrame timestamp (both are DOMHighResTimeStamps, so
  // performance.now() and the rAF timestamp can be compared directly).
  function tryFireShot(now) {
    if (!canFire()) return;
    if (now - lastShotTime < FIRE_INTERVAL_MS) return;
    lastShotTime = now;
    fireShot();
  }

  renderer.domElement.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    isFiring = true;
    // Fire immediately on click rather than waiting for the next tick(),
    // so single taps still feel responsive instead of having a tiny delay.
    tryFireShot(performance.now());
  });
  renderer.domElement.addEventListener("mouseup", (event) => {
    if (event.button === 0) isFiring = false;
  });

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

    // Freeze the entire simulation while paused (overlay showing) or dead -
    // no gravity, no movement, no physics stepping - so the player can't
    // fall, slide, or otherwise keep moving while they have no control over
    // the game. The scene still renders below so the frame doesn't go blank.
    if (!isPaused && !isDead) {
      // Full-auto: keep firing every frame the button is held, as long as
      // canFire()/the fire-rate cooldown allow it (see tryFireShot above).
      if (isFiring) tryFireShot(timestamp);

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
