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
// near the crosshair) adds a bit of arcade-shooter pacing. This milestone
// also added a debug "T" key that damages the player directly, kept
// around as a convenience for quickly testing the health bar/death state.
//
// Milestone 5: One AI bot. An enemy capsule (RED, per the Visual Style
// team-color rule), spawned at the spot the Milestone 3 layout reserved
// for it. Every frame it casts a Rapier ray at the player to check for an
// unobstructed line of sight - only that raycast is allowed to gate
// tracking/aiming, never omniscience. Once it can see them, it turns to
// face them (turn-speed capped, see below), waits a short "reaction
// delay", then fires back with its own hitscan shot (a small random
// spread keeps it from being a perfect laser), damaging the player via
// damagePlayer(). It has its own health (equal to the player's max
// health) and can be destroyed by the player's gun. Since a plain capsule
// is rotationally symmetric, a small dark marker box is stuck to its
// front purely so its facing is visible during testing - not a real gun
// model.
//
// Post-Milestone-5 enhancement pass (movement, aim, health parity, health
// bars, regen - requested directly, ahead of their originally scheduled
// milestones; see AGENTS.md's Current Status for details):
// - The bot now moves: it patrols between a handful of hand-placed
//   waypoints near existing cover, or heads toward the player's last
//   known position after losing sight, using its own kinematic body +
//   character controller (separate from the player's - see the comment
//   in initPhysics()). This is basic waypoint patrol, NOT the tactical
//   cover-seeking AI reserved for Milestone 10's difficulty tiers.
// - Turning (both to aim at the player and to face its movement
//   direction) is rate-limited via rotateGroupTowards() instead of
//   snapping instantly, and it must finish turning (within
//   BOT_AIM_ANGLE_THRESHOLD_RADIANS) before it's allowed to fire.
// - A small floating health bar (DOM/CSS overlay, team-colored) hovers
//   above its head, built via createFloatingHealthBar().
// - Both the player and the bot regenerate health gradually after a few
//   seconds without taking damage - see regenPlayerHealth()/
//   regenBotHealth(), called from tick().
//
// NOT built yet (later milestones):
// - No platforms or crouch yet (7).
// - No respawn or win condition yet (6).
// - No cover-seeking behavior or difficulty tiers yet (9-10) - the bot's
//   patrol/chase movement above is a basic step ahead of that, not the
//   real thing.
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
// The player spawns at (0, _, 5) (see playerBodyDesc below), mirrored by
// the enemy bot's spawn at (0, _, -5) (see the AI bot section further
// down) - this layout was planned around both spawns from the start so it
// never needed reworking once the bot was added.

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
// Declared here (before the bot below, which reuses PLAYER_RADIUS/
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
const GUN_DAMAGE = 25; // 4 hits destroys the bot's 100 health
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

// Declared here (rather than down in the Player Health + HUD section)
// so the AI bot section below can set BOT_MAX_HEALTH equal to it - keeps
// the two guaranteed to match for balance instead of just coincidentally
// being the same number.
const PLAYER_MAX_HEALTH = 100;

// Health regeneration (both player and bot): after a stretch of time with
// no damage taken, health gradually climbs back toward max on its own -
// see regenPlayerHealth()/regenBotHealth() further down.
const HEALTH_REGEN_DELAY_MS = 5000; // ~5 seconds of no damage before it starts
const HEALTH_REGEN_RATE_PER_SECOND = 8; // ~12.5s for a full regen from 0

// -----------------------------------------------------------------------
// AI bot (Milestone 5)
// -----------------------------------------------------------------------
// A single stationary enemy bot sitting at (0, _, -5) - the exact spot the
// Milestone 3 obstacle layout reserved and kept clear for it. It doesn't
// move or take cover yet (that's Milestone 10) - for now it just watches
// for the player, turns to face them, and shoots back. RED = enemy team
// color, per the Visual Style rule in AGENTS.md. This replaces the
// Milestone 4 "test target" stand-in that used to live here.

// Kept equal to the player's own max health for balance - see the
// PLAYER_MAX_HEALTH declaration above.
const BOT_MAX_HEALTH = PLAYER_MAX_HEALTH;
const BOT_SPAWN_POSITION = { x: 0, z: -5 };
const BOT_COLOR = 0xcc3333;

// How far the bot can "see" the player - same scale as the player's own
// GUN_RANGE above.
const BOT_SIGHT_RANGE = 100;
// Delay (ms) between first spotting the player and firing the first shot -
// gives the bot a believable "reacting" pause instead of an instant snap
// shot the moment it has line of sight. Fixed for now; Milestone 10 will
// vary this per difficulty tier instead of adding new logic.
const BOT_REACTION_DELAY_MS = 500;
// Slower, single-shot pace compared to the player's 750rpm full-auto gun -
// reads as the bot "aiming" rather than spraying.
const BOT_FIRE_RATE_RPM = 300;
const BOT_FIRE_INTERVAL_MS = 60000 / BOT_FIRE_RATE_RPM;
const BOT_DAMAGE_PER_HIT = 10; // 10 hits to kill the player
// Small random aim jitter (radians) applied in applyAimSpread() below, so
// the bot's shots aren't a perfectly accurate laser.
const BOT_AIM_SPREAD_RADIANS = 0.035;

// Bot movement (patrol/chase) tuning - see updateBot()/moveBotTowards()
// further down for how these are used.
const BOT_MOVE_SPEED = 3; // meters/second - slower than the player's 5
// How fast the bot can turn to face a target, in radians/second - caps
// both "aiming at the player" and "facing its own movement direction" so
// it never snaps instantly (see rotateGroupTowards() below).
const BOT_TURN_SPEED_RADIANS_PER_SEC = Math.PI; // 180 degrees/second
// The bot must be turned to within this many radians of "dead on" before
// it's allowed to fire - stops it from snap-firing the instant it regains
// sight while still mid-turn.
const BOT_AIM_ANGLE_THRESHOLD_RADIANS = 0.05; // ~3 degrees
// How close (meters) counts as "arrived" at a patrol point or the
// player's last known position.
const BOT_WAYPOINT_ARRIVAL_RADIUS = 1.5;
// Give up on the current patrol/chase target after this long even if it
// hasn't been reached - a simple safety net against getting stuck on an
// obstacle corner, without needing real pathfinding.
const BOT_MOVE_TIMEOUT_MS = 6000;

// Hand-placed patrol waypoints (meters), chosen near existing cover
// (crates/pillars from the Interior Obstacles section above) rather than
// out in the open lanes - this is simple waypoint patrol "using existing
// obstacles for cover" as requested, NOT the tactical cover-seeking AI
// that AGENTS.md reserves for Milestone 10's difficulty tiers.
const BOT_PATROL_POINTS = [
  { x: -9, z: 7.5 }, // near the west crate/ramp cluster
  { x: -7, z: -12 }, // near the far west crate
  { x: 10, z: -6 }, // near the east lone wall segment
  { x: 9, z: 6 }, // near the east pillar
  { x: 4, z: -10 }, // near the low wall, north of the bot's own spawn
  { x: -4, z: -1 }, // near the central-west pillar, behind the chokepoint
];

let botHealth = BOT_MAX_HEALTH;
let botDestroyed = false;
// Timestamp (on the same clock as tick()'s requestAnimationFrame
// timestamp) of the first frame the bot had line of sight to the player,
// or null while it currently can't see them. Reset to null the instant
// sight is lost, so re-spotting the player always requires waiting out
// the reaction delay again.
let botSpottedAtTime = null;
// Timestamp of the bot's last shot, mirroring the player's own
// lastShotTime fire-rate cooldown pattern further below.
let lastBotShotTime = -Infinity;
// Timestamp of the last time the bot took damage - see regenBotHealth().
let botLastDamageTime = -Infinity;

// The player's position the last time the bot actually saw them (only
// {x, z} - movement is ground-level, so height doesn't matter here), or
// null if it has none worth chasing. Set continuously while the player is
// visible; consumed as a movement target once sight is lost.
let botLastKnownPlayerPosition = null;
// The {x, z} point the bot is currently walking toward - either
// botLastKnownPlayerPosition or one of BOT_PATROL_POINTS - or null while
// it doesn't have one (e.g. while actively engaging the player).
let botMoveTarget = null;
// Timestamp the current botMoveTarget was set, so moveBotTowards() can
// give up on it after BOT_MOVE_TIMEOUT_MS.
let botMoveTargetSetAt = 0;
// Index into BOT_PATROL_POINTS most recently picked, so
// pickNewPatrolTarget() can avoid immediately re-picking the same one
// (which would look like the bot walking back and forth in place).
let lastPatrolPointIndex = -1;

// A plain capsule is rotationally symmetric - spinning it looks identical
// from outside, so rotating it to "aim" wouldn't actually be visible. A
// small dark marker box stuck to the front (purely a facing indicator, not
// a real gun model) fixes that so its facing is visible while testing.
// The capsule and marker are both children of a THREE.Group so rotating
// the group turns them together; BOT_MARKER_OFFSET is also reused below as
// the bot's own "muzzle" point for tracers, the same idea as the player's
// MUZZLE_OFFSET.
const botMaterial = new THREE.MeshStandardMaterial({ color: BOT_COLOR });
const botGeometry = new THREE.CapsuleGeometry(
  PLAYER_RADIUS,
  PLAYER_HALF_HEIGHT * 2,
  4,
  8
);
const botMesh = new THREE.Mesh(botGeometry, botMaterial);

const BOT_MARKER_OFFSET = new THREE.Vector3(0, 0.3, -(PLAYER_RADIUS + 0.1));
const botMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b2b });
const botMarkerGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.3);
const botMarkerMesh = new THREE.Mesh(botMarkerGeometry, botMarkerMaterial);
botMarkerMesh.position.copy(BOT_MARKER_OFFSET);

const botGroup = new THREE.Group();
botGroup.add(botMesh);
botGroup.add(botMarkerMesh);
botGroup.position.set(
  BOT_SPAWN_POSITION.x,
  PLAYER_HALF_HEIGHT + PLAYER_RADIUS,
  BOT_SPAWN_POSITION.z
);
scene.add(botGroup);

// -----------------------------------------------------------------------
// Floating health bar (above the bot's head)
// -----------------------------------------------------------------------
// Built as a plain HTML/CSS overlay - the same approach every other HUD
// element in this project already uses (#health-bar-fill, #ammo-hud,
// etc.) - rather than a Three.js sprite, so it's simple to restyle via
// CSS. Its screen position is re-projected from the bot's world position
// every frame (see updateFloatingHealthBarPosition() below, called from
// tick()). There's no occlusion test against walls, so it'll show through
// obstacles - an accepted simplification for now, matching the project's
// "keep v1 simple" philosophy; can be revisited in later polish.
//
// Colored by team per the Visual Style rule in AGENTS.md (green for
// allies, red for enemies) - only the bot's red is exercised today since
// there are no ally bots yet (Milestone 9/10), but createFloatingHealthBar
// takes the color as a parameter so a future ally bot can reuse it as-is.
// The player never gets one at all - there's no player mesh to attach it
// to in first-person anyway, so "not shown for the player's own view of
// themselves" is automatically true.

// How far above the bot group's own origin (its capsule's vertical
// center) the bar should float - just above the top of its head.
const BOT_HEALTH_BAR_HEIGHT_OFFSET = PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.35;

function createFloatingHealthBar(color) {
  const container = document.createElement("div");
  container.className = "floating-health-bar";

  const fill = document.createElement("div");
  fill.className = "floating-health-bar-fill";
  fill.style.backgroundColor = color;
  container.appendChild(fill);

  document.body.appendChild(container);
  return { container, fill };
}

// Sets the bar's fill width to match a health percentage (0-100). Unlike
// the player's own health bar, the color itself stays fixed at the
// character's team color - it doesn't shift green/orange/red as health
// drops.
function updateFloatingHealthBarFill(bar, healthPercent) {
  bar.fill.style.width = `${healthPercent}%`;
}

// Projects a world-space point onto 2D screen coordinates and moves the
// bar there, hiding it if that point is behind the camera or off-screen.
function updateFloatingHealthBarPosition(bar, worldPosition) {
  const projected = new THREE.Vector3(
    worldPosition.x,
    worldPosition.y,
    worldPosition.z
  ).project(camera);

  // project() maps anything in front of the camera's frustum to roughly
  // [-1, 1] on each axis; z > 1 means the point is actually behind the
  // camera (a quirk of the projection math), and |x| or |y| > 1 means
  // it's outside the view horizontally/vertically.
  const isBehindCamera = projected.z > 1;
  const isOffScreen = Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
  if (isBehindCamera || isOffScreen) {
    bar.container.style.display = "none";
    return;
  }

  bar.container.style.display = "block";
  bar.container.style.left = `${((projected.x + 1) / 2) * window.innerWidth}px`;
  bar.container.style.top = `${((1 - projected.y) / 2) * window.innerHeight}px`;
}

const botHealthBar = createFloatingHealthBar(`#${BOT_COLOR.toString(16).padStart(6, "0")}`);

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

  // Debug helper (added in Milestone 4, before the bot could shoot back):
  // pressing "T" deals test damage to the player. Left in as a quick way
  // to test the health bar/death state without needing to walk into the
  // bot's line of sight. Checked once per key-press here (not via
  // keysPressed each frame like WASD), since holding it down should not
  // deal damage every frame.
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

// PLAYER_MAX_HEALTH itself now lives up near the Gun tuning constants
// (see the comment there) so the AI bot section can reference it.
// Below this health percentage, the screen-edge vignette fades in as a
// warning cue - purely visual, doesn't affect gameplay.
const LOW_HEALTH_VIGNETTE_THRESHOLD = 25;
let playerHealth = PLAYER_MAX_HEALTH;
let isDead = false;
// Timestamp of the last time the player took damage - see
// regenPlayerHealth() below.
let playerLastDamageTime = -Infinity;

const healthBarFill = document.getElementById("health-bar-fill");
const deathOverlay = document.getElementById("death-overlay");
const vignette = document.getElementById("vignette");

// Applies a new health value (clamped to [0, PLAYER_MAX_HEALTH]) and
// updates the HUD bar/color and low-health vignette to match - shared by
// damagePlayer() (health going down) and regenPlayerHealth() (health
// climbing back up) so the HUD always stays in sync either direction.
function setPlayerHealth(newHealth) {
  playerHealth = Math.max(0, Math.min(PLAYER_MAX_HEALTH, newHealth));

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

function damagePlayer(amount) {
  if (isDead) return;
  playerLastDamageTime = performance.now();
  setPlayerHealth(playerHealth - amount);
}

// Gradually restores the player's health once HEALTH_REGEN_DELAY_MS has
// passed since the last hit, up to full - called every frame from tick()
// (the same isPaused/isDead-guarded block the rest of the simulation runs
// in), so it naturally stops the instant the player dies.
function regenPlayerHealth(now, deltaTime) {
  if (isDead) return;
  if (playerHealth >= PLAYER_MAX_HEALTH) return;
  if (now - playerLastDamageTime < HEALTH_REGEN_DELAY_MS) return;
  setPlayerHealth(playerHealth + HEALTH_REGEN_RATE_PER_SECOND * deltaTime);
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

// Applies a new health value (clamped to [0, BOT_MAX_HEALTH]) and updates
// its floating health bar to match - shared by damageBot() (health going
// down) and regenBotHealth() (health climbing back up).
function setBotHealth(newHealth) {
  botHealth = Math.max(0, Math.min(BOT_MAX_HEALTH, newHealth));
  updateFloatingHealthBarFill(botHealthBar, (botHealth / BOT_MAX_HEALTH) * 100);
}

function damageBot(world, botCollider) {
  if (botDestroyed) return;

  botLastDamageTime = performance.now();
  setBotHealth(botHealth - GUN_DAMAGE);
  botMaterial.color.set(0xffffff);
  setTimeout(() => {
    if (!botDestroyed) botMaterial.color.set(BOT_COLOR);
  }, 80);

  if (botHealth <= 0) {
    botDestroyed = true;
    scene.remove(botGroup);
    botHealthBar.container.style.display = "none";
    world.removeCollider(botCollider, true);
  }
}

// Gradually restores the bot's health once HEALTH_REGEN_DELAY_MS has
// passed since its last hit, up to full - mirrors regenPlayerHealth().
function regenBotHealth(now, deltaTime) {
  if (botDestroyed) return;
  if (botHealth >= BOT_MAX_HEALTH) return;
  if (now - botLastDamageTime < HEALTH_REGEN_DELAY_MS) return;
  setBotHealth(botHealth + HEALTH_REGEN_RATE_PER_SECOND * deltaTime);
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

  // Bot rigid body (movement pass): a kinematicPositionBased body just
  // like the player's, so Rapier's character controller can slide it
  // along walls/obstacles as it patrols instead of us hand-rolling
  // collision. It never jumps and the arena floor is flat, so unlike the
  // player it doesn't need a gravity/jump velocity state machine - see
  // moveBotTowards() further down, which only ever feeds it horizontal
  // movement.
  const botBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    BOT_SPAWN_POSITION.x,
    PLAYER_HALF_HEIGHT + PLAYER_RADIUS,
    BOT_SPAWN_POSITION.z
  );
  const botBody = world.createRigidBody(botBodyDesc);
  const botColliderDesc = RAPIER.ColliderDesc.capsule(
    PLAYER_HALF_HEIGHT,
    PLAYER_RADIUS
  );
  const botCollider = world.createCollider(botColliderDesc, botBody);

  // The bot needs its OWN character controller, separate from the
  // player's below - computedGrounded()/computedMovement() are stateful
  // results from whichever computeColliderMovement() call ran most
  // recently on a given controller, so sharing one instance between the
  // player and the bot would corrupt whichever one ran second each frame.
  const botCharacterController = world.createCharacterController(0.01);

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
    botBody,
    botCollider,
    botCharacterController,
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
  botBody,
  botCollider,
  botCharacterController,
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
  // `world`/`playerCollider`/`botCollider`, which only exist once Rapier
  // has finished initializing.
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

      if (hit.collider === botCollider) {
        damageBot(world, botCollider);
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

  // -----------------------------------------------------------------
  // Bot AI: sees the player, aims, shoots back, and patrols/chases when it
  // can't. Mirrors the player's own canFire()/tryFireShot()/fireShot()
  // structure above for firing, gated on a line-of-sight raycast +
  // reaction delay + turn-speed-limited aim instead of mouse input.
  // -----------------------------------------------------------------

  // Returns the bot's current "eye" position, read live from its physics
  // body now that it moves - same "capsule center + EYE_HEIGHT" offset
  // used for the player's own eye position below.
  function getBotEyePosition() {
    const botPosition = botBody.translation();
    return {
      x: botPosition.x,
      y: botPosition.y + EYE_HEIGHT,
      z: botPosition.z,
    };
  }

  // Returns the player's current "eye" position (the same point the
  // camera sits at), read directly from the physics body rather than
  // camera.position, since the camera hasn't been updated yet this frame
  // when updateBot() runs (see the order of calls inside tick() below).
  function getPlayerEyePosition() {
    const playerPosition = playerBody.translation();
    return {
      x: playerPosition.x,
      y: playerPosition.y + EYE_HEIGHT,
      z: playerPosition.z,
    };
  }

  // Casts a ray from the bot's eye to the player's eye and returns true
  // only if nothing else (a wall, obstacle, or the ground) is in the way -
  // i.e. the ray's first hit is the player's own collider. Excludes the
  // bot's own collider so the ray doesn't immediately hit itself at the
  // origin point. This is the ONLY thing allowed to gate tracking/aiming -
  // see updateBot() below, which only ever calls rotateGroupTowards() at
  // the player while this returns true.
  function botCanSeePlayer(playerEyePosition, botEyePosition) {
    const toPlayer = {
      x: playerEyePosition.x - botEyePosition.x,
      y: playerEyePosition.y - botEyePosition.y,
      z: playerEyePosition.z - botEyePosition.z,
    };
    const distance = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
    if (distance === 0) return true;

    const direction = {
      x: toPlayer.x / distance,
      y: toPlayer.y / distance,
      z: toPlayer.z / distance,
    };
    const ray = new RAPIER.Ray(botEyePosition, direction);
    const hit = world.castRayAndGetNormal(
      ray,
      distance,
      true,
      undefined,
      undefined,
      botCollider
    );
    return hit !== null && hit.collider === playerCollider;
  }

  // Computes the yaw angle (yaw 0 faces -Z, matching
  // computeHorizontalMovement() below) that would point something
  // standing at `fromPosition` directly at `toPosition`. Only x/z matter -
  // both aiming and ground movement ignore height.
  function computeYawTowards(fromPosition, toPosition) {
    const dx = toPosition.x - fromPosition.x;
    const dz = toPosition.z - fromPosition.z;
    return Math.atan2(-dx, -dz);
  }

  // Turns `group`'s yaw toward `desiredYaw` by at most
  // BOT_TURN_SPEED_RADIANS_PER_SEC * deltaTime, instead of snapping
  // instantly - shared by both "aim at the player" and "face the
  // direction I'm walking" below. Returns how far off-target the rotation
  // still is (radians) after this frame's turn, so callers can tell
  // whether it's turned far enough yet (see BOT_AIM_ANGLE_THRESHOLD_RADIANS).
  function rotateGroupTowards(group, desiredYaw, deltaTime) {
    let angleDiff = desiredYaw - group.rotation.y;
    // Wrap into (-PI, PI] so e.g. turning from +179 degrees to -179
    // degrees takes the 2-degree short way, not the 358-degree long way.
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));

    const maxDelta = BOT_TURN_SPEED_RADIANS_PER_SEC * deltaTime;
    const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, angleDiff));
    group.rotation.y += clampedDelta;

    return Math.abs(angleDiff - clampedDelta);
  }

  // Adds a small random jitter to a (normalized) aim direction so the
  // bot's shots aren't a perfectly accurate laser. Builds two axes
  // perpendicular to the aim direction, then nudges the direction
  // slightly along each before re-normalizing - a simple, standard way to
  // jitter a 3D direction within a small cone.
  function applyAimSpread(direction) {
    const forward = new THREE.Vector3(direction.x, direction.y, direction.z);
    // Any "up" vector not parallel to forward works here - falls back to
    // world +X in the (rare, given the bot never moves) case forward
    // itself is nearly vertical, so the cross product below doesn't
    // degenerate to zero.
    const arbitraryUp =
      Math.abs(forward.y) > 0.99
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3()
      .crossVectors(forward, arbitraryUp)
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();

    const jitterRight = (Math.random() - 0.5) * 2 * BOT_AIM_SPREAD_RADIANS;
    const jitterUp = (Math.random() - 0.5) * 2 * BOT_AIM_SPREAD_RADIANS;

    return forward
      .add(right.multiplyScalar(jitterRight))
      .add(up.multiplyScalar(jitterUp))
      .normalize();
  }

  // Does the actual raycast + damage + visual feedback for a single bot
  // shot, mirroring the player's own fireShot() above. Assumes the caller
  // has already checked line of sight, the reaction delay, the aim-angle
  // threshold, and the fire-rate cooldown.
  function botFireShot(playerEyePosition, botEyePosition) {
    const toPlayer = {
      x: playerEyePosition.x - botEyePosition.x,
      y: playerEyePosition.y - botEyePosition.y,
      z: playerEyePosition.z - botEyePosition.z,
    };
    const distance = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
    const aimDirection = applyAimSpread({
      x: toPlayer.x / distance,
      y: toPlayer.y / distance,
      z: toPlayer.z / distance,
    });

    // botGroup's rotation was just updated this frame by rotateGroupTowards()
    // in updateBot(), so its matrixWorld needs a manual refresh before
    // localToWorld() - normally Three.js only recomputes it during
    // rendering, which hasn't happened yet this frame.
    botGroup.updateMatrixWorld();
    const muzzlePosition = botGroup.localToWorld(BOT_MARKER_OFFSET.clone());

    const ray = new RAPIER.Ray(botEyePosition, aimDirection);
    const hit = world.castRayAndGetNormal(
      ray,
      BOT_SIGHT_RANGE,
      true,
      undefined,
      undefined,
      botCollider
    );

    if (hit) {
      const hitPoint = {
        x: botEyePosition.x + aimDirection.x * hit.timeOfImpact,
        y: botEyePosition.y + aimDirection.y * hit.timeOfImpact,
        z: botEyePosition.z + aimDirection.z * hit.timeOfImpact,
      };
      spawnTracer(muzzlePosition, hitPoint);
      spawnImpactFlash(hitPoint);

      if (hit.collider === playerCollider) {
        damagePlayer(BOT_DAMAGE_PER_HIT);
      }
    } else {
      // Missed everything (or the spread pushed the shot wide) - draw the
      // tracer out to max sight range so a whiffed shot still gets visual
      // feedback, same as the player's own missed shots above.
      const missPoint = {
        x: botEyePosition.x + aimDirection.x * BOT_SIGHT_RANGE,
        y: botEyePosition.y + aimDirection.y * BOT_SIGHT_RANGE,
        z: botEyePosition.z + aimDirection.z * BOT_SIGHT_RANGE,
      };
      spawnTracer(muzzlePosition, missPoint);
    }
  }

  // Picks a random patrol point to walk toward, avoiding immediately
  // re-picking the one just abandoned (which would look like the bot
  // walking back and forth between two spots). Caller is responsible for
  // stamping botMoveTargetSetAt.
  function pickNewPatrolTarget() {
    let index;
    do {
      index = Math.floor(Math.random() * BOT_PATROL_POINTS.length);
    } while (index === lastPatrolPointIndex && BOT_PATROL_POINTS.length > 1);
    lastPatrolPointIndex = index;
    botMoveTarget = BOT_PATROL_POINTS[index];
  }

  // Moves the bot toward a {x, z} world point using its OWN character
  // controller (botCharacterController - see the comment in initPhysics()
  // on why it can't share the player's), and turns to face the direction
  // it's actually walking. Returns true once the target has been reached
  // (within BOT_WAYPOINT_ARRIVAL_RADIUS) or given up on
  // (BOT_MOVE_TIMEOUT_MS elapsed) - either way, the caller should pick a
  // new target next frame.
  function moveBotTowards(target, deltaTime, now) {
    const botPosition = botBody.translation();
    const dx = target.x - botPosition.x;
    const dz = target.z - botPosition.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= BOT_WAYPOINT_ARRIVAL_RADIUS) return true;
    if (now - botMoveTargetSetAt >= BOT_MOVE_TIMEOUT_MS) return true;

    rotateGroupTowards(botGroup, computeYawTowards(botPosition, target), deltaTime);

    // The bot never jumps and the floor here is flat, so - unlike the
    // player - no vertical component is needed; Rapier's character
    // controller still handles sliding along obstacles (and the shallow
    // ramp, if a route ever crosses it) from horizontal movement alone.
    botCharacterController.computeColliderMovement(botCollider, {
      x: (dx / distance) * BOT_MOVE_SPEED * deltaTime,
      y: 0,
      z: (dz / distance) * BOT_MOVE_SPEED * deltaTime,
    });
    const correctedMovement = botCharacterController.computedMovement();

    const currentPosition = botBody.translation();
    botBody.setNextKinematicTranslation({
      x: currentPosition.x + correctedMovement.x,
      y: currentPosition.y + correctedMovement.y,
      z: currentPosition.z + correctedMovement.z,
    });

    return false;
  }

  // Ties the sight/reaction/aim/firing/movement pieces together - called
  // once per frame from tick() below, only while the simulation is
  // actually running (see the isPaused/isDead check there) and the bot
  // hasn't been destroyed yet.
  function updateBot(now, deltaTime) {
    if (botDestroyed) return;

    const botPosition = botBody.translation();
    const botEyePosition = getBotEyePosition();
    const playerEyePosition = getPlayerEyePosition();
    const canSee = botCanSeePlayer(playerEyePosition, botEyePosition);

    if (canSee) {
      // Sighted: stop patrolling, turn to aim (turn-speed capped - see
      // rotateGroupTowards()), and fire once actually aimed and ready.
      botMoveTarget = null;
      botLastKnownPlayerPosition = {
        x: playerEyePosition.x,
        z: playerEyePosition.z,
      };
      if (botSpottedAtTime === null) botSpottedAtTime = now;

      const desiredYaw = computeYawTowards(botPosition, playerEyePosition);
      const remainingAngle = rotateGroupTowards(botGroup, desiredYaw, deltaTime);

      const hasReacted = now - botSpottedAtTime >= BOT_REACTION_DELAY_MS;
      const isAimed = remainingAngle <= BOT_AIM_ANGLE_THRESHOLD_RADIANS;
      const offCooldown = now - lastBotShotTime >= BOT_FIRE_INTERVAL_MS;
      if (hasReacted && isAimed && offCooldown) {
        lastBotShotTime = now;
        botFireShot(playerEyePosition, botEyePosition);
      }
    } else {
      // Not sighted (or never has been) - forget when it was first
      // spotted, so re-spotting always requires the reaction delay again,
      // and move: head toward wherever the player was last seen first,
      // falling back to patrolling once that's reached or given up on.
      botSpottedAtTime = null;

      if (!botMoveTarget) {
        if (botLastKnownPlayerPosition) {
          botMoveTarget = botLastKnownPlayerPosition;
        } else {
          pickNewPatrolTarget();
        }
        botMoveTargetSetAt = now;
      }

      const reachedOrGaveUp = moveBotTowards(botMoveTarget, deltaTime, now);
      if (reachedOrGaveUp) {
        // If this was the last-known-position chase, give it up entirely
        // (whether reached or timed out) rather than immediately chasing
        // the same stale point again next frame.
        if (botMoveTarget === botLastKnownPlayerPosition) {
          botLastKnownPlayerPosition = null;
        }
        botMoveTarget = null;
      }
    }

    // Note: botGroup's *position* is deliberately NOT synced here.
    // moveBotTowards() above only queues the bot's next position via
    // setNextKinematicTranslation() - like the player, that queued
    // translation doesn't actually take effect on botBody.translation()
    // until world.step() runs, which happens later in tick(), after
    // updateBot() returns. Syncing here would read last frame's stale
    // position. See the sync next to the player's own camera update in
    // tick() below instead.
  }

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

      // Bot AI: sight check, aim/turn, fire-back, and patrol/chase
      // movement - see updateBot() above.
      updateBot(timestamp, deltaTime);

      // Gradual health regeneration for both sides - see
      // regenPlayerHealth()/regenBotHealth() above for the delay/rate.
      regenPlayerHealth(timestamp, deltaTime);
      regenBotHealth(timestamp, deltaTime);

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

    // Sync the bot's visual group to wherever physics actually put its
    // body this frame (it may have been blocked/slid along a collision by
    // moveBotTowards() above) - same reasoning and timing as the player's
    // camera sync just above (must happen after world.step(), not before).
    const botPosition = botBody.translation();
    botGroup.position.set(botPosition.x, botPosition.y, botPosition.z);

    // Keep the bot's floating health bar glued above its head on screen.
    // Runs even while paused/dead (same reasoning as the camera follow
    // above), and is skipped once the bot is destroyed - damageBot()
    // already hid the bar for good at that point.
    if (!botDestroyed) {
      updateFloatingHealthBarPosition(botHealthBar, {
        x: botGroup.position.x,
        y: botGroup.position.y + BOT_HEALTH_BAR_HEIGHT_OFFSET,
        z: botGroup.position.z,
      });
    }

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
