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
// scaling rule (Milestone 9's pre-match menu picks the size via
// buildArena()), plus a varied mix of boxes/pillars/a ramp laid out for
// competitive flow (chokepoints, broken sightlines, mixed cover density)
// rather than an even grid. Those remain solid cover (jump-on-top where
// short enough); walk-under platforms are Milestone 7's separate elevated
// structures.
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
// Milestone 6: Respawn + win condition. Kills are now tracked per TEAM
// (blueScore for the player's side, redScore for the bot's side) rather
// than per-character, since that's the shape multiple bots per team
// (Milestone 10) will need anyway - a kill just increments the killer's
// team score via handlePlayerDeath()/handleBotDeath(). Reaching
// killTarget (chosen on the pre-match menu) first ends the match
// (endMatch()), freezing the whole simulation (see the `matchEnded`
// check in tick()) and showing #match-end-overlay - refreshing the page
// is still the only way to start a new match (a real "Play Again" button
// is Milestone 13 polish). Until
// then, dying just means a short respawn: damagePlayer()/damageBot()
// schedule respawnPlayer()/respawnBot() (defined inside startRenderLoop(),
// where the Rapier bodies live) after RESPAWN_DELAY_MS, which reset
// health/position/ammo (player) or health/position/AI state (bot) rather
// than recreating any Rapier objects - the bot in particular just
// disables/re-enables its existing collider (world.removeCollider() would
// work too, but re-adding a fresh collider later is more code for no
// benefit here). Both respawns also grant SPAWN_INVULNERABILITY_MS of
// no-damage (tracked as a timestamp, exactly like the health regen delay
// below) so you can't be shot the instant you reappear - shown to the
// player as a pulsing blue screen vignette (#spawn-invuln-overlay, since
// there's no visible player model to make transparent) and to the bot as
// genuine mesh transparency. A top-center HUD (#match-hud) shows the
// live team score and a simple count-up match timer.
//
// Milestone 7: Platforms + crouch. New elevated structures (bridge /
// raised platform / low underpass) with open undercroft + ramps onto the
// decks — separate from Milestone 3's solid cover. Hold C crouches:
// static capsule height + move-speed reduction (no slide), with a
// headroom check before standing back up.
//
// Milestone 8: Minimap. Top-right DOM panel (#minimap) with live blue
// player + red enemy dots mapped from arena XZ each frame (updateMinimap),
// plus a static simplified layout layer (buildMinimapLayout) drawn from
// the obstacle/platform defs for spatial awareness.
//
// Milestone 9: Pre-match menu. #prematch-menu gates startup — team size
// (1v1/3v3/5v5) picks ARENA_SIZES via buildArena(), bot difficulty sets
// reaction delay / aim spread (cover flag stored for Milestone 10), and
// kill target replaces the old hardcoded KILL_TARGET. Multi-bot spawning
// per team-size counting rule is still Milestone 10; the menu stores the
// intended ally/enemy counts now even though only one enemy bot exists.
//
// Milestone 10: Multiple bots + difficulty tiers (COMPLETE).
//
// Milestone 11: Weapon feedback — recoil kick, muzzle flash, hit markers
// (tracers/impact flashes already existed from Milestone 4).
//
// Milestone 12: Audio via Web Audio API (synthesized one-shots, no asset
// pack / no new npm deps) — gunshot, footsteps, reload, hit, regen, kill/death.
//
// Milestone 13: Kill feed + post-match K/D + Play Again soft-reset to menu.
//
// Milestone 14: Pause menu with mouse sensitivity slider (pointer-lock /
// focus handling from 2.5 preserved).
//
// Milestone 15: Title splash with player-name placeholder before Match Setup.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  configureRenderer,
  setupEnvironment,
  fitSunShadowToArena,
  buildSkyline,
} from "./environment.js";
import {
  createAsphaltTexture,
  createGroundMarkingsTexture,
} from "./textures.js";
import {
  resetPropRandom,
  buildBoxCoverProp,
  buildColumnProp,
  buildRampProp,
  buildDeckProp,
  buildLegProp,
  buildBoundaryWallProp,
  buildFloodlightTower,
  buildScatterDecor,
  isBlastWallCover,
  getBlastWallColliderLayers,
} from "./props.js";
import { createPlayerArms } from "./playerArms.js";
import {
  buildSoldierModel,
  buildSwatModel,
  SHOOT_ANIM_HOLD_MS,
} from "./botmodel.js";
import { loadGameAssets } from "./assets.js";

// Resolved GLB assets (feat/fps-overhaul) — null until the async load in
// startMatch() finishes; every consumer falls back to procedural models.
let gameAssets = null;

// -----------------------------------------------------------------------
// Three.js setup: scene, camera, renderer
// -----------------------------------------------------------------------

const scene = new THREE.Scene();

// PerspectiveCamera(fieldOfView, aspectRatio, nearClip, farClip).
// 75 degrees FOV is a common, comfortable default for FPS-style games.
// nearClip is 0.001 (not the more typical 0.1) because the viewmodel sits
// very close to the camera at its current VIEWMODEL_SCALE (see
// playerArms.js) — 0.1 was slicing through the back of the arms.
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.001,
  1000
);

// Three.js's default rotation order (XYZ) causes the camera to tilt/roll
// oddly once you combine looking up/down with looking left/right. "YXZ"
// (yaw applied before pitch) is the standard fix for FPS-style cameras.
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
// Modern-overhaul: filmic tone mapping + soft shadow maps.
configureRenderer(renderer);

// The camera must be in the scene graph for camera-parented children (the
// first-person weapon viewmodel) to render.
scene.add(camera);

// Append the renderer's <canvas> into the #app div from index.html.
document.getElementById("app").appendChild(renderer.domElement);

// Keep the camera/renderer in sync with the browser window size. Also
// re-derives camera.fov (see convertVerticalFov()/FOV_REFERENCE_ASPECT
// below) so whatever HORIZONTAL FOV was showing right before the resize -
// hip-fire, ADS, sprint, or mid-blend between them - stays fixed instead of
// ballooning on a wider window; snapped instantly here rather than left for
// tick()'s per-frame FOV smoothing to catch up, so there's no visibly
// warped frame right after the resize.
window.addEventListener("resize", () => {
  const newAspect = window.innerWidth / window.innerHeight;
  camera.fov = convertVerticalFov(camera.fov, camera.aspect, newAspect);
  camera.aspect = newAspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// -----------------------------------------------------------------------
// Lighting + atmosphere (modern-overhaul)
// -----------------------------------------------------------------------
// Atmospheric sky shader with a real sun position, distance fog, hemisphere
// bounce fill, and a warm shadow-casting sun — see src/environment.js.
const { sunLight } = setupEnvironment(scene);

// First-person player viewmodel: fully animated arms+gun, parented to the
// camera (src/playerArms.js). The local variable name stays "weaponViewmodel"
// so every existing call site below (update/fire/ADS/etc.) needed no churn
// beyond the two lines above and setArmsModel() further down.
const weaponViewmodel = createPlayerArms(camera);

// -----------------------------------------------------------------------
// Arena ground + boundary walls (visual) — built after pre-match menu
// -----------------------------------------------------------------------
// Arena size (meters) per the team-size scaling rule in AGENTS.md.
// Milestone 9's pre-match menu picks the key; buildArena() creates the
// ground/walls only after Start Match (physics hasn't started yet, so no
// rebuild path is needed). Interior obstacles/platforms keep absolute
// coords as the 1v1 center cluster; larger arenas ADD mid/outer-ring
// cover via buildArenaCover() so density stays similar.

const ARENA_SIZES = { "1v1": 30, "3v3": 45, "5v5": 60 };

// Bot counts per team-size preset (player counts as one BLUE member —
// see AGENTS.md). Consumed by spawnBotsForMatch() on Start Match.
const TEAM_SIZE_BOT_COUNTS = {
  "1v1": { allyBots: 0, enemyBots: 1 },
  "3v3": { allyBots: 2, enemyBots: 3 },
  "5v5": { allyBots: 4, enemyBots: 5 },
};

// Mutable: set by buildArena() from the chosen team-size preset.
let GROUND_SIZE = ARENA_SIZES["1v1"];
let GROUND_HALF = GROUND_SIZE / 2;
// Regenerated inside buildArena() so wall colliders in initPhysics() match
// whichever arena size the menu selected.
let wallDefs = [];

// Visible wall height. Must stay well above jump reach from the tallest
// walkable surface (Milestone 7 decks top out at ~2.55m; jump peak ~0.9m
// → ~3.45m). 3m was climbable from those decks — 6m is not.
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 1;
// Invisible collision-only barriers on the same XZ footprint as the
// visible walls, but much taller — seals the boundary even if a future
// prop is taller than WALL_HEIGHT (a horizontal "lid" would itself be
// standable, so we extend vertically instead).
const BOUNDARY_CONTAINMENT_HEIGHT = 20;
// How far past the ground pad a player must go before OOB recovery snaps
// them back to spawn (failsafe if containment is ever bypassed).
const OOB_MARGIN = 0.5;

// Modern-overhaul surfaces: procedural canvas textures + normal maps
// (src/textures.js) — still zero image assets for the static deploy.
const groundMaps = createAsphaltTexture(8);
const groundMaterial = new THREE.MeshStandardMaterial({
  map: groundMaps.map,
  normalMap: groundMaps.normalMap,
  normalScale: new THREE.Vector2(0.8, 0.8),
  roughness: 0.95,
  metalness: 0.0,
});
// Shared helper: recursively dispose all geometries in a group/mesh
// (materials are shared singletons in props.js and stay alive).
function disposeObjectGeometry(object) {
  object.traverse((child) => {
    if (child.isMesh) child.geometry.dispose();
  });
}
let groundMesh = null;
const wallMeshes = [];
// Distant decorative skyline blocks (rebuilt per arena size, no colliders).
let skylineMeshes = [];

function clearSkyline() {
  for (const mesh of skylineMeshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  skylineMeshes = [];
}

// Creates (or replaces) the ground plane + four boundary wall meshes for
// the given arena size in meters. Called once from startMatch() before
// initPhysics(), so Rapier colliders are built against the same size.
function buildArena(groundSize) {
  GROUND_SIZE = groundSize;
  GROUND_HALF = GROUND_SIZE / 2;

  // Safe if Start Match were ever double-fired — dispose the previous pad.
  if (groundMesh) {
    scene.remove(groundMesh);
    disposeObjectGeometry(groundMesh);
    groundMesh = null;
  }
  for (const mesh of wallMeshes) {
    scene.remove(mesh);
    disposeObjectGeometry(mesh);
  }
  wallMeshes.length = 0;

  // Ground: asphalt pad + a one-shot markings decal (lane paint, stains,
  // helipad circle) floating a hair above it. Grouped so disposal is easy.
  groundMesh = new THREE.Group();
  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    groundMaterial
  );
  // PlaneGeometry lies in XY; rotate -90° around X to become the floor.
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.receiveShadow = true;
  groundMesh.add(groundPlane);
  // Keep the asphalt tile scale constant across arena sizes (~1 tile / 4m).
  groundMaps.map.repeat.set(GROUND_SIZE / 4, GROUND_SIZE / 4);
  groundMaps.normalMap.repeat.set(GROUND_SIZE / 4, GROUND_SIZE / 4);

  const markings = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({
      map: createGroundMarkingsTexture(),
      transparent: true,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
  );
  markings.rotation.x = -Math.PI / 2;
  markings.position.y = 0.015;
  markings.receiveShadow = true;
  groundMesh.add(markings);
  scene.add(groundMesh);

  // North/south walls span the full width (including the corners), and
  // east/west walls fit snugly between them, so there are no corner gaps.
  // { hx, hz } are half-extents (Rapier/box-geometry convention), { x, z }
  // is the center position of the wall.
  wallDefs = [
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

  // Boundary walls: concrete with pilasters + cap beam (props.js).
  for (const wall of wallDefs) {
    const wallGroup = buildBoundaryWallProp(wall, WALL_HEIGHT);
    scene.add(wallGroup);
    wallMeshes.push(wallGroup);
  }

  // Corner floodlight towers + edge debris (visual only, no colliders).
  const cornerInset = GROUND_HALF - 1.2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tower = buildFloodlightTower(sx * cornerInset, sz * cornerInset);
      scene.add(tower);
      wallMeshes.push(tower);
    }
  }
  const scatter = buildScatterDecor(GROUND_HALF);
  scene.add(scatter);
  wallMeshes.push(scatter);

  // Fit the sun's shadow camera to the chosen arena footprint.
  fitSunShadowToArena(sunLight, GROUND_HALF);

  // Decorative horizon buildings outside the walls.
  clearSkyline();
  skylineMeshes = buildSkyline(scene, GROUND_HALF);

  // Interior cover + platforms scale with arena size (not an empty rim).
  buildArenaCover(groundSize);
}

// -----------------------------------------------------------------------
// Interior obstacles + elevated platforms (visual + layout defs)
// -----------------------------------------------------------------------
// Laid out for competitive flow, not just visual variety - modeled loosely
// on small symmetric shooter maps (think COD's "Shipment"-style close
// combat): no sightline should reach across the whole arena unbroken, a
// couple of chokepoints funnel movement instead of one open field, and
// obstacle density varies by area (tighter cover in firefight pockets,
// sparser in movement lanes) rather than being spaced evenly.
//
// The BASE_* arrays are the original 1v1 (30m) layout. Larger presets
// KEEP that center cluster and ADD mid/outer-ring cover so density and
// flow stay similar — stretching the same few props over 45/60m would
// leave empty sniper alleys. Runtime arrays below are filled by
// buildArenaCover() when Start Match picks an arena size.
//
// Team spawn zones: player's team (BLUE) on the +Z / south side, enemy
// team (RED) on the -Z / north side — see BLUE_TEAM_SPAWN_POINTS /
// RED_TEAM_SPAWN_POINTS. The center chokepoint blocks spawn-to-spawn
// sightlines; candidate points stay on their own side of it.

const STANDING_PLATFORM_CLEARANCE = 2.25;
const CROUCH_PLATFORM_CLEARANCE = 1.35;
const PLATFORM_DECK_HALF_THICKNESS = 0.15;
// Deck top faces (clearance + full thickness) — elevated access ramps must
// meet these at their high end while their walkable low end sits at y ≈ 0.
const STANDING_DECK_TOP_Y =
  STANDING_PLATFORM_CLEARANCE + PLATFORM_DECK_HALF_THICKNESS * 2;
const CROUCH_DECK_TOP_Y =
  CROUCH_PLATFORM_CLEARANCE + PLATFORM_DECK_HALF_THICKNESS * 2;

// Fit a constant-thickness cuboid ramp (tilted about X) so the walkable top
// runs from y ≈ 0 up to deckTopY. Without this, grounding the bottom toe
// leaves a ~2·hy lip that forces a jump onto the slope.
function fitRampToGroundAndDeck(hy, tiltRadians, deckTopY) {
  const cos = Math.cos(tiltRadians);
  const sinAbs = Math.abs(Math.sin(tiltRadians));
  const hz = deckTopY / (2 * sinAbs);
  const y = deckTopY / 2 - hy * cos;
  return { hy, hz, y, tiltRadians };
}

// Place the ramp's center Z so its high-end top edge lands on targetHighZ
// (usually the deck's ±Z face). For θ ≥ 0 the high top is at local z = −hz;
// for θ < 0 it is at local z = +hz.
function rampCenterZForHighEdge(targetHighZ, hy, hz, tiltRadians) {
  const localZHigh = tiltRadians >= 0 ? -hz : hz;
  return (
    targetHighZ -
    hy * Math.sin(tiltRadians) -
    localZHigh * Math.cos(tiltRadians)
  );
}

// Precomputed elevated-ramp fits shared by BASE + mid/outer helpers.
const STANDING_RAMP_45 = fitRampToGroundAndDeck(
  0.2,
  0.45,
  STANDING_DECK_TOP_Y
);
const STANDING_RAMP_60 = fitRampToGroundAndDeck(
  0.2,
  0.6,
  STANDING_DECK_TOP_Y
);
const CROUCH_RAMP_45 = fitRampToGroundAndDeck(0.18, 0.45, CROUCH_DECK_TOP_Y);

// Box obstacles. { hx, hy, hz } are half-extents, { x, z } is the center
// position (each rests on the ground, so its world Y position is just its
// own half-height).
const BASE_BOX_OBSTACLE_DEFS = [
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
  // Cleared west of the east bridge's −Z ramp (was clipping at x: 8, z: -6).
  { hx: 0.5, hy: 0.9, hz: 2.2, x: 7, z: -7 }, // lone wall segment

  // Minor cover near the far spawn area (kept well clear of the actual
  // spawn point) so that end of the map isn't completely bare.
  { hx: 2.0, hy: 0.5, hz: 0.5, x: 4, z: -12 }, // low wall

  // Light cover on the direct approach to the chokepoint from each spawn -
  // enough to duck behind mid-fight, not enough to block the spawn itself.
  // x nudged east so the gap past the choke's east half stays ≥ ~1.2m
  // (capsule diameter 0.8 + margin) — bots were squeezing the old 0.7m lane.
  { hx: 0.9, hy: 0.7, hz: 0.9, x: 5.3, z: 3 }, // near player's spawn side
];

// Pillar obstacles: round cover, a shape boxes alone can't give. Cylinders
// are Y-axis-aligned by default in both Three.js and Rapier, so no
// rotation is needed. { height } is the FULL height (not a half-extent).
const BASE_PILLAR_OBSTACLE_DEFS = [
  // Paired with the west crate above: the ~2m gap between them is a
  // second, narrower chokepoint on the west flank.
  { radius: 0.6, height: 2.2, x: -5.3, z: 5 },
  // East flank kept deliberately sparse (see the box comment above) -
  // just one pillar, far out, for a bit of cover without closing the lane.
  // Nudged clear of the east bridge's +Z access ramp.
  { radius: 0.5, height: 2.4, x: 12, z: 7 },
  // Light cover near the chokepoint's east exit, giving a spot to hold an
  // angle after passing through without blocking the passage itself.
  { radius: 0.55, height: 2.6, x: 5, z: -1 },
  // Mirrors the "light cover near spawn approach" role from the box list
  // above, but on the far side and using a different shape - keeps the
  // two ends functionally balanced without looking like a mirrored copy.
  // Pulled slightly west so clear gap past the choke's west half is ≥ 1.2m.
  { radius: 0.5, height: 2.0, x: -4.5, z: -3 },
];

// Ramp obstacles: boxes tilted around X. ~15° is under Rapier's default
// max climbable slope (45°). hz must be long enough that the walkable top
// dips to y ≤ 0 when the center sits at y = hy — otherwise the toe floats
// and the player has to jump onto the slope.
const BASE_RAMP_OBSTACLE_DEFS = [
  {
    hx: 1.8,
    hy: 0.3,
    hz: 2.5,
    x: -5,
    z: 10,
    tiltRadians: 0.26, // ~15 degrees
  },
];

// Elevated walk-under structures (Milestone 7). Separate from solid cover:
// raised decks on legs so you can walk under AND across. Piece format:
//   type "box"  - axis-aligned cuboid at world center (x, y, z)
//   type "ramp" - cuboid tilted around X by tiltRadians
const BASE_ELEVATED_STRUCTURE_PIECE_DEFS = [
  // --- East bridge (east lane): stand-under + ramps both ends ---
  {
    type: "box",
    hx: 1.6,
    hy: PLATFORM_DECK_HALF_THICKNESS,
    hz: 1.8,
    x: 10,
    y: STANDING_PLATFORM_CLEARANCE + PLATFORM_DECK_HALF_THICKNESS,
    z: -2,
  },
  { type: "box", hx: 0.15, hy: STANDING_PLATFORM_CLEARANCE / 2, hz: 0.15, x: 8.6, y: STANDING_PLATFORM_CLEARANCE / 2, z: -3.5 },
  { type: "box", hx: 0.15, hy: STANDING_PLATFORM_CLEARANCE / 2, hz: 0.15, x: 11.4, y: STANDING_PLATFORM_CLEARANCE / 2, z: -3.5 },
  { type: "box", hx: 0.15, hy: STANDING_PLATFORM_CLEARANCE / 2, hz: 0.15, x: 8.6, y: STANDING_PLATFORM_CLEARANCE / 2, z: -0.5 },
  { type: "box", hx: 0.15, hy: STANDING_PLATFORM_CLEARANCE / 2, hz: 0.15, x: 11.4, y: STANDING_PLATFORM_CLEARANCE / 2, z: -0.5 },
  // Dual access ramps (keep both): bridge sits near center so either team
  // can climb. Fitted so walkable tops run ground → deck (no lip).
  // East deck spans z ∈ [-3.8, -0.2]; +Z ramp high edge at -0.2, −Z at -3.8.
  {
    type: "ramp",
    hx: 1.3,
    hy: STANDING_RAMP_45.hy,
    hz: STANDING_RAMP_45.hz,
    x: 10,
    y: STANDING_RAMP_45.y,
    z: rampCenterZForHighEdge(-0.2, STANDING_RAMP_45.hy, STANDING_RAMP_45.hz, 0.45),
    tiltRadians: 0.45,
  },
  {
    type: "ramp",
    hx: 1.3,
    hy: STANDING_RAMP_45.hy,
    hz: STANDING_RAMP_45.hz,
    x: 10,
    y: STANDING_RAMP_45.y,
    z: rampCenterZForHighEdge(-3.8, STANDING_RAMP_45.hy, STANDING_RAMP_45.hz, -0.45),
    tiltRadians: -0.45,
  },

  // --- West raised platform: stand-under + one ramp ---
  {
    type: "box",
    hx: 1.4,
    hy: PLATFORM_DECK_HALF_THICKNESS,
    hz: 1.3,
    x: -10.5,
    y: STANDING_PLATFORM_CLEARANCE + PLATFORM_DECK_HALF_THICKNESS,
    z: 9.2,
  },
  { type: "box", hx: 0.15, hy: STANDING_PLATFORM_CLEARANCE / 2, hz: 0.15, x: -11.7, y: STANDING_PLATFORM_CLEARANCE / 2, z: 8.1 },
  { type: "box", hx: 0.15, hy: STANDING_PLATFORM_CLEARANCE / 2, hz: 0.15, x: -9.3, y: STANDING_PLATFORM_CLEARANCE / 2, z: 8.1 },
  { type: "box", hx: 0.15, hy: STANDING_PLATFORM_CLEARANCE / 2, hz: 0.15, x: -11.7, y: STANDING_PLATFORM_CLEARANCE / 2, z: 10.3 },
  { type: "box", hx: 0.15, hy: STANDING_PLATFORM_CLEARANCE / 2, hz: 0.15, x: -9.3, y: STANDING_PLATFORM_CLEARANCE / 2, z: 10.3 },
  // West deck +Z face at z = 9.2 + 1.3 = 10.5.
  {
    type: "ramp",
    hx: 1.2,
    hy: STANDING_RAMP_60.hy,
    hz: STANDING_RAMP_60.hz,
    x: -10.5,
    y: STANDING_RAMP_60.y,
    z: rampCenterZForHighEdge(10.5, STANDING_RAMP_60.hy, STANDING_RAMP_60.hz, 0.6),
    tiltRadians: 0.6,
  },

  // --- Low crouch underpass (NW / enemy half) ---
  // Deck pulled south from z: -12 → -9.5 so the −Z-facing ramp stays inside
  // the 1v1 pad (walls at |z| = 15) instead of punching through the north wall.
  {
    type: "box",
    hx: 1.3,
    hy: PLATFORM_DECK_HALF_THICKNESS,
    hz: 1.3,
    x: -11.5,
    y: CROUCH_PLATFORM_CLEARANCE + PLATFORM_DECK_HALF_THICKNESS,
    z: -9.5,
  },
  { type: "box", hx: 0.12, hy: CROUCH_PLATFORM_CLEARANCE / 2, hz: 0.12, x: -12.6, y: CROUCH_PLATFORM_CLEARANCE / 2, z: -10.68 },
  { type: "box", hx: 0.12, hy: CROUCH_PLATFORM_CLEARANCE / 2, hz: 0.12, x: -10.4, y: CROUCH_PLATFORM_CLEARANCE / 2, z: -10.68 },
  { type: "box", hx: 0.12, hy: CROUCH_PLATFORM_CLEARANCE / 2, hz: 0.12, x: -12.6, y: CROUCH_PLATFORM_CLEARANCE / 2, z: -8.32 },
  { type: "box", hx: 0.12, hy: CROUCH_PLATFORM_CLEARANCE / 2, hz: 0.12, x: -10.4, y: CROUCH_PLATFORM_CLEARANCE / 2, z: -8.32 },
  // Enemy-half structure: ramp faces RED (−Z), high edge on deck's −Z face
  // (z = -9.5 - 1.3 = -10.8).
  {
    type: "ramp",
    hx: 1.1,
    hy: CROUCH_RAMP_45.hy,
    hz: CROUCH_RAMP_45.hz,
    x: -11.5,
    y: CROUCH_RAMP_45.y,
    z: rampCenterZForHighEdge(
      -10.8,
      CROUCH_RAMP_45.hy,
      CROUCH_RAMP_45.hz,
      -0.45
    ),
    tiltRadians: -0.45,
  },
];

// Mid-ring cover for 3v3+ (45m / half ≈ 22.5). Sits in the band outside
// the original ~30m cluster (~|coord| > 14) so it doesn't overlap BASE_*.
// Same design language: denser west, sparser east, sightline breakers on
// the long N/S rim lanes that would otherwise open up.
const MID_RING_BOX_OBSTACLE_DEFS = [
  // Extend the center chokepoint's job: wing walls so wider maps can't
  // freely snipe past the ends of the original gap wall.
  { hx: 2.2, hy: 1.4, hz: 0.55, x: -12, z: 0 },
  // Was (13, 1.5) — clipped the east bridge's +Z ramp; parked further east.
  { hx: 2.0, hy: 1.3, hz: 0.5, x: 15, z: 1.5 },

  // West mid-ring: tight cover pocket (matches west-dense feel).
  { hx: 1.1, hy: 1.0, hz: 1.1, x: -17, z: 8 },
  { hx: 0.55, hy: 1.2, hz: 2.4, x: -18.5, z: -2 },
  { hx: 1.0, hy: 0.85, hz: 1.0, x: -16, z: -10 },

  // East mid-ring: lighter cover, keep a reposition lane.
  { hx: 0.5, hy: 0.95, hz: 2.0, x: 17, z: -8 },
  { hx: 1.0, hy: 0.7, hz: 0.9, x: 16, z: 5 },

  // North / south rim breakers — stop unbroken spawn-lane sightlines
  // along the expanded pad.
  { hx: 2.4, hy: 0.55, hz: 0.5, x: -8, z: -18 },
  { hx: 1.8, hy: 0.6, hz: 0.5, x: 9, z: -17 },
  { hx: 2.2, hy: 0.55, hz: 0.5, x: 6, z: 18 },
  // Was (-14, 16) — only 0.6m clear of the mid crouch underpass; nudged
  // east/south so bots can pass between crate and deck.
  { hx: 1.2, hy: 0.8, hz: 1.0, x: -13.2, z: 16.5 },
];

const MID_RING_PILLAR_OBSTACLE_DEFS = [
  { radius: 0.55, height: 2.3, x: -15.5, z: 4 },
  { radius: 0.5, height: 2.1, x: -17, z: -14 },
  { radius: 0.5, height: 2.4, x: 18, z: 2 },
  // Was (14, 14) — sat inside the mid-ring ground ramp footprint.
  { radius: 0.55, height: 2.0, x: 11.5, z: 14 },
  { radius: 0.5, height: 2.2, x: -6, z: 17 },
  { radius: 0.5, height: 2.3, x: 5, z: -18.5 },
];

const MID_RING_RAMP_OBSTACLE_DEFS = [
  // Climbable mound in the SE mid-ring (player side, east lane).
  { hx: 1.6, hy: 0.28, hz: 2.2, x: 15, z: 12, tiltRadians: 0.26 },
];

// Helper: standing deck + 4 corner legs + one access ramp. Used by the
// mid/outer rings so we don't hand-copy the same leg pattern each time.
// rampOnPositiveZ: true = approach from BLUE (+Z); false = from RED (−Z).
function makeStandingDeckPieces(x, z, hx, hz, rampOnPositiveZ = true) {
  const deckY = STANDING_PLATFORM_CLEARANCE + PLATFORM_DECK_HALF_THICKNESS;
  const legHy = STANDING_PLATFORM_CLEARANCE / 2;
  const leg = 0.15;
  const ramp = STANDING_RAMP_45;
  const tiltRadians = rampOnPositiveZ ? ramp.tiltRadians : -ramp.tiltRadians;
  const highEdgeZ = rampOnPositiveZ ? z + hz : z - hz;
  const zRamp = rampCenterZForHighEdge(highEdgeZ, ramp.hy, ramp.hz, tiltRadians);
  return [
    { type: "box", hx, hy: PLATFORM_DECK_HALF_THICKNESS, hz, x, y: deckY, z },
    { type: "box", hx: leg, hy: legHy, hz: leg, x: x - hx + leg, y: legHy, z: z - hz + leg },
    { type: "box", hx: leg, hy: legHy, hz: leg, x: x + hx - leg, y: legHy, z: z - hz + leg },
    { type: "box", hx: leg, hy: legHy, hz: leg, x: x - hx + leg, y: legHy, z: z + hz - leg },
    { type: "box", hx: leg, hy: legHy, hz: leg, x: x + hx - leg, y: legHy, z: z + hz - leg },
    {
      type: "ramp",
      hx: Math.min(hx, 1.3),
      hy: ramp.hy,
      hz: ramp.hz,
      x,
      y: ramp.y,
      z: zRamp,
      tiltRadians,
    },
  ];
}

function makeCrouchUnderpassPieces(x, z, rampOnPositiveZ = true) {
  const hx = 1.2;
  const hz = 1.2;
  const deckY = CROUCH_PLATFORM_CLEARANCE + PLATFORM_DECK_HALF_THICKNESS;
  const legHy = CROUCH_PLATFORM_CLEARANCE / 2;
  const leg = 0.12;
  const ramp = CROUCH_RAMP_45;
  const tiltRadians = rampOnPositiveZ ? ramp.tiltRadians : -ramp.tiltRadians;
  const highEdgeZ = rampOnPositiveZ ? z + hz : z - hz;
  const zRamp = rampCenterZForHighEdge(highEdgeZ, ramp.hy, ramp.hz, tiltRadians);
  return [
    { type: "box", hx, hy: PLATFORM_DECK_HALF_THICKNESS, hz, x, y: deckY, z },
    { type: "box", hx: leg, hy: legHy, hz: leg, x: x - hx + leg, y: legHy, z: z - hz + leg },
    { type: "box", hx: leg, hy: legHy, hz: leg, x: x + hx - leg, y: legHy, z: z - hz + leg },
    { type: "box", hx: leg, hy: legHy, hz: leg, x: x - hx + leg, y: legHy, z: z + hz - leg },
    { type: "box", hx: leg, hy: legHy, hz: leg, x: x + hx - leg, y: legHy, z: z + hz - leg },
    {
      type: "ramp",
      hx: 1.1,
      hy: ramp.hy,
      hz: ramp.hz,
      x,
      y: ramp.y,
      z: zRamp,
      tiltRadians,
    },
  ];
}

const MID_RING_ELEVATED_STRUCTURE_PIECE_DEFS = [
  // NE standing deck (enemy half) — ramp faces RED (−Z).
  ...makeStandingDeckPieces(17, -14, 1.5, 1.4, false),
  // SW crouch underpass (player half) — ramp faces BLUE (+Z).
  ...makeCrouchUnderpassPieces(-17, 14, true),
];

// Outer-ring cover for 5v5 (60m / half = 30). Fills |coord| ~22–27 so the
// biggest pad doesn't open into empty rim alleys. Still denser west,
// lighter east; adds another N/S sightline break layer.
const OUTER_RING_BOX_OBSTACLE_DEFS = [
  // Was x: -22 — only 0.45m clear of the mid-ring west wall on 5v5.
  { hx: 2.5, hy: 1.45, hz: 0.55, x: -23.2, z: 0 },
  { hx: 2.2, hy: 1.3, hz: 0.5, x: 23, z: -1 },
  { hx: 1.2, hy: 1.0, hz: 1.2, x: -24, z: 12 },
  // Was (-25, -6) — clipped through the outer west standing deck at (-24, -8).
  { hx: 0.55, hy: 1.15, hz: 2.6, x: -26.5, z: -3 },
  { hx: 1.1, hy: 0.85, hz: 1.1, x: -23, z: -18 },
  { hx: 0.5, hy: 0.95, hz: 2.2, x: 24, z: -14 },
  // Was (23, 8) — clipped the outer east deck's +Z access ramp.
  { hx: 1.0, hy: 0.75, hz: 0.95, x: 20.5, z: 9 },
  { hx: 2.6, hy: 0.55, hz: 0.5, x: -10, z: -25 },
  { hx: 2.0, hy: 0.6, hz: 0.5, x: 12, z: -24 },
  { hx: 2.4, hy: 0.55, hz: 0.5, x: 8, z: 25 },
  { hx: 1.3, hy: 0.85, hz: 1.1, x: -20, z: 22 },
  { hx: 1.0, hy: 0.7, hz: 1.0, x: 20, z: 20 },
];

const OUTER_RING_PILLAR_OBSTACLE_DEFS = [
  { radius: 0.55, height: 2.4, x: -22, z: 6 },
  // Was (-24, -12) — sat inside the flipped outer-west deck ramp (−Z).
  { radius: 0.5, height: 2.2, x: -27, z: -16 },
  { radius: 0.5, height: 2.3, x: 25, z: 0 },
  // Was (21, 16) — sat inside the outer SE ground ramp footprint.
  // Parked NW of the ramp (now at z: 15) and clear of the (20, 20) crate.
  { radius: 0.55, height: 2.1, x: 18, z: 17 },
  { radius: 0.5, height: 2.2, x: -8, z: 24 },
  { radius: 0.5, height: 2.4, x: 6, z: -25 },
  // Was (-18, 24) — only ~0.59m clear of the NW outer crate.
  { radius: 0.55, height: 2.0, x: -16.5, z: 24.5 },
  // Nudged south so it stays clear of the mid NE deck's −Z ramp on 5v5.
  { radius: 0.5, height: 2.3, x: 18, z: -23 },
];

const OUTER_RING_RAMP_OBSTACLE_DEFS = [
  { hx: 1.7, hy: 0.28, hz: 2.3, x: -22, z: -22, tiltRadians: 0.26 },
  // hz was 2.0 — too short for hy/tilt, so the walkable toe floated ~3.6cm
  // above ground. 2.2 matches the mid-ring mound and dips the top below y=0.
  // z nudged south to keep ≥ 1.2m clear of the outer east deck's +Z ramp.
  { hx: 1.5, hy: 0.28, hz: 2.2, x: 22, z: 15, tiltRadians: 0.26 },
];

const OUTER_RING_ELEVATED_STRUCTURE_PIECE_DEFS = [
  // Player-half east deck — ramp faces BLUE (+Z).
  ...makeStandingDeckPieces(24, 4, 1.5, 1.5, true),
  // Enemy-half west deck — ramp faces RED (−Z).
  ...makeStandingDeckPieces(-24, -8, 1.4, 1.3, false),
  // Enemy-half SE crouch underpass — ramp faces RED (−Z).
  ...makeCrouchUnderpassPieces(22, -22, false),
];

// Runtime layout filled by buildArenaCover() before physics/minimap run.
let boxObstacleDefs = [];
let pillarObstacleDefs = [];
let rampObstacleDefs = [];
let elevatedStructurePieceDefs = [];

// Cover visuals are composed prop groups (blast walls, containers,
// sandbags, columns, railed decks — see src/props.js) built inside each
// collider def's footprint, so gameplay geometry is untouched.
const arenaCoverMeshes = [];

function clearArenaCoverMeshes() {
  for (const object of arenaCoverMeshes) {
    scene.remove(object);
    disposeObjectGeometry(object);
  }
  arenaCoverMeshes.length = 0;
}

function cloneDefs(defs) {
  return defs.map((def) => ({ ...def }));
}

// Picks which cover rings to include for the arena size, then builds the
// Three.js meshes. Called from buildArena() so ground, walls, and cover
// always match the pre-match team-size preset.
function buildArenaCover(groundSize) {
  boxObstacleDefs = cloneDefs(BASE_BOX_OBSTACLE_DEFS);
  pillarObstacleDefs = cloneDefs(BASE_PILLAR_OBSTACLE_DEFS);
  rampObstacleDefs = cloneDefs(BASE_RAMP_OBSTACLE_DEFS);
  elevatedStructurePieceDefs = cloneDefs(BASE_ELEVATED_STRUCTURE_PIECE_DEFS);

  if (groundSize >= ARENA_SIZES["3v3"]) {
    boxObstacleDefs.push(...cloneDefs(MID_RING_BOX_OBSTACLE_DEFS));
    pillarObstacleDefs.push(...cloneDefs(MID_RING_PILLAR_OBSTACLE_DEFS));
    rampObstacleDefs.push(...cloneDefs(MID_RING_RAMP_OBSTACLE_DEFS));
    elevatedStructurePieceDefs.push(
      ...cloneDefs(MID_RING_ELEVATED_STRUCTURE_PIECE_DEFS)
    );
  }

  if (groundSize >= ARENA_SIZES["5v5"]) {
    boxObstacleDefs.push(...cloneDefs(OUTER_RING_BOX_OBSTACLE_DEFS));
    pillarObstacleDefs.push(...cloneDefs(OUTER_RING_PILLAR_OBSTACLE_DEFS));
    rampObstacleDefs.push(...cloneDefs(OUTER_RING_RAMP_OBSTACLE_DEFS));
    elevatedStructurePieceDefs.push(
      ...cloneDefs(OUTER_RING_ELEVATED_STRUCTURE_PIECE_DEFS)
    );
  }

  clearArenaCoverMeshes();
  // Deterministic prop variation per arena build.
  resetPropRandom();

  for (const box of boxObstacleDefs) {
    const prop = buildBoxCoverProp(box);
    scene.add(prop);
    arenaCoverMeshes.push(prop);
  }

  for (const pillar of pillarObstacleDefs) {
    const prop = buildColumnProp(pillar);
    scene.add(prop);
    arenaCoverMeshes.push(prop);
  }

  for (const ramp of rampObstacleDefs) {
    const prop = buildRampProp(ramp, ramp.hy, ramp.tiltRadians);
    scene.add(prop);
    arenaCoverMeshes.push(prop);
  }

  for (const piece of elevatedStructurePieceDefs) {
    let prop;
    if (piece.type === "ramp") {
      prop = buildRampProp(piece, piece.y, piece.tiltRadians);
    } else if (piece.hx <= 0.2 && piece.hz <= 0.2) {
      prop = buildLegProp(piece); // thin support legs
    } else {
      prop = buildDeckProp(piece); // walkable decks get railings
    }
    scene.add(prop);
    arenaCoverMeshes.push(prop);
  }

  // Cover stand-points for Hard-tier bots (Milestone 10) — rebuilt whenever
  // the arena cover layout changes with the team-size preset.
  buildCoverSlots();
}

// -----------------------------------------------------------------------
// Player movement tuning constants
// -----------------------------------------------------------------------
// Declared here (before the bot below) rather than further down near the
// Rapier setup that mostly uses them, so both can rely on it. The
// player's own capsule - fixed, not touched by the in-game hitbox debug
// view ("P"). BOT_RADIUS/BOT_HALF_HEIGHT below are the bots' own separate
// dimensions - the two used to be the same shared constant, but bots and
// the player are calibrated independently now (public/sandbox_hitbox.html)
// and don't need to match.
const PLAYER_RADIUS = 0.25;
// Half-height of just the capsule's cylindrical middle section (not
// counting the rounded caps), so total capsule height = 2 * (half + radius).
const PLAYER_HALF_HEIGHT = 0.62;
// How far above the capsule's center point the camera sits (roughly eye
// level, a bit below the very top of the capsule).
const EYE_HEIGHT = 0.8;

// Bots' own capsule dimensions - separate from PLAYER_RADIUS/
// PLAYER_HALF_HEIGHT above (see comment there). let, not const: live-
// tunable from the in-game hitbox debug view ("P") - see
// applyDebugBodyChange() below, which pushes changes into every live bot's
// Rapier capsule via setRadius()/setHalfHeight(), never the player's.
let BOT_RADIUS = 0.26;
let BOT_HALF_HEIGHT = 0.52;

// Crouch (Milestone 7): static height/speed change. Sprint+crouch also
// triggers a slide (below) layered on top of this same collider/camera
// height change.
// Total crouch height = 2 * (0.15 + 0.4) = 1.1m, which fits under the
// 1.35m low underpass with a bit of margin. Capsule is center-based, so
// entering/exiting crouch also shifts body Y by CROUCH_CENTER_OFFSET to
// keep the feet planted.
const CROUCH_HALF_HEIGHT = 0.15;
const CROUCH_EYE_HEIGHT = 0.35;
const CROUCH_MOVE_SPEED = 2.5; // half of MOVE_SPEED — clearly slower
const CROUCH_CENTER_OFFSET = PLAYER_HALF_HEIGHT - CROUCH_HALF_HEIGHT;
// Camera eases between standing/crouch eye height over this many seconds.
// Short on purpose — snappy like real FPS crouch, not a slow sit-down.
// Physics capsule still snaps immediately; only the view is smoothed.
const CROUCH_CAMERA_TRANSITION_SECONDS = 0.15;

const MOVE_SPEED = 5; // meters/second
// Sprint (modern-overhaul): hold Shift while moving forward. Blocked while
// crouching, aiming, or firing — standard modern-FPS rules.
const SPRINT_MOVE_SPEED = 7.6;
const JUMP_SPEED = 6; // initial upward velocity, in meters/second

// Slide: sprint + crouch triggers a speed burst that decays based on the
// ground slope underneath, layered on top of the crouch collider/camera
// change above. See getGroundSlopeInfo()/updateSlide() further down.
const SLIDE_INITIAL_SPEED_MULTIPLIER = 1.3; // applied to SPRINT_MOVE_SPEED
const SLIDE_MAX_DURATION_SECONDS = 1.6; // safety cap even on a long downhill
const SLIDE_MIN_SPEED = MOVE_SPEED; // slide exits once decayed below this
const SLIDE_MAX_SPEED = SPRINT_MOVE_SPEED * 1.6; // downhill accel cap
// Flat-ground decay is exponential smoothing toward SLIDE_MIN_SPEED; this
// time constant reaches ~98% decayed by ~1 second ("over ~1.0 second").
const SLIDE_FLAT_DECAY_TAU_SECONDS = 0.25;
const SLIDE_UPHILL_DECAY_TAU_SECONDS = SLIDE_FLAT_DECAY_TAU_SECONDS / 2; // 2x rate
const SLIDE_DOWNHILL_ACCEL = 1.5; // meters/second^2 while sliding downhill
const SLOPE_FLAT_THRESHOLD_RADIANS = 0.1745; // ~10 degrees
// Dead zone around perpendicular slope-crossing so classification doesn't
// flip-flop between the downhill/uphill branches right at the boundary.
const SLIDE_SLOPE_ALIGNMENT_DEADZONE = 0.15;
const SLIDE_GROUND_RAY_MARGIN = 0.3; // extra ray length past the capsule's feet
const SLIDE_CAMERA_ROLL_RADIANS = 0.061; // ~3.5 degrees
const SLIDE_CAMERA_ROLL_TRANSITION_SECONDS = 0.15;

// FOV states (modern-overhaul): base view, aim-down-sights zoom, and a
// slight sprint widen for a sense of speed. Blended smoothly in tick().
// These are VERTICAL FOV values tuned/playtested at FOV_REFERENCE_ASPECT
// (16:9) - three.js's PerspectiveCamera.fov is always vertical, but
// holding a fixed vertical FOV while the aspect ratio grows (ultrawide
// monitors) makes the equivalent HORIZONTAL FOV balloon, which reads as
// severe fisheye/stretching at the screen edges. convertVerticalFov()
// below derives the vertical FOV that keeps the HORIZONTAL FOV these
// constants imply at 16:9 constant across any aspect ratio, so gameplay
// feel is unchanged on a normal 16:9 monitor and ultrawide just gets a
// narrower vertical FOV to compensate instead of a wider horizontal one.
const BASE_FOV = 75;
const ADS_FOV = 52;
const SPRINT_FOV = 83;
const FOV_REFERENCE_ASPECT = 16 / 9;

// Converts a vertical FOV valid at `fromAspect` into the vertical FOV that
// preserves the same HORIZONTAL FOV at `toAspect`. Symmetric/general so it
// works both for "constant -> current aspect" (tick()'s FOV blending
// below) and "current aspect -> new aspect" (the resize listener, which
// has no access to which FOV state - hip/ADS/sprint/mid-transition - is
// currently active, so it re-derives from whatever camera.fov already is
// instead of re-selecting a target).
function convertVerticalFov(verticalFovDeg, fromAspect, toAspect) {
  const halfFromRad = THREE.MathUtils.degToRad(verticalFovDeg) / 2;
  const halfHorizontalRad = Math.atan(Math.tan(halfFromRad) * fromAspect);
  const halfToRad = Math.atan(Math.tan(halfHorizontalRad) / toAspect);
  return THREE.MathUtils.radToDeg(halfToRad * 2);
}

// Hip-fire vs ADS accuracy (modern-overhaul): shots now cone-spread when
// firing from the hip; aiming down sights makes them near-laser accurate.
const HIP_SPREAD_RADIANS = 0.016;
const ADS_SPREAD_RADIANS = 0.002;
// Headshots deal double damage. The head is a fully independent hitbox
// from the body capsule - not a region carved out of the capsule's
// surface via a proximity check (that was tried and had a real flaw: it
// forces the head zone to be smaller than the body everywhere they'd
// overlap, since the ray always reaches the nearer body surface first).
// Instead, a shot checks BOTH: the existing capsule raycast, and a plain
// ray-vs-sphere intersection against HEAD_HITBOX_OFFSET/HEAD_HITBOX_RADIUS
// (offset from bot.body.translation(), the capsule center) - whichever one
// the ray actually reaches first wins. See rayIntersectsSphere() below and
// public/sandbox_hitbox.html, which this was calibrated against.
const HEADSHOT_MULTIPLIER = 2;
// let, not const: live-tunable from the in-game hitbox debug view (see
// DEBUG_HITBOX_VIEW below) so calibration can happen against real, moving,
// rotating bots instead of only the static sandbox dummy.
let HEAD_HITBOX_OFFSET = { x: 0.1, y: 0.835, z: -0.125 };
let HEAD_HITBOX_RADIUS = 0.16;

// HEAD_HITBOX_OFFSET.x/z were calibrated against public/sandbox_hitbox.html,
// where the dummy never rotates - it's a WORLD-space nudge there. Real bots
// turn to face/track targets (bot.group.rotation.y), so applying that same
// offset directly in world space would only line up when a bot happens to
// face the exact direction the sandbox dummy faced, and drift everywhere
// else - this was very likely why headshots still felt inconsistent even
// after values matched the sandbox. Rotates X/Z by the bot's current facing
// yaw first (Y is untouched - vertical offset doesn't care about heading).
function getBotHeadCenter(bot, botTranslation) {
  const yaw = bot.group.rotation.y;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  return {
    x:
      botTranslation.x +
      HEAD_HITBOX_OFFSET.x * cosYaw +
      HEAD_HITBOX_OFFSET.z * sinYaw,
    y: botTranslation.y + HEAD_HITBOX_OFFSET.y,
    z:
      botTranslation.z -
      HEAD_HITBOX_OFFSET.x * sinYaw +
      HEAD_HITBOX_OFFSET.z * cosYaw,
  };
}

// Standard ray-vs-sphere intersection (unit-length direction assumed, true
// for every ray built in fireShot() below - each goes through .normalize()
// in applyAimSpread()). Returns the distance along the ray to the nearest
// point where it enters `radius` of `center`, or null if it misses (or the
// sphere is entirely behind the ray origin). This is the plain-math
// equivalent of what a second Rapier collider would give for free - see
// the comment above HEAD_HITBOX_OFFSET for why a real collider isn't used.
function rayIntersectsSphere(origin, direction, center, radius) {
  const ocX = origin.x - center.x;
  const ocY = origin.y - center.y;
  const ocZ = origin.z - center.z;
  const b = 2 * (ocX * direction.x + ocY * direction.y + ocZ * direction.z);
  const c = ocX * ocX + ocY * ocY + ocZ * ocZ - radius * radius;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return null;
  const sqrtDisc = Math.sqrt(discriminant);
  const nearT = (-b - sqrtDisc) / 2;
  const farT = (-b + sqrtDisc) / 2;
  const t = nearT >= 0 ? nearT : farT;
  return t >= 0 ? t : null;
}
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
const GUN_DAMAGE = 20; // 5 hits destroys the bot's 100 health
const GUN_RANGE = 100; // meters

// Full-auto fire rate, matched to BOT_FIRE_RATE_RPM so the player doesn't
// melt bots with a much faster gun — fights stay about aim/positioning.
// Converted to milliseconds between shots for timestamp comparisons.
const FIRE_RATE_RPM = 300;
const FIRE_INTERVAL_MS = 60000 / FIRE_RATE_RPM;

// Magazine + reload tuning - simple "arcade shooter" numbers (a full
// COD-style assault rifle mag, ~1.5-2s reload), not meant to be realistic.
const MAGAZINE_SIZE = 30;
const RELOAD_TIME_MS = 1800;
// Ammo is shown/flashed as "low" once at or below this fraction of a full
// magazine (30 * 0.2 = 6 rounds) - just a HUD warning cue, doesn't affect
// firing itself (that's still gated purely on currentAmmo > 0).
const LOW_AMMO_RATIO = 0.2;

// Weapon feedback (Milestone 11; reworked feat-scoring-system). Recoil has
// two layers stacked on top of each other:
//  - A PERMANENT kick baked directly into `pitch`/`yaw` - the same
//    variables mouse-look drives - clamped exactly like manual aiming. This
//    is what makes spraying a full magazine without pulling the mouse down
//    actually leave your crosshair above where you started; it only clears
//    the way normal aiming does; by you moving the mouse back down.
//  - A snappier, short-lived SNAP offset layered on top that decays fast
//    each frame, giving each shot a felt "pop" before settling onto the
//    new (permanently raised) baseline above. This is cosmetic timing only
//    - it's what makes a burst look punchy shot-to-shot - the lasting
//    aim consequence lives entirely in the permanent kick.
const RECOIL_PITCH_KICK = 0.006;
const RECOIL_YAW_KICK_MAX = 0.003;
const RECOIL_SNAP_PITCH_KICK = 0.02;
const RECOIL_SNAP_YAW_KICK_MAX = 0.01;
const RECOIL_SNAP_RECOVERY_PER_SECOND = 14;
const MUZZLE_FLASH_LIFETIME_MS = 50;
// Bot muzzle flash sprite (calibrated in public/sandbox_muzzle.html
// alongside BOT_MUZZLE_OFFSET above — re-run that sandbox before changing).
const BOT_MUZZLE_FLASH_TEXTURE_URL = "/assets/muzzle_flash.png";
const BOT_MUZZLE_FLASH_SCALE = 0.18;
const HIT_MARKER_LIFETIME_MS = 120;

// Footstep cadence (Milestone 12). Separate from movement code so we never
// spawn a sound every frame.
const PLAYER_FOOTSTEP_INTERVAL_MS = 360;
const PLAYER_SPRINT_FOOTSTEP_INTERVAL_MS = 270;
const PLAYER_CROUCH_FOOTSTEP_INTERVAL_MS = 520;
const BOT_FOOTSTEP_INTERVAL_MS = 420;

// Declared here (rather than down in the Player Health + HUD section)
// so the AI bot section below can set BOT_MAX_HEALTH equal to it - keeps
// the two guaranteed to match for balance instead of just coincidentally
// being the same number.
const PLAYER_MAX_HEALTH = 100;

// Health regeneration (both player and bot): after a stretch of time with
// no damage taken, health gradually climbs back toward max on its own -
// see regenPlayerHealth()/regenAllBotsHealth() further down.
const HEALTH_REGEN_DELAY_MS = 5000; // ~5 seconds of no damage before it starts
const HEALTH_REGEN_RATE_PER_SECOND = 8; // ~12.5s for a full regen from 0

// -----------------------------------------------------------------------
// AI bots (Milestones 5 + 10)
// -----------------------------------------------------------------------
// Multiple ally/enemy bots share one AI path; only difficulty parameters
// and team affiliation differ. BLUE = player + allies, RED = enemies
// (Visual Style in AGENTS.md).

// Kept equal to the player's own max health for balance.
const BOT_MAX_HEALTH = PLAYER_MAX_HEALTH;
const ENEMY_BOT_COLOR = 0xcc3333;
const ALLY_BOT_COLOR = 0x3366cc;

// -----------------------------------------------------------------------
// Team spawn points (variety on match start + each respawn)
// -----------------------------------------------------------------------
// BLUE = player's team on the +Z (south) side; RED = enemy team on the -Z
// (north) side. Points are hand-placed clear of Milestone 3 cover and M7
// platforms (capsule radius ~0.4 plus margin). Both zones stay on their
// own side of the center chokepoint so neither can immediately see/shoot
// into the other's spawn area. Picked via pickSafeSpawnPoint(), which
// filters out any point too close to a living player/bot.

const BLUE_TEAM_SPAWN_POINTS = [
  { x: 0, z: 5 }, // original center-south
  { x: 2.5, z: 9 },
  { x: 7, z: 11 },
  { x: -2, z: 12 },
  { x: 5.5, z: 6.5 },
  // Added for the larger bot roster: kept within the 1v1 pad (|coord| <=
  // 14, GROUND_HALF - 1 at the smallest arena size) so they stay valid on
  // every team-size preset, not just 5v5. Clustered near BASE_* cover
  // (west crate/pillar, west platform, east pillar) and the south rim so
  // respawns have more room to spread out.
  { x: -9, z: 2.2 }, // behind west crate, south side
  { x: -12.5, z: 8 }, // west rim, near the west platform
  { x: -5.5, z: 13.5 }, // south rim, near the ramp
  // x:9.5 z:4 clipped the East bridge's +Z access ramp (footprint extends
  // to z:5.28, well past the deck's own z:-0.2 edge) - moved north, clear.
  { x: 9.5, z: 8 }, // east flank, near the east pillar
  { x: 12.5, z: 3 }, // east rim
  { x: 3, z: 13 }, // south rim
  { x: -8.5, z: 12.5 }, // south rim, west side
];

const RED_TEAM_SPAWN_POINTS = [
  { x: 0, z: -5 }, // original center-north
  { x: -3.5, z: -7 },
  { x: 2.5, z: -9 },
  { x: 7, z: -11 },
  { x: -8, z: -5.5 },
  // Added for the larger bot roster: same |coord| <= 14 constraint as the
  // blue additions above, mirrored onto the north half but not a straight
  // mirror layout (keeps the west-dense/east-sparse cover asymmetry).
  { x: -7, z: -11.5 }, // north rim, near the crouch underpass
  { x: -11.5, z: -6.5 }, // west rim
  // x:9.5 z:-4.5 and x:11.5 z:-7.5 both clipped the East bridge's -Z access
  // ramp (footprint x:[8.7,11.3] z:[-9.28,-3.42] - much wider than the
  // deck box alone, which the original overlap check didn't account for).
  // Moved south/east, clear of the ramp.
  { x: 10.5, z: -11 }, // east flank
  { x: 12.5, z: -3 }, // east rim
  { x: -3, z: -13.5 }, // north rim
  { x: 3, z: -13.5 }, // north rim, near the low wall
  { x: 13, z: -9 }, // east rim
];

// Fisher-Yates shuffle of a shallow copy — used so match-start spawns don't
// stack multiple bots on the same point when counts > 1.
function shuffleSpawnPoints(spawnPoints) {
  const copy = spawnPoints.map((point) => ({ x: point.x, z: point.z }));
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

// Minimum clearance (meters) a spawn candidate must keep from every living
// player/bot. Below this a respawn can drop someone directly on top of an
// entity that's already standing there.
const SPAWN_PROXIMITY_RADIUS = 4;

// Spawn points only carry {x, z}; pin them to standing height so distance
// comparisons against live entity positions are stable.
function spawnPointToVector3(point) {
  return new THREE.Vector3(point.x, PLAYER_HALF_HEIGHT + PLAYER_RADIUS, point.z);
}

// Distance from a candidate spawn point to whichever living player/bot is
// closest to it.
function nearestLivingEntityDistance(point, livingPositions) {
  const candidateVec = spawnPointToVector3(point);
  let nearest = Infinity;
  for (const pos of livingPositions) {
    const distance = candidateVec.distanceTo(pos);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

// Proximity-filtered spawn pick: tries spawn points in random order and
// returns the first one with no living player/bot within
// SPAWN_PROXIMITY_RADIUS. If every point is that crowded, falls back to
// whichever point has the most clearance from its nearest entity.
function pickSafeSpawnPoint(spawnPoints, livingPositions) {
  const candidates = shuffleSpawnPoints(spawnPoints);
  let best = candidates[0];
  let bestClearance = -Infinity;
  for (const candidate of candidates) {
    const clearance = nearestLivingEntityDistance(candidate, livingPositions);
    if (clearance >= SPAWN_PROXIMITY_RADIUS) return candidate;
    if (clearance > bestClearance) {
      bestClearance = clearance;
      best = candidate;
    }
  }
  return best;
}

// Spawn "drop to floor": hardcoded spawn points only carry {x, z}, so a
// point placed over a ramp or elevated deck used to teleport entities to a
// fixed ground-level Y and leave them embedded in whatever's actually
// there. Instead, cast straight down from above every static collider in
// the arena (ground, ramps, elevated decks, blast-wall stacked layers -
// none of them are sensors or filtered, so an unfiltered ray hits all of
// them) and snap to rest exactly on the topmost surface at that column.
const SPAWN_DROP_RAY_START_Y = 10; // above the tallest deck/blast-wall (~3m)
const SPAWN_DROP_RAY_MAX_DISTANCE = 15;

// Y of the topmost static surface at (x, z), or 0 (bare ground) in the
// practically-impossible case nothing is hit - the ground slab collider
// spans the whole pad, so this is just a defensive floor.
function findSpawnSurfaceY(world, x, z, excludeCollider) {
  const ray = new RAPIER.Ray(
    { x, y: SPAWN_DROP_RAY_START_Y, z },
    { x: 0, y: -1, z: 0 }
  );
  const hit = world.castRay(
    ray,
    SPAWN_DROP_RAY_MAX_DISTANCE,
    true,
    undefined,
    undefined,
    excludeCollider
  );
  if (hit === null) return 0;
  // dir is unit-length, so timeOfImpact is already the drop distance.
  return SPAWN_DROP_RAY_START_Y - hit.timeOfImpact;
}

// Converts a {x, z} spawn point into a full translation resting exactly on
// top of whatever's physically there. excludeCollider is optional - pass
// the entity's own collider when respawning so the ray can't hit its old
// (soon-to-be-vacated) position; omit it at creation time, when no such
// collider exists yet. halfHeight/radius default to the player's own
// capsule - bot call sites (botStandingSpawnTranslation()/
// getRedTeamSpawnTranslation() below) pass BOT_HALF_HEIGHT/BOT_RADIUS
// explicitly instead, since the two are no longer the same size.
function snapSpawnPointToFloor(
  world,
  point,
  excludeCollider,
  halfHeight = PLAYER_HALF_HEIGHT,
  radius = PLAYER_RADIUS
) {
  const surfaceY = findSpawnSurfaceY(world, point.x, point.z, excludeCollider);
  return {
    x: point.x,
    y: surfaceY + halfHeight + radius,
    z: point.z,
  };
}

// Player-only (respawnPlayer()) - uses the default player capsule size above.
function getBlueTeamSpawnTranslation(world, livingPositions, excludeCollider) {
  const point = pickSafeSpawnPoint(BLUE_TEAM_SPAWN_POINTS, livingPositions);
  return snapSpawnPointToFloor(world, point, excludeCollider);
}

// Bot-only (enemy respawn) - see botStandingSpawnTranslation() below for
// the same reasoning on ally bots.
function getRedTeamSpawnTranslation(world, livingPositions, excludeCollider) {
  const point = pickSafeSpawnPoint(RED_TEAM_SPAWN_POINTS, livingPositions);
  return snapSpawnPointToFloor(world, point, excludeCollider, BOT_HALF_HEIGHT, BOT_RADIUS);
}

// Bot-only (creation + ally respawn) - see getRedTeamSpawnTranslation() above.
function botStandingSpawnTranslation(world, point, excludeCollider) {
  return snapSpawnPointToFloor(world, point, excludeCollider, BOT_HALF_HEIGHT, BOT_RADIUS);
}

// How far a bot can "see" a hostile - same scale as the player's GUN_RANGE.
const BOT_SIGHT_RANGE = 100;
// Medium-tier defaults (also the pre-match menu's default difficulty).
const BOT_REACTION_DELAY_MS = 500;
// Same cadence as the player's gun — bot pacing comes from reaction delay
// + aim spread + turn speed + cover, not a slower RPM.
const BOT_FIRE_RATE_RPM = 300;
const BOT_FIRE_INTERVAL_MS = 60000 / BOT_FIRE_RATE_RPM;
const BOT_DAMAGE_PER_HIT = 10; // 10 hits to kill the player
const BOT_AIM_SPREAD_RADIANS = 0.035;

// Difficulty tiers from the pre-match menu. Same AI logic for all three —
// only these parameters change (per AGENTS.md).
// Movement realism (modern-overhaul v2) also scales per tier:
//   moveSpeed        — patrol/chase speed (easy plods, hard hustles)
//   strafes          — whether the bot side-steps while engaging
//   strafeSpeed      — lateral speed of that combat strafe
//   pauseAtWaypointMs— [min,max] "look around" dwell after reaching a point
const DIFFICULTY_TIERS = {
  easy: {
    reactionDelayMs: 900,
    aimSpreadRadians: 0.08,
    turnSpeedRadiansPerSec: Math.PI * 0.55, // ~100 deg/s — sluggish
    usesCover: false,
    moveSpeed: 2.3,
    strafes: false,
    strafeSpeed: 0,
    pauseAtWaypointMs: [1200, 2600],
  },
  medium: {
    reactionDelayMs: BOT_REACTION_DELAY_MS,
    aimSpreadRadians: BOT_AIM_SPREAD_RADIANS,
    turnSpeedRadiansPerSec: Math.PI, // 180 deg/s
    usesCover: false,
    moveSpeed: 3.0,
    strafes: true,
    strafeSpeed: 1.5,
    pauseAtWaypointMs: [600, 1400],
  },
  hard: {
    reactionDelayMs: 250,
    aimSpreadRadians: 0.015,
    turnSpeedRadiansPerSec: Math.PI * 1.5, // ~270 deg/s — snappy
    usesCover: true,
    moveSpeed: 3.8,
    strafes: true,
    strafeSpeed: 2.4,
    pauseAtWaypointMs: [250, 700],
  },
};

// Bot movement (patrol/chase/cover) tuning - see updateBot()/moveBotTowards().
const BOT_MOVE_SPEED = 3; // meters/second - slower than the player's 5
const BOT_AIM_ANGLE_THRESHOLD_RADIANS = 0.05; // ~3 degrees
const BOT_WAYPOINT_ARRIVAL_RADIUS = 1.5;
const BOT_MOVE_TIMEOUT_MS = 6000;
// After taking damage, Hard bots keep seeking cover for this long.
const COVER_SEEK_WINDOW_MS = 3000;

// Fallback patrol waypoints near the base-cluster cover (not tactical
// cover-seeking — that's buildCoverSlots() + usesCover below).
const BOT_PATROL_POINTS = [
  { x: -9, z: 7.5 },
  { x: -7, z: -12 },
  { x: 10, z: -6 },
  { x: 9, z: 6 },
  { x: 4, z: -10 },
  { x: -4, z: -1 },
];

// Crouch-underpass footprints (feat-scoring-polish-and-bot-fixes): bots use
// the same standing-height capsule as the player with no crouch mechanic
// (see createBotInstance()), so these low-ceiling decks are a bot trap -
// excluded from patrol/cover/chase targets below, the same way spawn
// points already avoid the east bridge's ramp footprint. Coordinates match
// the deck definitions (the hand-written NW box at line ~617, and the two
// makeCrouchUnderpassPieces() calls); margin covers the bot capsule radius
// plus slop so they route clear of the deck edge instead of clipping it.
const CROUCH_UNDERPASS_FOOTPRINTS = [
  { x: -11.5, z: -9.5, hx: 1.3 + BOT_RADIUS + 0.6, hz: 1.3 + BOT_RADIUS + 0.6 }, // NW, enemy half (1v1+)
  { x: -17, z: 14, hx: 1.2 + BOT_RADIUS + 0.6, hz: 1.2 + BOT_RADIUS + 0.6 }, // SW, player half (3v3+)
  { x: 22, z: -22, hx: 1.2 + BOT_RADIUS + 0.6, hz: 1.2 + BOT_RADIUS + 0.6 }, // SE, enemy half (5v5)
];

// Ramp-underside exclusion: standing bridges (makeStandingDeckPieces) have
// plenty of clearance to walk *under* the deck itself, but the ramp
// connecting ground to deck is a solid tilted box - the wedge-shaped gap
// underneath it narrows to nothing, and a bot that wanders into it gets
// physically wedged against its underside (same failure mode as the
// crouch underpasses above, different geometry). Derived live from
// elevatedStructurePieceDefs (rebuilt per arena size by buildArenaCover())
// instead of hardcoded like CROUCH_UNDERPASS_FOOTPRINTS, so it
// automatically covers every ramp on every tier - including the ground-
// level standing decks' ramps and any future ones - without needing to be
// kept in sync by hand. rampObstacleDefs (climbable ground mounds, no
// underside void) are a different thing and aren't included here.
function rampExclusionFootprints() {
  const margin = BOT_RADIUS + 0.6;
  return elevatedStructurePieceDefs
    .filter((piece) => piece.type === "ramp")
    .map((ramp) => ({
      x: ramp.x,
      z: ramp.z,
      hx: ramp.hx + margin,
      hz: ramp.hz + margin,
    }));
}

function pointBlockedForBotNavigation(x, z) {
  for (const zone of CROUCH_UNDERPASS_FOOTPRINTS) {
    if (Math.abs(x - zone.x) < zone.hx && Math.abs(z - zone.z) < zone.hz) {
      return true;
    }
  }
  for (const zone of rampExclusionFootprints()) {
    if (Math.abs(x - zone.x) < zone.hx && Math.abs(z - zone.z) < zone.hz) {
      return true;
    }
  }
  return false;
}

// Stand-points beside solid cover, rebuilt by buildCoverSlots() after
// buildArenaCover(). Hard bots peel here after taking damage.
let coverSlots = [];

function pointOverlapsSolidCover(x, z) {
  for (const box of boxObstacleDefs) {
    if (
      Math.abs(x - box.x) < box.hx + BOT_RADIUS * 0.5 &&
      Math.abs(z - box.z) < box.hz + BOT_RADIUS * 0.5
    ) {
      return true;
    }
  }
  for (const pillar of pillarObstacleDefs) {
    if (Math.hypot(x - pillar.x, z - pillar.z) < pillar.radius + BOT_RADIUS * 0.5) {
      return true;
    }
  }
  return false;
}

function buildCoverSlots() {
  coverSlots = [];
  const margin = BOT_RADIUS + 0.4;
  // Stay inside the pad so bots don't path into boundary walls.
  const padLimit = GROUND_HALF - 1;

  function tryAddSlot(x, z) {
    if (Math.abs(x) > padLimit || Math.abs(z) > padLimit) return;
    if (pointOverlapsSolidCover(x, z)) return;
    if (pointBlockedForBotNavigation(x, z)) return;
    coverSlots.push({ x, z });
  }

  for (const box of boxObstacleDefs) {
    tryAddSlot(box.x + box.hx + margin, box.z);
    tryAddSlot(box.x - box.hx - margin, box.z);
    tryAddSlot(box.x, box.z + box.hz + margin);
    tryAddSlot(box.x, box.z - box.hz - margin);
  }
  for (const pillar of pillarObstacleDefs) {
    const distance = pillar.radius + margin;
    tryAddSlot(pillar.x + distance, pillar.z);
    tryAddSlot(pillar.x - distance, pillar.z);
    tryAddSlot(pillar.x, pillar.z + distance);
    tryAddSlot(pillar.x, pillar.z - distance);
  }
}

// Live bot list for the current match + collider→bot lookup for hitscan.
const bots = [];
const colliderToBot = new Map();

// Debug body-collider offset (feat-scoring-polish-and-bot-fixes): BOT_RADIUS/
// BOT_HALF_HEIGHT above are already bot-exclusive (never read by anything
// player-related), so the debug body sliders mutate those two directly -
// no separate shadow copy needed. This offset has no equivalent "real"
// constant to mutate (bots have never had a body-position offset concept),
// so it stays its own dedicated debug variable, applied relative to
// bot.body.translation() via Rapier's setTranslationWrtParent() -
// world-space, not rotated by the bot's facing
// (unlike getBotHeadCenter()'s math check, this is a real physics collider,
// and continuously re-rotating it every frame to track facing risks
// physics instability for little payoff). This is fine for calibration
// since the debug view only runs while DEBUG_FREEZE_BOTS holds bots
// stationary - not meant to be pasted in as a permanent offset for bots
// that actually rotate in normal play. If you find you need a nonzero
// value here, it likely means the model's fit needs correcting instead
// (mirrors the capsuleOffset note in public/sandbox_hitbox.html).
let debugBotBodyOffset = { x: 0, y: 0, z: 0 };

// Debug hitbox wireframes: body capsule + head sphere, parented to a bot's
// `group` so they automatically track its position AND rotation every
// frame for free - group.position is synced to bot.body.translation() each
// frame (see the tick() loop), and a child's local position gets the
// group's rotation.y applied by Three.js's normal parent-child transform,
// which is the exact same math getBotHeadCenter() does by hand for the
// real hit-test. Hidden by default; toggled by "P" alongside
// DEBUG_FREEZE_BOTS - see buildDebugHitboxPanel() below.
function createDebugHitboxMeshes(group) {
  const bodyGeo = new THREE.CapsuleGeometry(BOT_RADIUS, BOT_HALF_HEIGHT * 2, 4, 12);
  const bodyMat = new THREE.MeshBasicMaterial({
    color: 0xffd977,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.visible = false;
  group.add(body);

  const headGeo = new THREE.SphereGeometry(1, 16, 12);
  const headMat = new THREE.MeshBasicMaterial({
    color: 0xff5b45,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.visible = false;
  group.add(head);

  return { body, head };
}

// Re-applies the live HEAD_HITBOX_OFFSET/HEAD_HITBOX_RADIUS to one bot's
// debug head-sphere mesh - called once at bot creation, and again for
// every living bot whenever a head slider changes.
function updateDebugHeadMesh(bot) {
  const meshes = bot.debugHitboxMeshes;
  if (!meshes) return;
  meshes.head.position.set(
    HEAD_HITBOX_OFFSET.x,
    HEAD_HITBOX_OFFSET.y,
    HEAD_HITBOX_OFFSET.z
  );
  meshes.head.scale.setScalar(HEAD_HITBOX_RADIUS);
}

// Rebuilds one bot's debug body-capsule wireframe geometry/position to
// match the live BOT_RADIUS/BOT_HALF_HEIGHT/debugBotBodyOffset -
// called whenever a body slider changes. Geometry has to be replaced
// outright (not just scaled) since a capsule's radius and half-height
// aren't independently expressible as a uniform mesh scale.
function updateDebugBodyMesh(bot) {
  const meshes = bot.debugHitboxMeshes;
  if (!meshes) return;
  meshes.body.geometry.dispose();
  meshes.body.geometry = new THREE.CapsuleGeometry(
    BOT_RADIUS,
    BOT_HALF_HEIGHT * 2,
    4,
    12
  );
  meshes.body.position.set(
    debugBotBodyOffset.x,
    debugBotBodyOffset.y,
    debugBotBodyOffset.z
  );
}

// Where a bot's rifle muzzle sits in bot.group-local space — used for
// muzzle flash + tracers. Calibrated in public/sandbox_muzzle.html against
// the GLB SWAT model's actual "shoot" pose (see that file for the live-
// tuning tool this came from — re-run it there before changing this value).
const BOT_MUZZLE_OFFSET = new THREE.Vector3(0.077, 0.468, -0.747);

// -----------------------------------------------------------------------
// Floating health bars (one per bot, above its head)
// -----------------------------------------------------------------------
// HTML/CSS overlay like the rest of the HUD. Enemy bars are LOS-gated;
// ally bars stay always-visible for team awareness. Team colors match
// capsules / minimap (blue allies, red enemies).

const BOT_HEALTH_BAR_HEIGHT_OFFSET = BOT_HALF_HEIGHT + BOT_RADIUS + 0.35;

function createFloatingHealthBar(color, { isEnemy = true } = {}) {
  const container = document.createElement("div");
  container.className = "floating-health-bar";

  const fill = document.createElement("div");
  fill.className = "floating-health-bar-fill";
  fill.style.backgroundColor = color;
  container.appendChild(fill);

  document.body.appendChild(container);
  return { container, fill, isEnemy };
}

function updateFloatingHealthBarFill(bar, healthPercent) {
  bar.fill.style.width = `${healthPercent}%`;
}

function updateFloatingHealthBarPosition(bar, worldPosition, visible = true) {
  const projected = new THREE.Vector3(
    worldPosition.x,
    worldPosition.y,
    worldPosition.z
  ).project(camera);

  const isBehindCamera = projected.z > 1;
  const isOffScreen = Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
  if (!visible || isBehindCamera || isOffScreen) {
    bar.container.style.display = "none";
    return;
  }

  bar.container.style.display = "block";
  bar.container.style.left = `${((projected.x + 1) / 2) * window.innerWidth}px`;
  bar.container.style.top = `${((1 - projected.y) / 2) * window.innerHeight}px`;
}

function createMinimapDot(team) {
  const el = document.createElement("div");
  el.className =
    team === "blue"
      ? "minimap-dot minimap-dot-blue"
      : "minimap-dot minimap-dot-red";
  document.getElementById("minimap").appendChild(el);
  return el;
}

// Creates one bot instance (mesh + Rapier body + AI/difficulty state).
// team is "blue" (ally) or "red" (enemy). tier is a DIFFICULTY_TIERS entry.
function createBotInstance(world, team, spawnPoint, tier) {
  const teamColor = team === "blue" ? ALLY_BOT_COLOR : ENEMY_BOT_COLOR;
  // GLB SWAT model when assets loaded; procedural soldier as fallback.
  // Both put their origin at the capsule center.
  if (gameAssets?.botTemplate == null) {
    console.error(
      "createBotInstance: SWAT GLB not loaded yet — spawning procedural " +
        "placeholder (check asset load order / network errors above)"
    );
  }
  const model =
    gameAssets?.botTemplate != null
      ? buildSwatModel(team, gameAssets)
      : buildSoldierModel(team);
  const group = model.group;
  const spawn = botStandingSpawnTranslation(world, spawnPoint);
  group.position.set(spawn.x, spawn.y, spawn.z);
  scene.add(group);

  // Each bot needs its own character controller — computedMovement() is
  // stateful per controller, so sharing one would corrupt whoever ran second.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawn.x,
      spawn.y,
      spawn.z
    )
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(BOT_HALF_HEIGHT, BOT_RADIUS),
    body
  );
  const characterController = world.createCharacterController(0.01);

  const healthBar = createFloatingHealthBar(
    `#${teamColor.toString(16).padStart(6, "0")}`,
    { isEnemy: team === "red" }
  );
  updateFloatingHealthBarFill(healthBar, 100);

  const bot = {
    team,
    teamColor,
    body,
    collider,
    characterController,
    group,
    model,
    materials: model.materials,
    // Set true by moveBotTowards() each frame the bot actually walks;
    // consumed (and cleared) by the per-frame model sync for the walk cycle.
    isWalking: false,
    healthBar,
    minimapDot: createMinimapDot(team),
    health: BOT_MAX_HEALTH,
    destroyed: false,
    spottedAtTime: null,
    lastShotTime: -Infinity,
    lastDamageTime: -Infinity,
    invulnerableUntil: -Infinity,
    lastKnownTargetPosition: null,
    moveTarget: null,
    moveTargetSetAt: 0,
    lastPatrolPointIndex: -1,
    coverTarget: null,
    // After arriving at a cover slot, stay put until the under-fire window
    // ends so Hard bots don't immediately path to another slot.
    holdingCover: false,
    lastFootstepAt: -Infinity,
    // Gravity (feat-scoring-polish-and-bot-fixes): bots have no explicit
    // downward force otherwise, unlike the player's verticalVelocity in
    // tick() - see resolveBotMovement(). pendingMoveX/Z hold this frame's
    // desired horizontal velocity, set by moveBotByDirection()/
    // applyCombatStrafe() and consumed once per frame by
    // resolveBotMovement(), so gravity and horizontal movement always
    // resolve together in a single computeColliderMovement() call instead
    // of two calls silently overwriting each other.
    verticalVelocity: 0,
    pendingMoveX: 0,
    pendingMoveZ: 0,
    // Movement realism state (modern-overhaul v2).
    strafeDirection: 1, // +1 / -1, flipped on a timer while engaging
    strafeSwitchAt: 0,
    pauseUntil: 0, // waypoint "look around" dwell
    scanYawTarget: null, // idle scan direction while paused
    // Copied from the match difficulty tier — same AI, different knobs.
    reactionDelayMs: tier.reactionDelayMs,
    aimSpreadRadians: tier.aimSpreadRadians,
    turnSpeedRadiansPerSec: tier.turnSpeedRadiansPerSec,
    usesCover: tier.usesCover,
    moveSpeed: tier.moveSpeed,
    strafes: tier.strafes,
    strafeSpeed: tier.strafeSpeed,
    pauseAtWaypointMs: tier.pauseAtWaypointMs,
    debugHitboxMeshes: createDebugHitboxMeshes(group),
  };
  updateDebugHeadMesh(bot);

  colliderToBot.set(collider, bot);
  return bot;
}

// Spawns ally + enemy bots from matchConfig counts. blueSpawns/redSpawns
// should already be shuffled; allyIndex is the first unused blue slot
// (index 0 is reserved for the player at match start).
function spawnBotsForMatch(world, blueSpawns, redSpawns, allyStartIndex) {
  bots.length = 0;
  colliderToBot.clear();

  const tier =
    DIFFICULTY_TIERS[matchConfig.difficulty] ?? DIFFICULTY_TIERS.medium;

  let blueIndex = allyStartIndex;
  for (let i = 0; i < matchConfig.allyBots; i++) {
    const point = blueSpawns[blueIndex % blueSpawns.length];
    blueIndex += 1;
    bots.push(createBotInstance(world, "blue", point, tier));
  }

  for (let i = 0; i < matchConfig.enemyBots; i++) {
    const point = redSpawns[i % redSpawns.length];
    bots.push(createBotInstance(world, "red", point, tier));
  }
}

// -----------------------------------------------------------------------
// Audio (Milestone 12) — Web Audio API, synthesized one-shots
// -----------------------------------------------------------------------
// No sound files / no Howler: short oscillators + noise keep the project
// dependency-free and Vercel-static friendly. AudioContext must start
// (or resume) from a user gesture — splash Continue / Start Match / Resume.

let audioCtx = null;
let masterGain = null;
let sfxGain = null;
let audioListener = null;

function ensureAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.45;
    masterGain.connect(audioCtx.destination);
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 1;
    sfxGain.connect(masterGain);
    // Spatial footsteps/gunshots need a listener that tracks the camera.
    if (audioCtx.listener) {
      audioListener = audioCtx.listener;
    }
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function updateAudioListenerFromCamera() {
  if (!audioCtx || !audioListener) return;
  const pos = camera.position;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const up = new THREE.Vector3(0, 1, 0);
  if (typeof audioListener.positionX !== "undefined") {
    audioListener.positionX.value = pos.x;
    audioListener.positionY.value = pos.y;
    audioListener.positionZ.value = pos.z;
    audioListener.forwardX.value = forward.x;
    audioListener.forwardY.value = forward.y;
    audioListener.forwardZ.value = forward.z;
    audioListener.upX.value = up.x;
    audioListener.upY.value = up.y;
    audioListener.upZ.value = up.z;
  } else if (audioListener.setPosition) {
    audioListener.setPosition(pos.x, pos.y, pos.z);
    audioListener.setOrientation(
      forward.x,
      forward.y,
      forward.z,
      up.x,
      up.y,
      up.z
    );
  }
}

function createNoiseBuffer(durationSeconds) {
  const ctx = ensureAudio();
  if (!ctx) return null;
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * durationSeconds));
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// Plays a short tone burst. Optional worldPosition enables a PannerNode
// so bot footsteps/gunshots feel spatial without a full 3D audio system.
function playSynthSound({
  type = "square",
  frequency = 440,
  duration = 0.08,
  volume = 0.2,
  frequencyEnd = null,
  noise = false,
  worldPosition = null,
  // Optional biquad filter for more natural timbres — raw oscillators and
  // white noise sound "beepy"; filtered noise reads as real-world thud/
  // crack/scuff. filterFrequencyEnd sweeps the cutoff over the duration.
  filterType = null,
  filterFrequency = 1000,
  filterFrequencyEnd = null,
  filterQ = 0.8,
}) {
  const ctx = ensureAudio();
  if (!ctx || !sfxGain) return;

  const now = ctx.currentTime;
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  let source;
  if (noise) {
    const buffer = createNoiseBuffer(duration);
    if (!buffer) return;
    source = ctx.createBufferSource();
    source.buffer = buffer;
  } else {
    source = ctx.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency, now);
    if (frequencyEnd !== null) {
      source.frequency.exponentialRampToValueAtTime(
        Math.max(1, frequencyEnd),
        now + duration
      );
    }
  }

  // Insert the filter between source and gain when requested.
  let head = source;
  if (filterType) {
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFrequency, now);
    if (filterFrequencyEnd !== null) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, filterFrequencyEnd),
        now + duration
      );
    }
    filter.Q.value = filterQ;
    source.connect(filter);
    head = filter;
  }

  if (worldPosition && ctx.createPanner) {
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 4;
    panner.maxDistance = 60;
    panner.rolloffFactor = 1.2;
    if (typeof panner.positionX !== "undefined") {
      panner.positionX.value = worldPosition.x;
      panner.positionY.value = worldPosition.y;
      panner.positionZ.value = worldPosition.z;
    } else if (panner.setPosition) {
      panner.setPosition(worldPosition.x, worldPosition.y, worldPosition.z);
    }
    head.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(sfxGain);
  } else {
    head.connect(gainNode);
    gainNode.connect(sfxGain);
  }

  source.start(now);
  source.stop(now + duration + 0.02);
}

// Layered rifle shot (modern-overhaul v2): sharp filtered crack + low
// chest thump + a short lowpass "air" tail. Own shots are louder/fuller;
// bot shots keep the spatial panner and a thinner mix.
function playGunshotSound(worldPosition = null) {
  const own = !worldPosition;
  // Crack: noise burst swept down through a bandpass.
  playSynthSound({
    noise: true,
    duration: 0.05,
    volume: own ? 0.3 : 0.14,
    filterType: "bandpass",
    filterFrequency: 2600,
    filterFrequencyEnd: 900,
    filterQ: 0.7,
    worldPosition,
  });
  // Thump: low sine punch.
  playSynthSound({
    type: "sine",
    frequency: 130,
    frequencyEnd: 45,
    duration: 0.12,
    volume: own ? 0.22 : 0.1,
    worldPosition,
  });
  // Tail: soft lowpassed noise decay ("report" echo off the compound).
  playSynthSound({
    noise: true,
    duration: own ? 0.28 : 0.18,
    volume: own ? 0.07 : 0.04,
    filterType: "lowpass",
    filterFrequency: 900,
    filterFrequencyEnd: 180,
    worldPosition,
  });
}

// Boot scuff on concrete: short lowpassed noise, pitch-varied so repeated
// steps don't sound machine-like.
function playFootstepSound(worldPosition = null, quiet = false) {
  playSynthSound({
    noise: true,
    duration: 0.05,
    volume: quiet ? 0.035 : worldPosition ? 0.05 : 0.075,
    filterType: "lowpass",
    filterFrequency: 380 + Math.random() * 260,
    filterQ: 0.6,
    worldPosition,
  });
}

// Mag-out clack, mag-in seat, bolt release — three mechanical transients.
function playReloadSound() {
  playSynthSound({
    noise: true,
    duration: 0.045,
    volume: 0.12,
    filterType: "bandpass",
    filterFrequency: 1500,
    filterQ: 1.4,
  });
  setTimeout(() => {
    playSynthSound({
      noise: true,
      duration: 0.05,
      volume: 0.14,
      filterType: "bandpass",
      filterFrequency: 900,
      filterQ: 1.2,
    });
  }, 550);
  setTimeout(() => {
    playSynthSound({
      noise: true,
      duration: 0.06,
      volume: 0.16,
      filterType: "bandpass",
      filterFrequency: 1900,
      filterQ: 1.1,
    });
    playSynthSound({
      type: "sine",
      frequency: 260,
      frequencyEnd: 180,
      duration: 0.06,
      volume: 0.06,
    });
  }, 1250);
}

function playHitTakenSound() {
  playSynthSound({
    type: "sawtooth",
    frequency: 140,
    frequencyEnd: 70,
    duration: 0.12,
    volume: 0.16,
  });
}

function playRegenStartSound() {
  playSynthSound({
    type: "sine",
    frequency: 520,
    frequencyEnd: 680,
    duration: 0.15,
    volume: 0.07,
  });
}

function playRegenCompleteSound() {
  playSynthSound({
    type: "sine",
    frequency: 700,
    frequencyEnd: 900,
    duration: 0.18,
    volume: 0.08,
  });
}

function playDeathSound() {
  playSynthSound({
    type: "sawtooth",
    frequency: 110,
    frequencyEnd: 40,
    duration: 0.35,
    volume: 0.18,
  });
}

function playKillSound() {
  playSynthSound({
    type: "square",
    frequency: 660,
    frequencyEnd: 990,
    duration: 0.1,
    volume: 0.1,
  });
}

// -----------------------------------------------------------------------
// Input handling: keyboard state + mouse look + pointer lock
// -----------------------------------------------------------------------

// Debug test-mode toggles (feat-ballistics-polish): "P" flips both at once
// so a shot can be lined up on a stationary bot up close, safely, to check
// impact-particle visuals without the bot moving/shooting back or actually
// dying/dealing damage. DEBUG_FREEZE_BOTS is read in updateBot() (early
// return skips all movement/aim/fire logic); DEBUG_GOD_MODE is read in
// damagePlayer(). Not persisted - always off on a fresh page load.
let DEBUG_FREEZE_BOTS = false;
let DEBUG_GOD_MODE = false;

// -----------------------------------------------------------------------
// Hitbox debug view (feat-scoring-polish-and-bot-fixes)
// -----------------------------------------------------------------------
// Toggled by the same "P" press as DEBUG_FREEZE_BOTS above. Sliders live-
// tune HEAD_HITBOX_OFFSET/HEAD_HITBOX_RADIUS directly - immediately
// affecting the real fireShot() headshot check on every bot, not just a
// preview - so calibration can happen against real, moving, rotating bots
// instead of only the static public/sandbox_hitbox.html dummy.

const debugHitboxPanel = document.getElementById("debug-hitbox-panel");
const debugHitboxSlidersEl = document.getElementById("debug-hitbox-sliders");
const debugHitboxOutputEl = document.getElementById("debug-hitbox-output");
const debugHitboxCopyButton = document.getElementById("debug-hitbox-copy");
let debugHitboxPanelBuilt = false;

function refreshDebugHitboxOutput() {
  const p2 = (v) => v.toFixed(2);
  const p3 = (v) => v.toFixed(3);
  const offset = debugBotBodyOffset;
  const offsetLine =
    offset.x === 0 && offset.y === 0 && offset.z === 0
      ? ""
      : `\n// Non-zero body collider offset (${p3(offset.x)}, ${p3(offset.y)}, ${p3(offset.z)}),\n` +
        `// applied in world space, only meaningful while bots are frozen (debug\n` +
        `// mode) - likely means the VISUAL MODEL's fit needs correcting instead\n` +
        `// (see fitSkeletonToCapsule()/BOT_MODEL_Z_OFFSET-style tweak in\n` +
        `// src/botmodel.js), not that bots should carry a permanent world-space\n` +
        `// collider offset that would drift as they rotate in normal play.\n`;
  debugHitboxOutputEl.textContent =
    `// Bot body hitbox (createBotInstance() in src/main.js) - separate from\n` +
    `// PLAYER_RADIUS/PLAYER_HALF_HEIGHT, the player's own collider is left\n` +
    `// untouched by this panel on purpose:\n` +
    `const BOT_RADIUS = ${p2(BOT_RADIUS)};\n` +
    `const BOT_HALF_HEIGHT = ${p2(BOT_HALF_HEIGHT)};` +
    offsetLine +
    `\n// Head hitbox (fireShot() in src/main.js):\n` +
    `const HEAD_HITBOX_OFFSET = { x: ${p3(HEAD_HITBOX_OFFSET.x)}, y: ${p3(HEAD_HITBOX_OFFSET.y)}, z: ${p3(HEAD_HITBOX_OFFSET.z)} };\n` +
    `const HEAD_HITBOX_RADIUS = ${p3(HEAD_HITBOX_RADIUS)};`;
}

// Re-syncs every living bot's debug head-sphere wireframe - called after a
// head slider moves.
function applyDebugHeadChange() {
  for (const bot of bots) updateDebugHeadMesh(bot);
  refreshDebugHitboxOutput();
}

// Pushes new body dimensions/offset into every LIVE bot's Rapier capsule
// (never the player's - BOT_RADIUS/BOT_HALF_HEIGHT are bot-exclusive, see
// their declaration above), not just the debug wireframes, so body
// sliders actually change real bot hit detection and movement
// collision, not just what you see. Rapier capsule colliders support
// resizing in place via setRadius()/setHalfHeight() rather than needing to
// be destroyed and recreated; setTranslationWrtParent() offsets the
// collider relative to the bot's rigid body without moving the body
// itself (so AI/movement/scoring, which all read bot.body.translation(),
// are unaffected).
function applyDebugBodyChange() {
  for (const bot of bots) {
    bot.collider.setRadius(BOT_RADIUS);
    bot.collider.setHalfHeight(BOT_HALF_HEIGHT);
    bot.collider.setTranslationWrtParent(debugBotBodyOffset);
    updateDebugBodyMesh(bot);
  }
  refreshDebugHitboxOutput();
}

// Builds the panel's sliders once (idempotent - re-toggling "P" just
// shows/hides the already-built panel rather than rebuilding it).
function buildDebugHitboxPanel() {
  if (debugHitboxPanelBuilt) return;
  debugHitboxPanelBuilt = true;

  const SLIDERS = [
    {
      label: "Body radius",
      min: 0.1,
      max: 0.6,
      get: () => BOT_RADIUS,
      set: (v) => (BOT_RADIUS = v),
      apply: applyDebugBodyChange,
    },
    {
      label: "Body half-height",
      min: 0.2,
      max: 1.0,
      get: () => BOT_HALF_HEIGHT,
      set: (v) => (BOT_HALF_HEIGHT = v),
      apply: applyDebugBodyChange,
    },
    {
      label: "Body offset X",
      min: -0.5,
      max: 0.5,
      get: () => debugBotBodyOffset.x,
      set: (v) => (debugBotBodyOffset.x = v),
      apply: applyDebugBodyChange,
    },
    {
      label: "Body offset Y",
      min: -0.5,
      max: 0.5,
      get: () => debugBotBodyOffset.y,
      set: (v) => (debugBotBodyOffset.y = v),
      apply: applyDebugBodyChange,
    },
    {
      label: "Body offset Z",
      min: -0.5,
      max: 0.5,
      get: () => debugBotBodyOffset.z,
      set: (v) => (debugBotBodyOffset.z = v),
      apply: applyDebugBodyChange,
    },
    {
      label: "Head offset X",
      min: -0.5,
      max: 0.5,
      get: () => HEAD_HITBOX_OFFSET.x,
      set: (v) => (HEAD_HITBOX_OFFSET.x = v),
      apply: applyDebugHeadChange,
    },
    {
      label: "Head offset Y",
      min: 0.2,
      max: 1.3,
      get: () => HEAD_HITBOX_OFFSET.y,
      set: (v) => (HEAD_HITBOX_OFFSET.y = v),
      apply: applyDebugHeadChange,
    },
    {
      label: "Head offset Z",
      min: -0.5,
      max: 0.5,
      get: () => HEAD_HITBOX_OFFSET.z,
      set: (v) => (HEAD_HITBOX_OFFSET.z = v),
      apply: applyDebugHeadChange,
    },
    {
      label: "Head radius",
      min: 0.03,
      max: 0.5,
      get: () => HEAD_HITBOX_RADIUS,
      set: (v) => (HEAD_HITBOX_RADIUS = v),
      apply: applyDebugHeadChange,
    },
  ];

  for (const slider of SLIDERS) {
    const block = document.createElement("div");
    block.className = "debug-hitbox-slider-block";

    const label = document.createElement("div");
    label.className = "debug-hitbox-slider-label";
    const valSpan = document.createElement("span");
    valSpan.className = "debug-hitbox-value";
    label.innerHTML = `<span>${slider.label}</span>`;
    label.appendChild(valSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(slider.min);
    input.max = String(slider.max);
    input.step = "0.005";
    input.value = String(slider.get());

    function updateLabel() {
      valSpan.textContent = parseFloat(input.value).toFixed(3);
    }
    updateLabel();

    input.addEventListener("input", () => {
      slider.set(parseFloat(input.value));
      updateLabel();
      slider.apply();
    });

    block.appendChild(label);
    block.appendChild(input);
    debugHitboxSlidersEl.appendChild(block);
  }

  debugHitboxCopyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(debugHitboxOutputEl.textContent);
      debugHitboxCopyButton.textContent = "Copied!";
    } catch {
      // Clipboard API can be blocked (permissions/insecure context); the
      // output block has user-select: all as a manual fallback.
      debugHitboxCopyButton.textContent = "Select text below";
    }
    setTimeout(() => (debugHitboxCopyButton.textContent = "Copy Code"), 1200);
  });

  refreshDebugHitboxOutput();
}

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
  if (event.code === "KeyT" && !isPaused && !isDead && !matchEnded) {
    damagePlayer(20, { label: "Enemy", team: "red" });
  }

  // Manual reload (Milestone 4 extension). Checked once per key-press,
  // same reasoning as "T" above - holding R should only start one reload,
  // not restart it every frame.
  if (event.code === "KeyR" && !isPaused && !isDead && !matchEnded) {
    startReload();
  }

  // Debug test mode (see flags above): freeze bots into stationary target
  // dummies + make the player invulnerable, so impact visuals can be
  // tested up close without dying or the bots wandering off. Same
  // once-per-keypress pattern as KeyT/KeyR above. Gated to dev builds only
  // (import.meta.env.DEV is a Vite build-time constant - true under
  // `npm run dev`, false under `vite build`) so free god-mode + bot-freeze
  // never ships to the public Vercel deploy; the `false` branch is dead
  // code Vite's production minifier strips entirely; it never reaches the
  // deployed bundle, not just hidden behind an unreachable key.
  if (import.meta.env.DEV && event.code === "KeyP" && !isPaused && !isDead && !matchEnded) {
    DEBUG_FREEZE_BOTS = !DEBUG_FREEZE_BOTS;
    DEBUG_GOD_MODE = DEBUG_FREEZE_BOTS;
    console.log(`[debug] test mode ${DEBUG_FREEZE_BOTS ? "ON" : "OFF"} (bots frozen: ${DEBUG_FREEZE_BOTS}, god mode: ${DEBUG_GOD_MODE})`);

    buildDebugHitboxPanel();
    debugHitboxPanel.classList.toggle("hidden", !DEBUG_FREEZE_BOTS);
    for (const bot of bots) {
      if (!bot.debugHitboxMeshes) continue;
      bot.debugHitboxMeshes.body.visible = DEBUG_FREEZE_BOTS;
      bot.debugHitboxMeshes.head.visible = DEBUG_FREEZE_BOTS;
    }
  }
});
window.addEventListener("keyup", (event) => {
  keysPressed[event.code] = false;
});

// Camera look angles, updated by mouse movement below and applied to the
// camera each frame in the render loop.
let yaw = 0;
let pitch = 0;
// Mutable so the Milestone 14 pause-menu slider can change it live.
// Default 0.0022 matches the old hardcoded feel (~40 on the 1–100 slider).
let mouseSensitivity = 0.0022;
const DEFAULT_MOUSE_SENSITIVITY = 0.0022;
const MOUSE_SENSITIVITY_MIN = 0.0005;
const MOUSE_SENSITIVITY_MAX = 0.0055;
// Temporary camera kick from firing (Milestone 11); decays in tick().
let recoilPitch = 0;
let recoilYaw = 0;
// Clamp pitch so you can't look past straight up/down and flip the camera.
const PITCH_LIMIT = Math.PI / 2 - 0.01;

function sensitivityFromSliderValue(sliderValue) {
  const t = Number(sliderValue) / 100;
  return (
    MOUSE_SENSITIVITY_MIN +
    (MOUSE_SENSITIVITY_MAX - MOUSE_SENSITIVITY_MIN) * t
  );
}

function sliderValueFromSensitivity(sensitivity) {
  const t =
    (sensitivity - MOUSE_SENSITIVITY_MIN) /
    (MOUSE_SENSITIVITY_MAX - MOUSE_SENSITIVITY_MIN);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

// -----------------------------------------------------------------------
// Pause state + click-to-play/resume overlay (Milestones 2.5 + 14)
// -----------------------------------------------------------------------
// The game starts paused (isPaused = true). Milestone 15 splash then
// Milestone 9's pre-match menu sit in front first; only after Start Match
// do we reveal #pause-overlay and allow pointer lock. It pauses again any
// time pointer lock is lost — Escape, browser force-release, or focus-loss
// — so there's a single source of truth for "is the game actually playable
// right now". Milestone 14 adds a Resume button + sensitivity slider; the
// pointer-lock / focus pipeline itself is unchanged.

// Dev/testing escape hatch: "?devplay" in the URL runs the simulation
// without pointer lock (bots move/shoot, player stands idle). Lets
// automated checks exercise live-match code; harmless if a player uses it.
const DEV_AUTOPLAY = new URLSearchParams(window.location.search).has("devplay");

let isPaused = true;
// False until startMatch() finishes applying the menu config. Keeps the
// pause overlay / focus handlers from covering the pre-match menu early.
let matchReady = false;
// Tracks whether the player has ever successfully entered play, just so we
// can show a different overlay title ("Click to Play" vs "Paused") without
// needing two separate overlay elements.
let hasPlayedBefore = false;

const pauseOverlay = document.getElementById("pause-overlay");
const pauseOverlayTitle = document.getElementById("pause-overlay-title");
const pauseResumeButton = document.getElementById("pause-resume-button");
const pauseSensitivitySlider = document.getElementById("pause-sensitivity");
const pauseControlsButton = document.getElementById("pause-controls-button");
const pauseControlsPanel = document.getElementById("pause-controls-panel");
const pauseQuitButton = document.getElementById("pause-quit-button");

// Collapsible Controls panel inside the pause menu (feat/fps-overhaul).
pauseControlsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  pauseControlsPanel.classList.toggle("hidden");
});

// Quit Match: tear the live match down and return to Match Setup —
// returnToPrematchMenu is a hoisted function declaration further below.
pauseQuitButton.addEventListener("click", (event) => {
  event.stopPropagation();
  returnToPrematchMenu();
});

// Escape toggles the pause menu. While pointer-locked the browser itself
// releases the lock on Escape (pointerlockchange → showPauseOverlay covers
// the "open" direction, and the browser swallows that keydown); this
// handler covers the "close" direction — Escape on the open menu resumes.
window.addEventListener("keydown", (event) => {
  if (event.code !== "Escape") return;
  if (isPaused && matchReady && !matchEnded && document.hasFocus()) {
    requestResumePointerLock();
  }
});

pauseSensitivitySlider.value = String(
  sliderValueFromSensitivity(DEFAULT_MOUSE_SENSITIVITY)
);
pauseSensitivitySlider.addEventListener("input", () => {
  mouseSensitivity = sensitivityFromSliderValue(pauseSensitivitySlider.value);
});
// Don't let slider interaction bubble into anything that might request lock.
pauseSensitivitySlider.addEventListener("click", (event) => {
  event.stopPropagation();
});
pauseSensitivitySlider.addEventListener("mousedown", (event) => {
  event.stopPropagation();
});

function requestResumePointerLock() {
  ensureAudio();
  clearLockRetry();
  renderer.domElement.requestPointerLock();
}

function showPauseOverlay() {
  // Don't steal the screen while the player is still on Match Setup / splash,
  // or once the match-end summary owns the screen.
  if (!matchReady || matchEnded) return;
  if (DEV_AUTOPLAY) return; // never pause in devplay test mode

  isPaused = true;
  const title = hasPlayedBefore
    ? "Paused \u2014 Click to Resume"
    : "Click to Play";
  pauseOverlayTitle.textContent = title;
  pauseResumeButton.textContent = hasPlayedBefore ? "Resume" : "Click to Play";
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
  isAiming = false;

  // Freeze a pending respawn: cancel the timeout and stash the remaining
  // time so the death countdown stops ticking while the pause menu is up.
  // playerRespawnAt = null also freezes the on-screen countdown text.
  if (isDead && playerRespawnAt !== null) {
    playerRespawnRemainingMs = Math.max(
      0,
      playerRespawnAt - performance.now()
    );
    if (playerRespawnTimeoutId !== null) {
      clearTimeout(playerRespawnTimeoutId);
      playerRespawnTimeoutId = null;
    }
    playerRespawnAt = null;
  }
}

function hidePauseOverlay() {
  isPaused = false;
  // Start the match timer (see the HUD update in tick()) the first time
  // the player actually enters play, not from page load - hasPlayedBefore
  // is exactly "have we already done this once" for that purpose.
  if (!hasPlayedBefore) {
    matchStartTime = performance.now();
  }
  hasPlayedBefore = true;
  pauseOverlay.classList.add("hidden");

  // Resume a respawn that was frozen by showPauseOverlay(): restart the
  // countdown + timeout from the stashed remainder.
  if (isDead && playerRespawnRemainingMs !== null) {
    playerRespawnAt = performance.now() + playerRespawnRemainingMs;
    lastDisplayedRespawnSecond = null;
    if (triggerPlayerRespawn) {
      playerRespawnTimeoutId = setTimeout(
        triggerPlayerRespawn,
        playerRespawnRemainingMs
      );
      trackTimeout(playerRespawnTimeoutId);
    }
    playerRespawnRemainingMs = null;
  }
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

// Resume via the dedicated button (Milestone 14) so the sensitivity slider
// stays usable without accidentally re-locking the pointer.
pauseResumeButton.addEventListener("click", (event) => {
  event.stopPropagation();
  requestResumePointerLock();
});

// This single handler covers every way pointer lock can be gained or lost:
// clicking Resume (locked), pressing Escape (browser releases the lock
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
    if (isPaused && document.hasFocus() && matchReady && !matchEnded) {
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

  // ADS slows the look speed (standard FPS behavior for precise aiming).
  const adsFactor = 1 - 0.45 * weaponViewmodel.getAdsBlend();
  yaw -= event.movementX * mouseSensitivity * adsFactor;
  pitch -= event.movementY * mouseSensitivity * adsFactor;
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));

  // Feed the raw motion into the viewmodel's sway.
  weaponViewmodel.addLookSway(event.movementX, event.movementY);
});

// Right-click is aim-down-sights, so the browser context menu must never
// open over the game canvas.
window.addEventListener("contextmenu", (event) => event.preventDefault());

// -----------------------------------------------------------------------
// Player health + HUD (Milestone 4)
// -----------------------------------------------------------------------
// A simple health bar (HTML/CSS, matching the pause overlay's DOM-based
// approach) plus a death state. Milestone 6 adds the actual respawn (see
// respawnPlayer() inside startRenderLoop(), and handlePlayerDeath() further
// down) - dying still shows this same overlay, it just no longer stays up
// forever.

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
// Edge-detect flags for regen SFX (Milestone 12) — so we don't chirp every frame.
let playerRegenActive = false;
let playerRegenWasFull = true;

const healthBarFill = document.getElementById("health-bar-fill");
const healthTextEl = document.getElementById("health-text");
const deathOverlay = document.getElementById("death-overlay");
const deathOverlaySubtitle = document.getElementById("death-overlay-subtitle");
const vignette = document.getElementById("vignette");
const spawnInvulnOverlay = document.getElementById("spawn-invuln-overlay");
const hitMarkerEl = document.getElementById("hit-marker");
const crosshairEl = document.getElementById("crosshair");
let hitMarkerTimeoutId = null;

// Applies a new health value (clamped to [0, PLAYER_MAX_HEALTH]) and
// updates the HUD bar/color and low-health vignette to match - shared by
// damagePlayer() (health going down) and regenPlayerHealth() (health
// climbing back up) so the HUD always stays in sync either direction.
function setPlayerHealth(newHealth) {
  playerHealth = Math.max(0, Math.min(PLAYER_MAX_HEALTH, newHealth));

  const healthPercent = (playerHealth / PLAYER_MAX_HEALTH) * 100;
  healthBarFill.style.width = `${healthPercent}%`;
  // Continuous green → yellow → red hue sweep (feat/fps-overhaul); the CSS
  // background-color transition smooths each step into a gradual shift.
  const hue = Math.round((healthPercent / 100) * 120); // 120=green, 0=red
  healthBarFill.style.backgroundColor = `hsl(${hue}, 72%, 46%)`;
  healthTextEl.textContent =
    `HP: ${Math.round(playerHealth)} / ${PLAYER_MAX_HEALTH}`;

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

function damagePlayer(amount, killerInfo = null) {
  if (isDead || matchEnded) return;
  // Debug test mode ("P") - shots still visually land, they just never
  // hurt the player, same as the spawn-invulnerability no-op below.
  if (DEBUG_GOD_MODE) return;
  // No-op during the post-respawn invulnerability window (see
  // SPAWN_INVULNERABILITY_MS) - shots still visually land, they just
  // don't do anything yet.
  if (performance.now() < playerInvulnerableUntil) return;

  playerLastDamageTime = performance.now();
  playerRegenActive = false;
  playerRegenWasFull = false;
  playHitTakenSound();
  // Only real attacks (see botFireShot()) carry a position — the debug
  // KeyT test hit doesn't, and there's nothing to point an arc at then.
  if (killerInfo?.position) spawnDamageIndicator(killerInfo.position);
  setPlayerHealth(playerHealth - amount);
  if (playerHealth === 0) handlePlayerDeath(killerInfo);
}

// Gradually restores the player's health once HEALTH_REGEN_DELAY_MS has
// passed since the last hit, up to full - called every frame from tick()
// (the same isPaused/isDead-guarded block the rest of the simulation runs
// in), so it naturally stops the instant the player dies.
function regenPlayerHealth(now, deltaTime) {
  if (isDead) return;
  if (playerHealth >= PLAYER_MAX_HEALTH) {
    if (playerRegenActive && !playerRegenWasFull) {
      playRegenCompleteSound();
    }
    playerRegenActive = false;
    playerRegenWasFull = true;
    return;
  }
  if (now - playerLastDamageTime < HEALTH_REGEN_DELAY_MS) {
    playerRegenActive = false;
    return;
  }
  if (!playerRegenActive) {
    playerRegenActive = true;
    playRegenStartSound();
  }
  setPlayerHealth(playerHealth + HEALTH_REGEN_RATE_PER_SECOND * deltaTime);
  if (playerHealth >= PLAYER_MAX_HEALTH && !playerRegenWasFull) {
    playRegenCompleteSound();
    playerRegenActive = false;
    playerRegenWasFull = true;
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
// True while right mouse is held (aim-down-sights, modern-overhaul).
// isAiming is the GAME's ADS state (blocked while reloading, cancelled the
// instant a reload starts) - isRightMouseDown below tracks the PHYSICAL
// button independent of that, so a reload finishing while the player never
// let go can resume isAiming automatically instead of requiring a fresh
// click.
let isAiming = false;
let isRightMouseDown = false;

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
  // Cancel ADS instantly if a reload starts while aiming - the mirror-image
  // case (can't START aiming while already reloading) is guarded at the
  // right-mouse mousedown listener above. adsBlend still eases back to the
  // hip pose smoothly on its own lerp in playerArms.js's update() - only
  // the isAiming STATE flips immediately, not a hard position snap.
  isAiming = false;
  updateAmmoDisplay();
  playReloadSound();
  weaponViewmodel.reload(); // covers both the manual R key and auto-reload-on-empty

  // Read the Reload clip's own duration instead of a hand-tuned constant,
  // so isReloading can't outlast (or fall short of) the actual 3D
  // animation - RELOAD_TIME_MS is only a fallback if the clip never loaded.
  const reloadDurationMs = weaponViewmodel.getReloadDurationMs() ?? RELOAD_TIME_MS;
  const reloadTimeoutId = setTimeout(() => {
    currentAmmo = MAGAZINE_SIZE;
    isReloading = false;
    updateAmmoDisplay();

    // Auto-resume ADS: if the player never physically let go of right-mouse
    // during the reload, re-enter ADS the instant it's allowed again
    // instead of leaving them stuck at hip-fire until they release and
    // re-click. Same pointer-lock guard as the manual mousedown handler,
    // so this can't re-aim while the game is paused/unfocused.
    if (isRightMouseDown && document.pointerLockElement === renderer.domElement) {
      isAiming = true;
    }
  }, reloadDurationMs);
  trackTimeout(reloadTimeoutId);
}

// -----------------------------------------------------------------------
// Shooting visual feedback (Milestones 4 + 11; ballistics polish below)
// -----------------------------------------------------------------------
// Milestone 11 adds muzzle flash + hit markers; recoil is applied as
// camera offsets in tick().

// Shared texture/material across every bot's flash — only each shot's
// Sprite instance (position/scale) is per-call, same pattern the sphere
// version used for the mesh itself.
const botMuzzleFlashTexture = new THREE.TextureLoader().load(
  BOT_MUZZLE_FLASH_TEXTURE_URL
);
const botMuzzleFlashMaterial = new THREE.SpriteMaterial({
  map: botMuzzleFlashTexture,
  blending: THREE.AdditiveBlending,
  transparent: true,
  depthWrite: false,
});

function spawnMuzzleFlash(point) {
  const flashSprite = new THREE.Sprite(botMuzzleFlashMaterial);
  flashSprite.position.set(point.x, point.y, point.z);
  flashSprite.scale.set(BOT_MUZZLE_FLASH_SCALE, BOT_MUZZLE_FLASH_SCALE, 1);
  scene.add(flashSprite);

  setTimeout(() => {
    scene.remove(flashSprite);
  }, MUZZLE_FLASH_LIFETIME_MS);
}

function applyRecoilKick() {
  // Permanent: nudges the real aim, clamped exactly like manual mouse-look
  // (see the mousemove handler above) - only clears when the player moves
  // the mouse back down themselves.
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + RECOIL_PITCH_KICK));
  yaw += (Math.random() - 0.5) * 2 * RECOIL_YAW_KICK_MAX;

  // Temporary: a sharper pop on top, decayed independently every frame in
  // tick() - purely a per-shot visual snap, not part of the aim consequence.
  recoilPitch += RECOIL_SNAP_PITCH_KICK;
  recoilYaw += (Math.random() - 0.5) * 2 * RECOIL_SNAP_YAW_KICK_MAX;
}

// -----------------------------------------------------------------------
// Bullet tracers (feat-ballistics-polish)
// -----------------------------------------------------------------------
// A tracer is a short, fixed-length "comet" (two crossed additive-blended
// quads, since a single billboard would vanish edge-on) that travels from
// the muzzle to the impact/miss point over time instead of instantly
// drawing a line - gunplay itself stays hitscan (damage is still applied
// the instant the trigger is pulled, see fireShot()/botFireShot() below);
// only the tracer's visual arrival is delayed. Geometry/material are
// shared singletons since every tracer looks identical and only its
// transform differs - avoids per-shot allocation churn during full-auto.

const TRACER_LENGTH = 2.2; // meters - fixed length of the traveling streak
const TRACER_SPEED = 300; // meters/second
const TRACER_WIDTH = 0.05; // meters

let tracerTexture = null;
function getTracerTexture() {
  if (tracerTexture) return tracerTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  // U=0 (local -X, trailing edge) -> transparent orange smoke.
  // U=1 (local +X, leading edge, points along the travel direction) ->
  // hot white, per the "bright head fading to smoke tail" look requested.
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "rgba(255, 130, 40, 0)");
  gradient.addColorStop(0.55, "rgba(255, 170, 90, 0.5)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 1)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  tracerTexture = new THREE.CanvasTexture(canvas);
  tracerTexture.colorSpace = THREE.SRGBColorSpace;
  return tracerTexture;
}

let tracerMaterial = null;
function getTracerMaterial() {
  if (tracerMaterial) return tracerMaterial;
  tracerMaterial = new THREE.MeshBasicMaterial({
    map: getTracerTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return tracerMaterial;
}

let tracerGeometry = null;
function getTracerGeometry() {
  // Unit-length quad, long axis along local X, so a mesh using this
  // geometry can be aligned to the travel direction and scaled in X for
  // length each frame without ever touching the geometry itself.
  if (!tracerGeometry) tracerGeometry = new THREE.PlaneGeometry(1, TRACER_WIDTH);
  return tracerGeometry;
}

// In-flight tracers, updated once per frame in tick() via updateTracers().
const activeTracers = [];

// onImpact (optional) fires once the tracer visually reaches `end`, so
// impact decals/particles can be timed to the bullet's arrival instead of
// popping in before the visible tracer gets there.
function spawnTracer(start, end, onImpact) {
  const startVec = new THREE.Vector3(start.x, start.y, start.z);
  const endVec = new THREE.Vector3(end.x, end.y, end.z);
  const toEnd = new THREE.Vector3().subVectors(endVec, startVec);
  const totalDistance = toEnd.length();
  if (totalDistance < 1e-4) return;
  const dir = toEnd.divideScalar(totalDistance);

  const geometry = getTracerGeometry();
  const material = getTracerMaterial();
  const group = new THREE.Group();
  const quad1 = new THREE.Mesh(geometry, material);
  const quad2 = new THREE.Mesh(geometry, material);
  // Rotating around local X (the shared "length" axis) leaves that axis
  // fixed, so both quads keep the same length/orientation along dir while
  // crossing at 90 deg - readable from any viewing angle without a true
  // camera-facing billboard shader.
  quad2.rotation.x = Math.PI / 2;
  group.add(quad1, quad2);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  scene.add(group);

  activeTracers.push({
    group,
    start: startVec,
    dir,
    totalDistance,
    traveled: 0,
    onImpact: onImpact || null,
  });
}

function updateTracers(deltaTime) {
  for (let i = activeTracers.length - 1; i >= 0; i--) {
    const tracer = activeTracers[i];
    tracer.traveled += TRACER_SPEED * deltaTime;
    const reachedEnd = tracer.traveled >= tracer.totalDistance;
    const headDistance = Math.min(tracer.traveled, tracer.totalDistance);
    // Tail stays pinned to the muzzle while the streak is still shorter
    // than TRACER_LENGTH (so it visibly emerges rather than popping in at
    // full length), then trails at a constant length once it's caught up.
    const tailDistance = Math.max(0, headDistance - TRACER_LENGTH);
    const length = headDistance - tailDistance;

    const midDistance = (headDistance + tailDistance) / 2;
    tracer.group.position
      .copy(tracer.start)
      .addScaledVector(tracer.dir, midDistance);
    tracer.group.scale.set(length, 1, 1);

    if (reachedEnd) {
      scene.remove(tracer.group);
      activeTracers.splice(i, 1);
      if (tracer.onImpact) tracer.onImpact();
    }
  }
}

// -----------------------------------------------------------------------
// Impact decals - bullet holes (feat-ballistics-polish)
// -----------------------------------------------------------------------
// A small dark plane oriented to the impact normal and nudged off the
// surface along it to avoid z-fighting. Only spawned for environment hits
// (see fireShot()/botFireShot()) - a decal stuck to a bot doesn't track
// its animation and looks broken once the bot dies/respawns, and body
// hits already get a hit marker + damage number, so no decal is needed
// there. Geometry/material are shared singletons like the tracer's; decals
// don't fade, they just get removed outright after their lifetime, so a
// shared material is safe (no per-instance state to fight over).

const IMPACT_DECAL_LIFETIME_MS = 8000;
const IMPACT_DECAL_SIZE = 0.06;
const IMPACT_DECAL_NORMAL_OFFSET = 0.015;
// Defensive cap, same pattern as MAX_CONCURRENT_DAMAGE_INDICATORS - each
// decal already self-removes after its lifetime, this just bounds the
// worst case during a long, decal-heavy match.
const MAX_CONCURRENT_DECALS = 40;
const liveDecals = [];

let decalTexture = null;
function getDecalTexture() {
  if (decalTexture) return decalTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(12, 11, 10, 0.95)");
  gradient.addColorStop(0.6, "rgba(18, 16, 15, 0.7)");
  gradient.addColorStop(1, "rgba(18, 16, 15, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  decalTexture = new THREE.CanvasTexture(canvas);
  decalTexture.colorSpace = THREE.SRGBColorSpace;
  return decalTexture;
}

let decalGeometry = null;
function getDecalGeometry() {
  if (!decalGeometry) {
    decalGeometry = new THREE.PlaneGeometry(IMPACT_DECAL_SIZE, IMPACT_DECAL_SIZE);
  }
  return decalGeometry;
}

let decalMaterial = null;
function getDecalMaterial() {
  if (!decalMaterial) {
    decalMaterial = new THREE.MeshBasicMaterial({
      map: getDecalTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }
  return decalMaterial;
}

function spawnImpactDecal(point, normal) {
  const normalVec = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
  const mesh = new THREE.Mesh(getDecalGeometry(), getDecalMaterial());
  mesh.position
    .set(point.x, point.y, point.z)
    .addScaledVector(normalVec, IMPACT_DECAL_NORMAL_OFFSET);
  // Plane's default face normal is local +Z - align that to the impact
  // normal, then spin randomly around it (that axis is now local Z, so
  // rotateZ spins in-place around the normal) so decals aren't all
  // identically oriented.
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normalVec);
  mesh.rotateZ(Math.random() * Math.PI * 2);
  scene.add(mesh);

  liveDecals.push(mesh);
  if (liveDecals.length > MAX_CONCURRENT_DECALS) {
    scene.remove(liveDecals.shift());
  }

  trackTimeout(
    setTimeout(() => {
      scene.remove(mesh);
      const index = liveDecals.indexOf(mesh);
      if (index !== -1) liveDecals.splice(index, 1);
    }, IMPACT_DECAL_LIFETIME_MS)
  );
}

// -----------------------------------------------------------------------
// Impact particle bursts - wall dust/sparks + blood splatter
// (feat-ballistics-polish)
// -----------------------------------------------------------------------
// Two distinct burst types share the same InstancedMesh-per-burst
// infrastructure (positions/velocities integrated with gravity, faded via
// scale + opacity, one dedicated material per burst since opacity is
// per-burst state): spawnWallSparkParticles() for concrete/environment
// hits, spawnBloodSplatterParticles() for body hits. They differ in more
// than color - wall dust sprays outward around the surface normal with
// light gravity, blood is a heavier liquid biased along the bullet's
// travel direction (exit-wound spatter) that arcs hard toward the floor.

const IMPACT_PARTICLE_LIFETIME_MIN_S = 0.2;
const IMPACT_PARTICLE_LIFETIME_MAX_S = 0.4;

const WALL_SPARK_MIN_COUNT = 5;
const WALL_SPARK_MAX_COUNT = 10;
const WALL_SPARK_SPEED_MIN = 1.5;
const WALL_SPARK_SPEED_MAX = 4;
const WALL_SPARK_GRAVITY = 6;
const WALL_SPARK_SIZE = 0.02;
// Wide, shallow cone around the surface normal - "flying off the wall".
const WALL_SPARK_DIRECTION_BIAS_MIN = 0.35;
const WALL_SPARK_DIRECTION_BIAS_MAX = 1.0;

// Punchier than wall dust (more particles, thrown faster) for a more
// "impactful" feel on a confirmed hit, heavy liquid-like gravity so it
// arcs down instead of hanging in the air, and slightly larger than the
// dust motes so it reads at a glance.
const BLOOD_SPLATTER_MIN_COUNT = 8;
const BLOOD_SPLATTER_MAX_COUNT = 15;
const BLOOD_SPLATTER_SPEED_MIN = 2;
const BLOOD_SPLATTER_SPEED_MAX = 5;
const BLOOD_SPLATTER_GRAVITY = 18;
// 2x the original 0.032 - small droplets read as gray specks at any
// distance, this is chunky enough to register as liquid.
const BLOOD_SPLATTER_SIZE = 0.064;
// Tighter cone around the bullet's travel direction than the wall spark's
// cone around the surface normal - an exit wound sprays mostly forward,
// not in a full hemisphere.
const BLOOD_SPLATTER_DIRECTION_BIAS_MIN = 0.55;
const BLOOD_SPLATTER_DIRECTION_BIAS_MAX = 1.0;
// Bright, saturated red rather than a "realistic" dark crimson - with
// NormalBlending and no per-particle light of their own, a dark base color
// gets crushed toward the ambient/shadow color and reads as gray dust at a
// glance. The emissive term below keeps it visible even fully in shadow,
// without going full Additive-glow.
const BLOOD_SPLATTER_BASE_COLOR = 0xc20202;
const BLOOD_SPLATTER_EMISSIVE_COLOR = 0x4a0000;
const BLOOD_SPLATTER_EMISSIVE_INTENSITY = 0.5;

let wallSparkGeometry = null;
function getWallSparkGeometry() {
  if (!wallSparkGeometry) {
    wallSparkGeometry = new THREE.IcosahedronGeometry(WALL_SPARK_SIZE, 0);
  }
  return wallSparkGeometry;
}

let bloodSplatterGeometry = null;
function getBloodSplatterGeometry() {
  if (!bloodSplatterGeometry) {
    bloodSplatterGeometry = new THREE.IcosahedronGeometry(BLOOD_SPLATTER_SIZE, 0);
  }
  return bloodSplatterGeometry;
}

// A random direction biased around `axis` - `biasMin`/`biasMax` control
// how tightly the cone hugs the axis (closer to 1 = tighter/more forward,
// closer to 0 = wider/closer to a full hemisphere). Shared by both burst
// types since the sampling math is identical; only the axis and bias
// range differ (surface normal + wide cone for wall dust, travel
// direction + narrow cone for blood).
function randomBiasedDirection(axis, biasMin, biasMax) {
  const theta = Math.random() * Math.PI * 2;
  const z = biasMin + Math.random() * (biasMax - biasMin);
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const helper =
    Math.abs(axis.y) < 0.99
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(helper, axis).normalize();
  const bitangent = new THREE.Vector3().crossVectors(axis, tangent);
  return new THREE.Vector3()
    .addScaledVector(tangent, r * Math.cos(theta))
    .addScaledVector(bitangent, r * Math.sin(theta))
    .addScaledVector(axis, z);
}

// In-flight particle bursts, updated once per frame in tick() via
// updateImpactParticles(). Both spawn functions below push burst objects
// of the same shape (mesh/count/positions/velocities/age/lifetime/gravity)
// so one update loop can drive both.
const activeParticleBursts = [];

function spawnWallSparkParticles(point, normal) {
  const normalVec = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
  const count =
    WALL_SPARK_MIN_COUNT +
    Math.floor(Math.random() * (WALL_SPARK_MAX_COUNT - WALL_SPARK_MIN_COUNT + 1));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
  });
  const mesh = new THREE.InstancedMesh(getWallSparkGeometry(), material, count);

  const positions = [];
  const velocities = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const dir = randomBiasedDirection(
      normalVec,
      WALL_SPARK_DIRECTION_BIAS_MIN,
      WALL_SPARK_DIRECTION_BIAS_MAX
    );
    const speed =
      WALL_SPARK_SPEED_MIN +
      Math.random() * (WALL_SPARK_SPEED_MAX - WALL_SPARK_SPEED_MIN);
    positions.push(new THREE.Vector3(point.x, point.y, point.z));
    velocities.push(dir.multiplyScalar(speed));

    dummy.position.set(point.x, point.y, point.z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    // Mostly concrete-dust gray, with an occasional warm spark for variety.
    const isSpark = Math.random() < 0.35;
    mesh.setColorAt(
      i,
      isSpark
        ? new THREE.Color(0xffaa55).multiplyScalar(0.8 + Math.random() * 0.4)
        : new THREE.Color(0x8a8681).multiplyScalar(0.7 + Math.random() * 0.5)
    );
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  activeParticleBursts.push({
    mesh,
    count,
    positions,
    velocities,
    gravity: WALL_SPARK_GRAVITY,
    age: 0,
    lifetime:
      IMPACT_PARTICLE_LIFETIME_MIN_S +
      Math.random() *
        (IMPACT_PARTICLE_LIFETIME_MAX_S - IMPACT_PARTICLE_LIFETIME_MIN_S),
  });
}

// `travelDirection` is the bullet's raycast direction (unit vector) at the
// moment it hit - used instead of the hit normal so the spray continues
// roughly the bullet's path (an exit wound), not a burst off the surface.
function spawnBloodSplatterParticles(point, travelDirection) {
  const dirVec = new THREE.Vector3(
    travelDirection.x,
    travelDirection.y,
    travelDirection.z
  ).normalize();
  const count =
    BLOOD_SPLATTER_MIN_COUNT +
    Math.floor(
      Math.random() * (BLOOD_SPLATTER_MAX_COUNT - BLOOD_SPLATTER_MIN_COUNT + 1)
    );
  // MeshStandardMaterial (not MeshBasicMaterial) specifically so `emissive`
  // is available: an unlit/emissive-less material's only source of red is
  // its base color reacting to scene light, which reads as gray dust the
  // instant it's in shadow. The emissive term is added on top regardless
  // of incoming light, so the blood stays visibly red in the dark without
  // needing AdditiveBlending (kept NormalBlending, explicitly, so
  // overlapping particles darken/occlude like a liquid rather than
  // stacking into a bright glow).
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.NormalBlending,
    emissive: new THREE.Color(BLOOD_SPLATTER_EMISSIVE_COLOR),
    emissiveIntensity: BLOOD_SPLATTER_EMISSIVE_INTENSITY,
  });
  const mesh = new THREE.InstancedMesh(getBloodSplatterGeometry(), material, count);

  const positions = [];
  const velocities = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const dir = randomBiasedDirection(
      dirVec,
      BLOOD_SPLATTER_DIRECTION_BIAS_MIN,
      BLOOD_SPLATTER_DIRECTION_BIAS_MAX
    );
    const speed =
      BLOOD_SPLATTER_SPEED_MIN +
      Math.random() * (BLOOD_SPLATTER_SPEED_MAX - BLOOD_SPLATTER_SPEED_MIN);
    positions.push(new THREE.Vector3(point.x, point.y, point.z));
    velocities.push(dir.multiplyScalar(speed));

    dummy.position.set(point.x, point.y, point.z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    // Bright saturated red base, small per-particle variance so the burst
    // doesn't read as one flat color.
    mesh.setColorAt(
      i,
      new THREE.Color(BLOOD_SPLATTER_BASE_COLOR).multiplyScalar(
        0.8 + Math.random() * 0.3
      )
    );
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  activeParticleBursts.push({
    mesh,
    count,
    positions,
    velocities,
    gravity: BLOOD_SPLATTER_GRAVITY,
    age: 0,
    lifetime:
      IMPACT_PARTICLE_LIFETIME_MIN_S +
      Math.random() *
        (IMPACT_PARTICLE_LIFETIME_MAX_S - IMPACT_PARTICLE_LIFETIME_MIN_S),
  });
}

function updateImpactParticles(deltaTime) {
  const dummy = new THREE.Object3D();
  for (let i = activeParticleBursts.length - 1; i >= 0; i--) {
    const burst = activeParticleBursts[i];
    burst.age += deltaTime;
    const t = burst.age / burst.lifetime;
    if (t >= 1) {
      scene.remove(burst.mesh);
      burst.mesh.material.dispose();
      activeParticleBursts.splice(i, 1);
      continue;
    }

    const fade = 1 - t;
    burst.mesh.material.opacity = fade;
    for (let p = 0; p < burst.count; p++) {
      burst.velocities[p].y -= burst.gravity * deltaTime;
      burst.positions[p].addScaledVector(burst.velocities[p], deltaTime);
      dummy.position.copy(burst.positions[p]);
      dummy.scale.setScalar(fade);
      dummy.updateMatrix();
      burst.mesh.setMatrixAt(p, dummy.matrix);
    }
    burst.mesh.instanceMatrix.needsUpdate = true;
  }
}

// -----------------------------------------------------------------------
// Floating combat damage numbers (feat/fps-overhaul)
// -----------------------------------------------------------------------
// One DOM popup per hit at the impact point's screen projection: burst
// scale on spawn, upward drift, fade — all in the CSS animation — then
// self-destroys. Position is projected once at spawn (the ~0.8s lifetime
// is too short for parallax to read as wrong).

const damageNumbersEl = document.getElementById("damage-numbers");
const DAMAGE_NUMBER_LIFETIME_MS = 850;

function spawnDamageNumber(worldPoint, amount, isHeadshot = false) {
  const projected = new THREE.Vector3(
    worldPoint.x,
    worldPoint.y,
    worldPoint.z
  ).project(camera);
  if (projected.z > 1) return; // behind the camera

  const el = document.createElement("span");
  el.className = isHeadshot ? "damage-number headshot" : "damage-number";
  el.textContent = String(Math.round(amount));
  // Slight random jitter so rapid full-auto hits don't stack into one blob.
  const jitterX = (Math.random() - 0.5) * 28;
  el.style.left = `${((projected.x + 1) / 2) * window.innerWidth + jitterX}px`;
  el.style.top = `${((1 - projected.y) / 2) * window.innerHeight}px`;
  damageNumbersEl.appendChild(el);
  trackTimeout(setTimeout(() => el.remove(), DAMAGE_NUMBER_LIFETIME_MS));
}

// -----------------------------------------------------------------------
// Directional damage indicator (feat/damage-indicator)
// -----------------------------------------------------------------------
// Each hit taken (with a known attacker position) spawns a short-lived arc
// pointing toward the attacker, independent of any others already fading -
// same "create, append, self-destroy via a tracked timeout" pattern as
// spawnDamageNumber() above, so several hits from different directions in
// quick succession all show at once instead of collapsing into one.

const damageIndicatorsEl = document.getElementById("damage-indicators");
const DAMAGE_INDICATOR_LIFETIME_MS = 1500;
// Defensive cap so a hail of fire can't pile up an unbounded number of
// live elements — each already self-removes after DAMAGE_INDICATOR_LIFETIME_MS,
// so this is just a worst-case bound, not the normal path.
const MAX_CONCURRENT_DAMAGE_INDICATORS = 5;
const liveDamageIndicators = [];

// Same rest-arc SVG every time (a 48°-ish arc centered on top/"ahead") -
// only the wrapper's rotation, set below, differs per attacker bearing.
// Two stacked circles sharing the exact same geometry (cx/cy/r/dasharray/
// rotate): a wide, blurred "glow" underneath and a thin, jagged "core" on
// top (the jaggedness comes from the shared #damage-indicator-jagged
// filter in index.html - a feTurbulence/feDisplacementMap distortion, all
// purely visual, no change to the arc's actual position/span/rotation).
const DAMAGE_INDICATOR_SVG = `
  <svg viewBox="0 0 200 200">
    <circle class="damage-indicator-glow" cx="100" cy="100" r="85" stroke-dasharray="71 463" transform="rotate(-114 100 100)" />
    <circle class="damage-indicator-core" cx="100" cy="100" r="85" stroke-dasharray="71 463" transform="rotate(-114 100 100)" />
  </svg>
`;

// Signed angle (degrees) from the player's current look direction to
// attackerPosition, flattened to the XZ plane. Mirrors computeYawTowards()/
// the atan2(sin,cos) wrap idiom in rotateGroupTowards() (both closure-
// scoped inside startRenderLoop, so re-derived here at module scope where
// damagePlayer() and camera/yaw already live) - then negated, since that
// convention's positive angle means "attacker to the world-yaw left",
// while a CSS rotate(+deg) here needs to sweep clockwise (screen-right)
// for an attacker on the player's right.
function computeAttackerBearingDegrees(attackerPosition) {
  const dx = attackerPosition.x - camera.position.x;
  const dz = attackerPosition.z - camera.position.z;
  const attackerYaw = Math.atan2(-dx, -dz);
  const relative = Math.atan2(
    Math.sin(attackerYaw - yaw),
    Math.cos(attackerYaw - yaw)
  );
  return -relative * (180 / Math.PI);
}

function spawnDamageIndicator(attackerPosition) {
  while (liveDamageIndicators.length >= MAX_CONCURRENT_DAMAGE_INDICATORS) {
    liveDamageIndicators.shift().remove();
  }

  const bearingDegrees = computeAttackerBearingDegrees(attackerPosition);
  const el = document.createElement("div");
  el.className = "damage-indicator";
  el.style.transform = `translate(-50%, -50%) rotate(${bearingDegrees}deg)`;
  el.innerHTML = DAMAGE_INDICATOR_SVG;
  damageIndicatorsEl.appendChild(el);
  liveDamageIndicators.push(el);

  trackTimeout(
    setTimeout(() => {
      el.remove();
      const index = liveDamageIndicators.indexOf(el);
      if (index !== -1) liveDamageIndicators.splice(index, 1);
    }, DAMAGE_INDICATOR_LIFETIME_MS)
  );
}

// -----------------------------------------------------------------------
// Multi-kill combo chain (feat/fps-overhaul)
// -----------------------------------------------------------------------
// Standard FPS combo-chain: each kill bumps multiKillCount and resets
// multiKillTimer to MULTI_KILL_WINDOW_SECONDS. The timer ticks down every
// frame in tick(); once it runs out the chain is broken and the count
// resets to 0. This means the chain only grows on *consecutive* kills
// within the window, so a banner (e.g. TRIPLE KILL!) fires once per
// genuine streak instead of repeatedly as old kills age out of a rolling
// window.
// 3 = TRIPLE KILL!, 4 = QUAD KILL!, 5+ = KILL FRENZY!

const killstreakBannerEl = document.getElementById("killstreak-banner");
const MULTI_KILL_WINDOW_SECONDS = 3.0;
const KILLSTREAK_BANNER_MS = 1800; // matches the CSS animation length
let multiKillCount = 0;
let multiKillTimer = 0;
let killstreakHideTimeoutId = null;

function showKillstreakBanner(text) {
  killstreakBannerEl.textContent = text;
  killstreakBannerEl.classList.remove("hidden");
  // Restart the pop animation even if the banner is already showing.
  killstreakBannerEl.classList.remove("active");
  void killstreakBannerEl.offsetWidth;
  killstreakBannerEl.classList.add("active");

  if (killstreakHideTimeoutId !== null) clearTimeout(killstreakHideTimeoutId);
  killstreakHideTimeoutId = setTimeout(() => {
    killstreakBannerEl.classList.add("hidden");
    killstreakBannerEl.classList.remove("active");
    killstreakHideTimeoutId = null;
  }, KILLSTREAK_BANNER_MS);
  trackTimeout(killstreakHideTimeoutId);
}

// Scoring bonus for the Nth kill in a live streak chain (feat-scoring-
// system): 0/+50/+100/+150 through Quad Kill, then a flat +200 from
// Frenzy (kill 5) onward - deliberately uncapped-but-flat past 5 so there's
// still a reason to extend the chain, without the runaway growth an
// ever-increasing bonus would produce on a long spree.
const STREAK_BONUS_BY_KILL_COUNT = { 1: 0, 2: 50, 3: 100, 4: 150 };
const STREAK_BONUS_FRENZY = 200;

function streakBonusForKillCount(count) {
  return STREAK_BONUS_BY_KILL_COUNT[count] ?? STREAK_BONUS_FRENZY;
}

function registerPlayerKillForStreak() {
  multiKillCount += 1;
  multiKillTimer = MULTI_KILL_WINDOW_SECONDS;
  playerStreakBonusTotal += streakBonusForKillCount(multiKillCount);
  playerBestStreakThisMatch = Math.max(playerBestStreakThisMatch, multiKillCount);
  if (multiKillCount === 3) showKillstreakBanner("TRIPLE KILL!");
  else if (multiKillCount === 4) showKillstreakBanner("QUAD KILL!");
  else if (multiKillCount >= 5) showKillstreakBanner("KILL FRENZY!");
}

// Called once per frame from tick() while the match is live. Counts down
// multiKillTimer and breaks the combo chain once it expires.
function updateMultiKillTimer(deltaTime) {
  if (multiKillTimer <= 0) return;
  multiKillTimer -= deltaTime;
  if (multiKillTimer <= 0) {
    multiKillTimer = 0;
    multiKillCount = 0;
  }
}

function resetKillstreak() {
  multiKillCount = 0;
  multiKillTimer = 0;
  killstreakBannerEl.classList.add("hidden");
  killstreakBannerEl.classList.remove("active");
}

function showHitMarker(isHeadshot = false) {
  hitMarkerEl.classList.add("active");
  hitMarkerEl.classList.toggle("headshot", isHeadshot);
  if (hitMarkerTimeoutId !== null) clearTimeout(hitMarkerTimeoutId);
  hitMarkerTimeoutId = setTimeout(() => {
    hitMarkerEl.classList.remove("active");
    hitMarkerEl.classList.remove("headshot");
    hitMarkerTimeoutId = null;
  }, HIT_MARKER_LIFETIME_MS);
}

// Applies a new health value (clamped to [0, BOT_MAX_HEALTH]) and updates
// that bot's floating health bar - shared by damageBot() and regen.
function setBotHealth(bot, newHealth) {
  bot.health = Math.max(0, Math.min(BOT_MAX_HEALTH, newHealth));
  updateFloatingHealthBarFill(
    bot.healthBar,
    (bot.health / BOT_MAX_HEALTH) * 100
  );
}

// Damages one bot instance. amount defaults to the player's gun damage so
// player hitscan can call damageBot(bot); bot-vs-bot passes BOT_DAMAGE_PER_HIT.
// killerInfo ({ label, team }) feeds the kill feed when this hit is lethal.
// onApplied(), if given, fires the instant damage is confirmed applied -
// BEFORE the kill/match-end cascade below can run. This matters because a
// kill here can synchronously call endMatch(), which snapshots the score
// report immediately (feat-scoring-system) - any stat the caller wants
// reflected in that report (e.g. playerDamageDealt/playerHeadshots in
// fireShot()) has to be recorded here, not after this function returns.
// Returns true if damage was actually applied (for hit markers).
function damageBot(bot, amount = GUN_DAMAGE, killerInfo = null, onApplied = null) {
  if (!bot || bot.destroyed || matchEnded) return false;
  // No-op during post-respawn invulnerability — tracers still land.
  if (performance.now() < bot.invulnerableUntil) return false;

  bot.lastDamageTime = performance.now();
  setBotHealth(bot, bot.health - amount);
  onApplied?.();
  // Hit flash: pulse every material's emissive white briefly. Always reset
  // (even on a killing blow) so a GLB corpse doesn't stay glowing.
  for (const m of bot.materials) m.emissive?.setHex(0x888888);
  trackTimeout(
    setTimeout(() => {
      for (const m of bot.materials) m.emissive?.setHex(0x000000);
    }, 80)
  );

  if (bot.health <= 0) {
    bot.destroyed = true; // halts updateBot() immediately
    bot.healthBar.container.style.display = "none";
    bot.minimapDot.style.display = "none";
    bot.collider.setEnabled(false);
    if (bot.model.isGlb) {
      // Death clip plays exactly once (LoopOnce + clampWhenFinished in
      // botmodel.js); the corpse stays visible until respawn resets it.
      bot.model.playDeath();
    } else {
      bot.group.visible = false;
    }
    handleBotDeath(bot, killerInfo);
  }
  return true;
}

// Gradually restores every living bot's health after HEALTH_REGEN_DELAY_MS.
function regenAllBotsHealth(now, deltaTime) {
  for (const bot of bots) {
    if (bot.destroyed) continue;
    if (bot.health >= BOT_MAX_HEALTH) continue;
    if (now - bot.lastDamageTime < HEALTH_REGEN_DELAY_MS) continue;
    setBotHealth(bot, bot.health + HEALTH_REGEN_RATE_PER_SECOND * deltaTime);
  }
}

// -----------------------------------------------------------------------
// Match state: team score, win condition, respawn (Milestone 6)
// -----------------------------------------------------------------------
// Kills are tracked per TEAM (not per-character) since that's the shape
// Milestone 10's multiple-bots-per-team setup will need anyway - a kill
// just increments the killer's team score. First team to killTarget wins.
// BLUE = the player's team, RED = the enemy team, per the Visual Style
// team-color rule in AGENTS.md.
//
// killTarget is chosen on the Milestone 9 pre-match menu (5 / 10 / 15).

let killTarget = 5;
const RESPAWN_DELAY_MS = 3000; // 3s "you're dead" pause before respawning

// performance.now() deadline for the player's pending respawn, or null
// when not waiting. Drives the live "Respawning in N..." countdown on
// #death-overlay-subtitle (updated from tick() while dead).
let playerRespawnAt = null;
// Last whole-second value written to the subtitle, so we don't rewrite
// the DOM every frame — only when the displayed number changes.
let lastDisplayedRespawnSecond = null;
// Pending respawn timeout + its frozen remainder while paused (bugfix:
// pausing during the death screen must stop the respawn clock, not let it
// keep ticking behind the pause menu). See showPauseOverlay()/
// hidePauseOverlay() for the freeze/resume handoff.
let playerRespawnTimeoutId = null;
let playerRespawnRemainingMs = null;

function formatRespawnCountdown(remainingSeconds) {
  if (remainingSeconds <= 0) return "Respawning...";
  if (remainingSeconds === 1) return "Respawning in 1 second...";
  return `Respawning in ${remainingSeconds} seconds...`;
}

// Updates the death-overlay subtitle to match time left until
// playerRespawnAt. Safe to call every frame; no-ops when not waiting.
function updateDeathOverlayCountdown(now) {
  if (playerRespawnAt === null) return;

  const remainingSeconds = Math.max(
    0,
    Math.ceil((playerRespawnAt - now) / 1000)
  );
  if (remainingSeconds === lastDisplayedRespawnSecond) return;

  lastDisplayedRespawnSecond = remainingSeconds;
  deathOverlaySubtitle.textContent = formatRespawnCountdown(remainingSeconds);
}

// A short window of no-damage right after respawning, so you can't be
// killed the instant you reappear. Tracked the same way as the health
// regen delay above - a timestamp compared against `now` - rather than
// needing a separate timer/interval.
const SPAWN_INVULNERABILITY_MS = 1500;

let blueScore = 0;
let redScore = 0;
let matchEnded = false;
// Personal K/D for the post-match summary (Milestone 13). Team scores
// above still decide the win; these only track the human player's kills/deaths.
let playerKills = 0;
let playerDeaths = 0;

// -----------------------------------------------------------------------
// Post-match scoring (feat-scoring-system): extra per-player stats beyond
// K/D, feeding the After Action Report's point breakdown. Incremented at
// the same choke points that already existed (fireShot()'s headshot check,
// registerPlayerKillForStreak(), damageBot()'s hit path) - see
// computeResultsReport() below for how these turn into the final score.
let playerHeadshots = 0;
let playerStreakBonusTotal = 0;
// Highest multi-kill chain reached this match - display-only (shown as the
// Streak Bonus row's sublabel), doesn't itself score any points.
let playerBestStreakThisMatch = 0;
// Sum of each hit's damage capped at the target's remaining HP, so a
// killing blow that overkills a near-dead bot doesn't inflate this past
// what the bot actually had left.
let playerDamageDealt = 0;

function resetResultsStats() {
  playerHeadshots = 0;
  playerStreakBonusTotal = 0;
  playerBestStreakThisMatch = 0;
  playerDamageDealt = 0;
}
// Set once, the first time the player actually starts playing (see
// hidePauseOverlay()) - null beforehand so the timer HUD knows not to
// start counting yet.
let matchStartTime = null;

// Timestamp until which the player can't take damage (bots store their own
// invulnerableUntil on each instance).
let playerInvulnerableUntil = -Infinity;

// Respawn logic needs live Rapier bodies, which only exist once
// startRenderLoop() has started — hooks below are assigned there.
let triggerPlayerRespawn = null;
// scheduleBotRespawn(bot) — per-bot respawn after RESPAWN_DELAY_MS.
let scheduleBotRespawn = null;

// Soft-reset bookkeeping (Milestone 13 Play Again): cancel the rAF loop,
// clear pending respawn/reload timeouts, and drop the live Rapier world.
let animationFrameId = null;
let activeWorld = null;
const pendingTimeoutIds = [];
// tryFireShot lives inside startRenderLoop; this ref lets a single
// mousedown listener (registered once) call whichever match is live.
let tryFireShotRef = null;
let shootInputBound = false;
let lastPlayerFootstepAt = -Infinity;

function trackTimeout(id) {
  pendingTimeoutIds.push(id);
  return id;
}

function clearTrackedTimeouts() {
  for (const id of pendingTimeoutIds) {
    clearTimeout(id);
  }
  pendingTimeoutIds.length = 0;
}

const matchScoreBlueEl = document.getElementById("score-blue-value");
const matchScoreRedEl = document.getElementById("score-red-value");
const matchTimerEl = document.getElementById("match-timer");
const matchEndOverlay = document.getElementById("match-end-overlay");
const matchEndTitle = document.getElementById("match-end-title");
const matchEndSubtitle = document.getElementById("match-end-subtitle");
const matchEndKd = document.getElementById("match-end-kd");
const matchEndPlayAgainButton = document.getElementById("match-end-play-again");

// Mission Debrief row elements (feat-scoring-system) - see
// computeResultsReport()/playResultsReportAnimation() below.
const resultsReportEl = document.getElementById("results-report");
const resultsBaseKillsEl = document.getElementById("results-base-kills");
const resultsBaseKillsSublabelEl = document.getElementById("results-base-kills-sublabel");
const resultsHeadshotBonusEl = document.getElementById("results-headshot-bonus");
const resultsHeadshotBonusSublabelEl = document.getElementById("results-headshot-bonus-sublabel");
const resultsStreakBonusEl = document.getElementById("results-streak-bonus");
const resultsStreakBonusSublabelEl = document.getElementById("results-streak-bonus-sublabel");
const resultsSubtotalEl = document.getElementById("results-subtotal");
const resultsMultiplierLabelEl = document.getElementById("results-multiplier-label");
const resultsMultiplierValueEl = document.getElementById("results-multiplier-value");
const resultsDamageDealtEl = document.getElementById("results-damage-dealt");
const resultsDamageDealtSublabelEl = document.getElementById("results-damage-dealt-sublabel");
const resultsWinBonusEl = document.getElementById("results-win-bonus");
const resultsWinBonusSublabelEl = document.getElementById("results-win-bonus-sublabel");
const resultsTotalScoreEl = document.getElementById("results-total-score");
const killFeedEl = document.getElementById("kill-feed");

// -----------------------------------------------------------------------
// Adaptive HUD text color (iOS-style) - the glass HUD panels are
// intentionally translucent (no opaque backing, see the "Liquid glass
// shine" block in src/style.css), so no single static text color/shadow
// stays legible against everything behind them (dark terrain vs. a bright
// sky). Instead of guessing a color, sample the ACTUAL rendered pixels
// behind each HUD text element a few times a second and flip a CSS class
// that swaps the text to near-black when the backdrop is measured as
// light, same as the iOS status bar/Control Center. Sampling, not
// per-frame: reading pixels back from the GPU is comparatively expensive,
// and HUD backdrop brightness doesn't change fast enough to need 60Hz
// updates anyway.
// -----------------------------------------------------------------------

const HUD_LUMINANCE_SAMPLE_INTERVAL_MS = 150;
const HUD_LUMINANCE_LIGHT_THRESHOLD = 0.55; // 0 (black) - 1 (white) relative luminance

// Downscaled off-screen copy of the game canvas - sampling a single pixel
// from a small (160x90) copy is far cheaper than reading the full-res
// canvas, and HUD elements don't need pixel-precise sampling anyway.
const hudLuminanceCanvas = document.createElement("canvas");
hudLuminanceCanvas.width = 160;
hudLuminanceCanvas.height = 90;
const hudLuminanceCtx = hudLuminanceCanvas.getContext("2d", {
  willReadFrequently: true,
});

// Static targets, resolved once - matchTimerEl/ammoText/healthTextEl are
// already cached above/below; the score dash has no existing const so
// it's queried here. Kill-feed "eliminated" separators are dynamic
// (created/destroyed per kill), so those are queried fresh each sample
// instead.
const scoreSeparatorEl = document.querySelector("#score-display .score-separator");
const ADAPTIVE_HUD_STATIC_TARGETS = [
  matchTimerEl,
  ammoText,
  healthTextEl,
  scoreSeparatorEl,
].filter(Boolean);

let lastHudLuminanceSampleTime = 0;

// sRGB -> linear -> relative luminance (WCAG-style, gamma-approximated).
function relativeLuminance(r, g, b) {
  const toLinear = (c) => Math.pow(c / 255, 2.2);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// Maps an element's screen-space center onto the downscaled canvas and
// reads that single pixel back. Returns null for elements that aren't
// currently laid out (display: none, zero size).
function sampleElementLuminance(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const sx = Math.min(
    hudLuminanceCanvas.width - 1,
    Math.max(0, Math.round((cx / window.innerWidth) * hudLuminanceCanvas.width))
  );
  const sy = Math.min(
    hudLuminanceCanvas.height - 1,
    Math.max(0, Math.round((cy / window.innerHeight) * hudLuminanceCanvas.height))
  );
  const [r, g, b] = hudLuminanceCtx.getImageData(sx, sy, 1, 1).data;
  return relativeLuminance(r, g, b);
}

function updateAdaptiveHudTextColor(el) {
  const luminance = sampleElementLuminance(el);
  if (luminance === null) return;
  el.classList.toggle("hud-adaptive-dark", luminance > HUD_LUMINANCE_LIGHT_THRESHOLD);
}

// Called once per frame from tick(), right after renderer.render() - the
// drawImage() below must happen in the same synchronous pass as the
// render call, before the browser has a chance to clear/present the
// WebGL canvas's drawing buffer.
function sampleHudLuminance(timestamp) {
  if (timestamp - lastHudLuminanceSampleTime < HUD_LUMINANCE_SAMPLE_INTERVAL_MS) return;
  lastHudLuminanceSampleTime = timestamp;

  hudLuminanceCtx.drawImage(
    renderer.domElement,
    0,
    0,
    hudLuminanceCanvas.width,
    hudLuminanceCanvas.height
  );

  for (const el of ADAPTIVE_HUD_STATIC_TARGETS) updateAdaptiveHudTextColor(el);
  for (const sep of killFeedEl.querySelectorAll(".kill-feed-sep")) {
    updateAdaptiveHudTextColor(sep);
  }
}

// Kill feed entries (Milestone 13). Oldest fall off when we exceed the cap.
const KILL_FEED_MAX_ENTRIES = 5;
const KILL_FEED_LIFETIME_MS = 4000;
const killFeedEntries = [];

function victimLabelForBot(bot) {
  return bot.team === "blue" ? "Ally" : "Enemy";
}

function pushKillFeedEntry(killerInfo, victimLabel, victimTeam) {
  const killer = killerInfo ?? { label: "Unknown", team: "red" };
  killFeedEntries.unshift({
    killerLabel: killer.label,
    killerTeam: killer.team,
    victimLabel,
    victimTeam,
    expiresAt: performance.now() + KILL_FEED_LIFETIME_MS,
  });
  while (killFeedEntries.length > KILL_FEED_MAX_ENTRIES) {
    killFeedEntries.pop();
  }
  renderKillFeed();
}

function renderKillFeed() {
  const now = performance.now();
  let expiredAny = false;
  for (let i = killFeedEntries.length - 1; i >= 0; i--) {
    if (killFeedEntries[i].expiresAt <= now) {
      killFeedEntries.splice(i, 1);
      expiredAny = true;
    }
  }
  // Called every frame from tick() purely to catch TTL expiry, not just
  // on new kills - skip the rebuild on the (vast majority of) frames
  // where nothing actually changed. Rebuilding unconditionally destroyed
  // and recreated every row's DOM node ~60x/second, which wiped the
  // .hud-adaptive-dark class sampleHudLuminance() (src/main.js) toggles
  // onto .kill-feed-sep before it ever got a chance to paint - "eliminated"
  // could never actually render dark against a bright sky because its
  // element was replaced within the same frame the class was set.
  if (!expiredAny && killFeedEl.children.length === killFeedEntries.length) {
    return;
  }
  killFeedEl.innerHTML = "";
  for (const entry of killFeedEntries) {
    const row = document.createElement("div");
    row.className = "kill-feed-entry";
    row.innerHTML =
      `<span class="kill-feed-name ${entry.killerTeam}">${entry.killerLabel}</span>` +
      `<span class="kill-feed-sep">eliminated</span>` +
      `<span class="kill-feed-name ${entry.victimTeam}">${entry.victimLabel}</span>`;
    killFeedEl.appendChild(row);
  }
}

function clearKillFeed() {
  killFeedEntries.length = 0;
  killFeedEl.innerHTML = "";
}

// Minimap DOM nodes (Milestone 8). Layout shapes are built once into
// #minimap-layout; player + per-bot dots are written every frame by
// updateMinimap() — see worldToMinimapPercent() for the world→map math.
const minimapLayoutEl = document.getElementById("minimap-layout");
const minimapPlayerEl = document.getElementById("minimap-player");

function updateScoreHud() {
  matchScoreBlueEl.textContent = String(blueScore);
  matchScoreRedEl.textContent = String(redScore);
}

// Maps a world XZ point onto the square #minimap as CSS left%/top%.
// Arena is centered at the origin with width GROUND_SIZE, so:
//   x = -GROUND_HALF → left 0%,  x = +GROUND_HALF → left 100%
//   z = -GROUND_HALF → top 0%,   z = +GROUND_HALF → top 100%
// (+Z is "down" on the map, matching a top-down view looking along -Y.)
// Uses GROUND_SIZE (not a hardcoded 30) so this stays correct when
// Milestone 9 switches arena presets.
function worldToMinimapPercent(x, z) {
  return {
    leftPct: (x / GROUND_SIZE + 0.5) * 100,
    topPct: (z / GROUND_SIZE + 0.5) * 100,
  };
}

// Converts a world-space half-extent (meters) to a % of the minimap square.
function worldSizeToMinimapPercent(halfExtentMeters) {
  return ((halfExtentMeters * 2) / GROUND_SIZE) * 100;
}

// Appends one axis-aligned footprint rectangle (or circle) to the layout
// layer. Centered with translate(-50%, -50%) like the live dots.
function appendMinimapShape(x, z, halfX, halfZ, className) {
  const el = document.createElement("div");
  el.className = className;
  const center = worldToMinimapPercent(x, z);
  el.style.left = `${center.leftPct}%`;
  el.style.top = `${center.topPct}%`;
  el.style.width = `${worldSizeToMinimapPercent(halfX)}%`;
  el.style.height = `${worldSizeToMinimapPercent(halfZ)}%`;
  minimapLayoutEl.appendChild(el);
}

// Builds the static top-down arena layout once from the same defs that
// place 3D cover/platforms. Intentionally abstract (axis-aligned boxes +
// circles, no tilt foreshortening, no support legs) — readable CoD /
// Valorant-style layout awareness, not a faithful orthographic render.
function buildMinimapLayout() {
  minimapLayoutEl.replaceChildren();

  for (const box of boxObstacleDefs) {
    appendMinimapShape(
      box.x,
      box.z,
      box.hx,
      box.hz,
      "minimap-shape minimap-shape-cover"
    );
  }

  for (const pillar of pillarObstacleDefs) {
    // Pillars are round in-world; same radius for X and Z on the map.
    appendMinimapShape(
      pillar.x,
      pillar.z,
      pillar.radius,
      pillar.radius,
      "minimap-shape minimap-shape-cover minimap-shape-circle"
    );
  }

  // Ground ramps: use untilted XZ box footprints. Close enough for a
  // simplified map (tilt only changes height, not the plan footprint much).
  for (const ramp of rampObstacleDefs) {
    appendMinimapShape(
      ramp.x,
      ramp.z,
      ramp.hx,
      ramp.hz,
      "minimap-shape minimap-shape-cover"
    );
  }

  for (const piece of elevatedStructurePieceDefs) {
    // Skip thin support legs — they clutter the map without helping the
    // player read walkable decks / ramp approaches.
    if (piece.type === "box" && piece.hx <= 0.2 && piece.hz <= 0.2) {
      continue;
    }
    appendMinimapShape(
      piece.x,
      piece.z,
      piece.hx,
      piece.hz,
      "minimap-shape minimap-shape-platform"
    );
  }
}

// Syncs the minimap dots to the latest player + all bot body positions.
// Called from tick() after world.step(). Keeps updating while paused/dead
// so frozen positions still show under overlays.
//
// Player facing: Three.js yaw=0 looks down -Z (toward the top of this
// map). A CSS rotate of 0deg leaves the chevron pointing up, so we negate
// yaw when converting to degrees — positive yaw turns the camera left
// (toward -X), which is counterclockwise on the map, and CSS positive
// rotation is clockwise.
function updateMinimap(playerPos, playerYaw) {
  const playerMap = worldToMinimapPercent(playerPos.x, playerPos.z);
  const yawDegrees = (-playerYaw * 180) / Math.PI;
  minimapPlayerEl.style.left = `${playerMap.leftPct}%`;
  minimapPlayerEl.style.top = `${playerMap.topPct}%`;
  minimapPlayerEl.style.transform = `translate(-50%, -50%) rotate(${yawDegrees}deg)`;

  for (const bot of bots) {
    if (bot.destroyed) {
      bot.minimapDot.style.display = "none";
      continue;
    }
    const botPos = bot.body.translation();
    const botMap = worldToMinimapPercent(botPos.x, botPos.z);
    bot.minimapDot.style.display = "block";
    bot.minimapDot.style.left = `${botMap.leftPct}%`;
    bot.minimapDot.style.top = `${botMap.topPct}%`;
  }
}

// Layout is static for the match — build it once now that the obstacle /
// platform defs and the #minimap-layout node both exist.
// buildMinimapLayout() runs from startMatch() after buildArena() sets
// GROUND_SIZE — calling it at module load would map against a pad that
// hasn't been built yet / might change with the team-size preset.

// Formats an elapsed-time duration (ms) as "M:SS" for the match timer HUD.
function formatMatchTime(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// -----------------------------------------------------------------------
// Mission Debrief scoring (feat-scoring-system)
// -----------------------------------------------------------------------
// Difficulty scales kill-based points only (base kills, headshots, streak
// bonuses) - Damage Dealt and the Win Bonus are added afterward, unscaled,
// per the locked formula:
// (Base Kills + Streak Bonus + Headshots) * (1 + Difficulty%) + Damage Dealt + Win Bonus
const DIFFICULTY_SCORE_MULTIPLIER = { easy: 0, medium: 0.5, hard: 1 };
const DIFFICULTY_SCORE_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };
// Flat, unscaled by difficulty - it's a reward for the match outcome, not
// for how tough the enemies were.
const WIN_BONUS = 400;

// Turns this match's tracked stats into every row the Mission Debrief
// needs, already summed/rounded - playResultsReportAnimation() just tweens
// the DOM to these numbers, it does no math of its own. Raw counts
// (kills/headshots/best streak/damage) ride alongside their point values
// so the UI can show "what earned this" next to "how much it was worth".
// `playerWon` is the human's team (always BLUE) having hit the kill target.
function computeResultsReport(playerWon) {
  const baseKillPoints = playerKills * 100;
  const headshotPoints = playerHeadshots * 50;
  const streakPoints = playerStreakBonusTotal;
  const subtotal = baseKillPoints + headshotPoints + streakPoints;

  const difficultyPercent =
    DIFFICULTY_SCORE_MULTIPLIER[matchConfig.difficulty] ?? DIFFICULTY_SCORE_MULTIPLIER.medium;
  const difficultyLabel =
    DIFFICULTY_SCORE_LABEL[matchConfig.difficulty] ?? DIFFICULTY_SCORE_LABEL.medium;
  const subtotalWithMultiplier = Math.round(subtotal * (1 + difficultyPercent));

  const damagePoints = Math.floor(playerDamageDealt / 2);
  const winBonus = playerWon ? WIN_BONUS : 0;
  const totalScore = subtotalWithMultiplier + damagePoints + winBonus;

  return {
    baseKillPoints,
    killCount: playerKills,
    headshotPoints,
    headshotCount: playerHeadshots,
    streakPoints,
    bestStreak: playerBestStreakThisMatch,
    subtotal,
    difficultyPercent,
    difficultyLabel,
    subtotalWithMultiplier,
    damagePoints,
    damageDealt: playerDamageDealt,
    winBonus,
    playerWon,
    totalScore,
  };
}

// -----------------------------------------------------------------------
// After Action Report animation: staggered count-up tweens + click-to-skip
// -----------------------------------------------------------------------
// Bumped on every run; tweens compare their captured token against the
// live value so a stale rAF loop (e.g. Play Again fired mid-animation)
// snaps to its target and resolves instead of hanging or clobbering the
// next match's freshly-reset display.
let resultsAnimationToken = 0;
let resultsSkipRequested = false;

// Placeholder audio hooks (feat-scoring-system) - intentionally no-ops.
// Wire real clips in here, or swap to the existing playSynthSound() helper
// (see playKillSound()/playDeathSound() above) for a zero-asset synth cue.
function playResultsTickSound() {
  // e.g. playSynthSound({ type: "square", frequency: 900, duration: 0.03, volume: 0.05 });
}
function playResultsThudSound() {
  // e.g. playSynthSound({ type: "sine", frequency: 80, frequencyEnd: 40, duration: 0.3, volume: 0.3 });
}

// Counts `el`'s text up from 0 to `to` over `durationMs`. Resolves early
// (snapped straight to `to`) if a skip was requested, or if `token` has
// been superseded by a newer animation run.
function tweenResultsNumber(el, to, durationMs, token) {
  return new Promise((resolve) => {
    const finish = () => {
      el.textContent = to.toLocaleString();
      resolve();
    };
    if (resultsSkipRequested || token !== resultsAnimationToken || to === 0) {
      finish();
      return;
    }
    const start = performance.now();
    let lastTickAt = start;
    function step(now) {
      if (resultsSkipRequested || token !== resultsAnimationToken) {
        finish();
        return;
      }
      const progress = Math.min(1, (now - start) / durationMs);
      el.textContent = Math.round(to * progress).toLocaleString();
      if (now - lastTickAt > 60) {
        playResultsTickSound();
        lastTickAt = now;
      }
      if (progress < 1) requestAnimationFrame(step);
      else finish();
    }
    requestAnimationFrame(step);
  });
}

// A pause between tween beats (e.g. before the multiplier flash) that's
// still skip-aware, so clicking during the "dead time" between two tweens
// doesn't leave the player waiting for it to elapse anyway.
function waitUnlessSkipped(ms, token) {
  return new Promise((resolve) => {
    if (resultsSkipRequested || token !== resultsAnimationToken) {
      resolve();
      return;
    }
    const timeoutId = setTimeout(resolve, ms);
    trackTimeout(timeoutId);
  });
}

// Pluralizes a simple count label, e.g. pluralizeCount(1, "Kill") -> "1 Kill".
function pluralizeCount(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// Plays the full staggered reveal: Base Kills -> Headshot Kill Bonus ->
// Streak Bonus, then a dramatic multiplier beat (cause), then Subtotal
// counts straight to its already-scaled value (effect - so the number you
// see there already has the multiplier baked in, instead of animating to
// an unscaled number and then jumping), then Damage Dealt -> Win Bonus,
// then the Total Score drops in. A click anywhere on #match-end-overlay at
// any point sets resultsSkipRequested, which every step above checks
// before its next frame/timeout - so the whole sequence collapses to
// final values within a frame or two instead of needing bespoke
// skip-handling per step.
async function playResultsReportAnimation(report) {
  resultsAnimationToken += 1;
  const token = resultsAnimationToken;
  resultsSkipRequested = false;

  resultsBaseKillsEl.textContent = "0";
  resultsBaseKillsSublabelEl.textContent = `(${pluralizeCount(report.killCount, "Kill")})`;
  resultsHeadshotBonusEl.textContent = "0";
  resultsHeadshotBonusSublabelEl.textContent = `(${pluralizeCount(report.headshotCount, "Headshot")})`;
  resultsStreakBonusEl.textContent = "0";
  resultsStreakBonusSublabelEl.textContent =
    report.bestStreak > 1 ? `(Best Streak: ${report.bestStreak})` : "(No Streak)";
  resultsMultiplierLabelEl.textContent = `${report.difficultyLabel} Multiplier`;
  resultsMultiplierValueEl.textContent = "+0%";
  resultsSubtotalEl.textContent = "0";
  resultsDamageDealtEl.textContent = "0";
  resultsDamageDealtSublabelEl.textContent = `(${report.damageDealt.toLocaleString()} DMG)`;
  resultsWinBonusEl.textContent = "0";
  resultsWinBonusSublabelEl.textContent = report.playerWon ? "(Victory)" : "(Defeat)";
  resultsTotalScoreEl.textContent = "0";
  resultsReportEl.classList.remove("results-multiplier-flash", "results-total-drop");

  const skipHandler = () => {
    resultsSkipRequested = true;
  };
  matchEndOverlay.addEventListener("click", skipHandler);

  await tweenResultsNumber(resultsBaseKillsEl, report.baseKillPoints, 750, token);
  await tweenResultsNumber(resultsHeadshotBonusEl, report.headshotPoints, 600, token);
  await tweenResultsNumber(resultsStreakBonusEl, report.streakPoints, 600, token);

  // Dramatic beat: fade/flash the multiplier in FIRST - cause before
  // effect - so by the time Subtotal counts up right below it, the
  // multiplier it explains is already on screen.
  resultsMultiplierValueEl.textContent =
    `+${Math.round(report.difficultyPercent * 100)}%`;
  resultsReportEl.classList.add("results-multiplier-flash");
  await waitUnlessSkipped(450, token);
  resultsReportEl.classList.remove("results-multiplier-flash");

  await tweenResultsNumber(resultsSubtotalEl, report.subtotalWithMultiplier, 500, token);
  await tweenResultsNumber(resultsDamageDealtEl, report.damagePoints, 600, token);
  await tweenResultsNumber(resultsWinBonusEl, report.winBonus, 500, token);

  // Final drop-in: heavy "thud" beat instead of a count-up.
  playResultsThudSound();
  resultsTotalScoreEl.textContent = report.totalScore.toLocaleString();
  resultsReportEl.classList.add("results-total-drop");

  matchEndOverlay.removeEventListener("click", skipHandler);
}

// Ends the match for good: freezes the whole simulation (tick() checks
// `matchEnded` the same way it already checks `isDead`) and shows the
// final result + the Mission Debrief score breakdown. Play Again returns
// to the pre-match menu.
function endMatch(winningTeamName) {
  matchEnded = true;
  isFiring = false;
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }

  const blueWon = winningTeamName === "BLUE";
  matchEndTitle.textContent = blueWon ? "BLUE TEAM WINS" : "RED TEAM WINS";
  matchEndTitle.style.color = blueWon ? "#3366cc" : "#cc3333";
  matchEndSubtitle.innerHTML =
    `Final Score: <span class="score-blue">${blueScore}</span> &mdash; ` +
    `<span class="score-red">${redScore}</span>` +
    ` (first to ${killTarget})`;
  // Informational only - not part of the scored report below.
  matchEndKd.textContent = `Your K/D: ${playerKills} / ${playerDeaths}`;
  matchEndOverlay.classList.remove("hidden");
  // Keep pause / death overlays from covering the summary while lock is released.
  pauseOverlay.classList.add("hidden");
  deathOverlay.classList.add("hidden");

  playResultsReportAnimation(computeResultsReport(blueWon));
}

// Called from damagePlayer() the instant the player's health reaches 0.
// Awards the kill to RED (the bot's team), then either ends the match or
// schedules the player's respawn - never both.
function handlePlayerDeath(killerInfo = null) {
  playerDeaths += 1;
  playDeathSound();
  resetKillstreak();
  pushKillFeedEntry(
    killerInfo ?? { label: "Enemy", team: "red" },
    "You",
    "blue"
  );

  redScore += 1;
  updateScoreHud();

  if (redScore >= killTarget) {
    endMatch("RED");
    return;
  }

  // Start the live countdown from the same clock setTimeout uses, so the
  // subtitle stays in sync with the actual respawn (not a separate timer).
  playerRespawnAt = performance.now() + RESPAWN_DELAY_MS;
  lastDisplayedRespawnSecond = null;
  updateDeathOverlayCountdown(performance.now());

  if (triggerPlayerRespawn) {
    playerRespawnTimeoutId = setTimeout(triggerPlayerRespawn, RESPAWN_DELAY_MS);
    trackTimeout(playerRespawnTimeoutId);
  }
}

// Called from damageBot() when a bot's health reaches 0. Red deaths award
// BLUE; blue (ally) deaths award RED — team kills, not per-character.
function handleBotDeath(bot, killerInfo = null) {
  const victimLabel = victimLabelForBot(bot);
  const victimTeam = bot.team;
  const resolvedKiller =
    killerInfo ??
    (bot.team === "red"
      ? { label: "Ally", team: "blue" }
      : { label: "Enemy", team: "red" });

  pushKillFeedEntry(resolvedKiller, victimLabel, victimTeam);

  // Player personal kill credit only when the human got the elimination.
  if (resolvedKiller.label === "You" && bot.team === "red") {
    playerKills += 1;
    playKillSound();
    registerPlayerKillForStreak();
  }

  if (bot.team === "red") {
    blueScore += 1;
    updateScoreHud();
    if (blueScore >= killTarget) {
      endMatch("BLUE");
      return;
    }
  } else {
    redScore += 1;
    updateScoreHud();
    if (redScore >= killTarget) {
      endMatch("RED");
      return;
    }
  }

  if (scheduleBotRespawn) {
    trackTimeout(setTimeout(() => scheduleBotRespawn(bot), RESPAWN_DELAY_MS));
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

  // Invisible tall containment colliders — same XZ as the visible walls,
  // but BOUNDARY_CONTAINMENT_HEIGHT tall so the player cannot cross the
  // boundary plane even from a prop taller than the grey wall mesh.
  // No Three.js mesh; collision only.
  for (const wall of wallDefs) {
    const containmentColliderDesc = RAPIER.ColliderDesc.cuboid(
      wall.hx,
      BOUNDARY_CONTAINMENT_HEIGHT / 2,
      wall.hz
    ).setTranslation(wall.x, BOUNDARY_CONTAINMENT_HEIGHT / 2, wall.z);
    world.createCollider(containmentColliderDesc);
  }

  // Interior obstacle colliders, matching the obstacle meshes created
  // above. Same "no parent rigid body" static pattern as the ground/walls.
  // Being real Rapier colliders (not just visuals) means they already
  // block the Milestone 4 gun's hitscan raycast (below) with no extra work.
  //
  // Blast / T-walls are a stepped taper (wide base, narrow upright). A
  // single full-width cuboid left invisible air collision beside the top,
  // so those defs get stacked cuboids from getBlastWallColliderLayers().
  for (const box of boxObstacleDefs) {
    if (isBlastWallCover(box)) {
      for (const layer of getBlastWallColliderLayers(box)) {
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(layer.hx, layer.hy, layer.hz).setTranslation(
            layer.x,
            layer.y,
            layer.z
          )
        );
      }
      continue;
    }
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

  // Ground ramps need rotated colliders to match their tilted meshes.
  // Rapier expects quaternions — THREE.Quaternion computes them from the
  // same Euler tilt used on each mesh.
  for (const ramp of rampObstacleDefs) {
    const rampQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(ramp.tiltRadians, 0, 0)
    );
    const rampColliderDesc = RAPIER.ColliderDesc.cuboid(
      ramp.hx,
      ramp.hy,
      ramp.hz
    )
      .setTranslation(ramp.x, ramp.hy, ramp.z)
      .setRotation({
        x: rampQuaternion.x,
        y: rampQuaternion.y,
        z: rampQuaternion.z,
        w: rampQuaternion.w,
      });
    world.createCollider(rampColliderDesc);
  }

  // Elevated walk-under structures (Milestone 7) — same static "no parent
  // rigid body" pattern as the solid cover above, but with world Y taken
  // from each piece def (decks sit above ground clearance, not on y = hy).
  for (const piece of elevatedStructurePieceDefs) {
    const pieceColliderDesc = RAPIER.ColliderDesc.cuboid(
      piece.hx,
      piece.hy,
      piece.hz
    ).setTranslation(piece.x, piece.y, piece.z);
    if (piece.type === "ramp") {
      const pieceQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(piece.tiltRadians, 0, 0)
      );
      pieceColliderDesc.setRotation({
        x: pieceQuaternion.x,
        y: pieceQuaternion.y,
        z: pieceQuaternion.z,
        w: pieceQuaternion.w,
      });
    }
    world.createCollider(pieceColliderDesc);
  }

  // A freshly created static collider isn't visible to castRay() until the
  // physics pipeline has run at least once - the broad-phase query
  // structure it needs is only built/updated during a step. No rigid
  // bodies exist yet at this point (player/bot bodies are created below,
  // using the snap this step unblocks), so this can't move or simulate
  // anything; it purely warms up queries before snapSpawnPointToFloor()
  // raycasts against the ramps/decks/walls created above. Without this,
  // every match-start raycast silently returns null and spawns fall back
  // to flat-ground height regardless of what's actually there.
  world.step();

  // Shuffle spawn pools once so the player + ally bots don't stack on the
  // same blue point at match start (respawns still pick randomly later).
  const blueSpawns = shuffleSpawnPoints(BLUE_TEAM_SPAWN_POINTS);
  const redSpawns = shuffleSpawnPoints(RED_TEAM_SPAWN_POINTS);

  // The player is a "kinematic" rigid body: we move it ourselves each frame
  // (via setNextKinematicTranslation) instead of letting Rapier's forces
  // push it around like a normal dynamic object. This gives precise,
  // responsive FPS-style control instead of physics-y/bouncy movement.
  // Reserve blueSpawns[0] for the player; allies start at index 1. Same
  // drop-to-floor raycast snap as every bot, not a fixed drop-in height.
  const initialPlayerSpawn = snapSpawnPointToFloor(world, blueSpawns[0]);
  const playerBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    initialPlayerSpawn.x,
    initialPlayerSpawn.y,
    initialPlayerSpawn.z
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

  // Milestone 10: spawn ally + enemy bots from matchConfig counts.
  spawnBotsForMatch(world, blueSpawns, redSpawns, 1);

  return {
    world,
    playerBody,
    playerCollider,
    characterController,
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
}) {
  // Cancel any previous match loop before starting a new one (Play Again).
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  activeWorld = world;

  // THREE.Timer is the modern replacement for the older THREE.Clock -
  // update() must be called once per frame (with the requestAnimationFrame
  // timestamp) before getDelta() returns the correct value.
  const timer = new THREE.Timer();
  // Vertical speed accumulated by gravity/jumping. Positive = moving up.
  let verticalVelocity = 0;
  // Sprint state (modern-overhaul): recomputed each frame from held keys +
  // blocking conditions in computeHorizontalMovement().
  let isSprinting = false;
  // 0..1 "how much horizontal movement input this frame" for weapon bob.
  let moveInput01 = 0;
  // Camera-relative WASD input (-1..1 each), fed to the viewmodel for its
  // ADS translational-lag effect — see computeHorizontalMovement() below,
  // which computes these BEFORE rotating them into world space, so they're
  // already "forward"/"right" relative to the view, matching playerArms.js's
  // own camera-local convention.
  let moveInputForward = 0;
  let moveInputRight = 0;
  // Milestone 7: true while the player's collider is the shorter crouch
  // capsule. Driven by hold-C plus a headroom check when standing up.
  let isCrouching = false;
  // 0 = standing camera height, 1 = crouch camera height. Eased over
  // CROUCH_CAMERA_TRANSITION_SECONDS so the view doesn't snap — only this
  // blend is smoothed; jump/fall still track the body instantly.
  let crouchCameraBlend = 0;

  // Slide state. isSliding implies isCrouching (same shrunk collider);
  // slideDirection is locked at trigger time — no mid-slide steering.
  let isSliding = false;
  let slideSpeed = 0;
  let slideDirection = { x: 0, z: 0 };
  let slideTimer = 0;
  // Rising-edge detector for the crouch key — needed because keysPressed
  // has no built-in edge detection (unlike jump, a slide must only trigger
  // once per press, not every frame the combo is held).
  let crouchKeyHeldLastFrame = false;
  // Set when a slide auto-stands the player (timer/speed-decay exit while
  // Crouch is still held) so the still-held key doesn't immediately force
  // them back down. Cleared the next time the key is released.
  let crouchSuppressedUntilReleased = false;
  // 0..1, eased toward isSliding the same way crouchCameraBlend is, drives
  // the camera roll "juice". Sign is decided at trigger time from strafe
  // input (see startSlide()).
  let slideRollBlend = 0;
  let slideRollSign = 1;
  // Horizontal velocity carried from a slide into a slide-jump's airtime —
  // this controller has no persistent velocity between frames otherwise
  // (WASD directly drives position deltas), so this is the explicit
  // momentum-carry workaround. Cleared once the player lands again.
  let airMomentum = { x: 0, z: 0 };
  // True once computeHorizontalMovement() has actually observed an
  // airborne (computedGrounded() === false) frame while airMomentum is
  // active. Needed because computedGrounded() is one-frame-stale: without
  // this guard, the still-true grounded reading on the very frame a slide-
  // jump sets airMomentum would immediately clear it again before it's
  // ever applied.
  let airMomentumAirborneSeen = false;

  // -----------------------------------------------------------------
  // Crouch helpers (Milestone 7)
  // -----------------------------------------------------------------
  // Capsule shapes are center-based in Rapier, so shrinking/growing the
  // half-height without also shifting body Y would lift or sink the feet.
  // CROUCH_CENTER_OFFSET is exactly that foot-anchored correction.

  function getCurrentEyeHeight() {
    return isCrouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
  }

  // Instantly matches the camera crouch blend to the physics crouch state
  // (used on respawn / OOB recovery so teleports don't ease from mid-blend).
  function snapCameraHeightToPlayer() {
    crouchCameraBlend = isCrouching ? 1 : 0;
  }

  // Tries to enter or leave crouch. Leaving can fail (and leave the player
  // crouched) when a ceiling — e.g. the low underpass — blocks the taller
  // standing capsule; the caller retries every frame while C is released.
  function setPlayerCrouch(shouldCrouch) {
    if (shouldCrouch === isCrouching) return;

    if (shouldCrouch) {
      playerCollider.setShape(
        new RAPIER.Capsule(CROUCH_HALF_HEIGHT, PLAYER_RADIUS)
      );
      const pos = playerBody.translation();
      playerBody.setTranslation(
        { x: pos.x, y: pos.y - CROUCH_CENTER_OFFSET, z: pos.z },
        true
      );
      isCrouching = true;
      return;
    }

    const pos = playerBody.translation();
    // Ray upward from the crouch capsule's head for the extra height the
    // standing capsule needs. Standing raises both the body center AND the
    // half-height, so the head rises by 2 * CROUCH_CENTER_OFFSET (0.9m),
    // not just the center offset. A full standing-shape intersection would
    // also overlap the ground whenever the character controller has the
    // player pressed slightly into the floor, falsely blocking stand-up.
    const crouchHeadY = pos.y + CROUCH_HALF_HEIGHT + PLAYER_RADIUS;
    const standExtraHeight = 2 * CROUCH_CENTER_OFFSET;
    const headroomRay = new RAPIER.Ray(
      { x: pos.x, y: crouchHeadY, z: pos.z },
      { x: 0, y: 1, z: 0 }
    );
    const ceilingHit = world.castRay(
      headroomRay,
      standExtraHeight + 0.05,
      true,
      undefined,
      undefined,
      playerCollider
    );
    if (ceilingHit !== null) return;

    playerCollider.setShape(
      new RAPIER.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS)
    );
    playerBody.setTranslation(
      { x: pos.x, y: pos.y + CROUCH_CENTER_OFFSET, z: pos.z },
      true
    );
    isCrouching = false;
  }

  // -----------------------------------------------------------------
  // Slide
  // -----------------------------------------------------------------
  // Sprint + tap Crouch triggers a slide: an initial speed burst, layered
  // on the crouch collider/camera change above, that decays based on the
  // ground slope underneath (see getGroundSlopeInfo()) and can be carried
  // into a jump (see airMomentum).

  // Downward raycast from the player's current capsule center. Returns the
  // incline angle (radians from horizontal) and the horizontal steepest-
  // descent direction, or null if there's no ground within range (e.g. the
  // player just slid off a ledge).
  function getGroundSlopeInfo() {
    const pos = playerBody.translation();
    const currentHalfHeight = isCrouching
      ? CROUCH_HALF_HEIGHT
      : PLAYER_HALF_HEIGHT;
    const rayLength =
      currentHalfHeight + PLAYER_RADIUS + SLIDE_GROUND_RAY_MARGIN;
    const ray = new RAPIER.Ray(pos, { x: 0, y: -1, z: 0 });
    const hit = world.castRayAndGetNormal(
      ray,
      rayLength,
      true,
      undefined,
      undefined,
      playerCollider
    );
    if (hit === null) return null;

    const normal = hit.normal;
    const angle = Math.acos(Math.min(1, Math.max(-1, normal.y)));

    // Steepest-descent direction = world-down projected onto the slope
    // plane: downhill = down - normal * dot(down, normal). down = (0,-1,0)
    // so this reduces to (normal.x * normal.y, normal.z * normal.y) on the
    // XZ plane once the Y term is dropped for the horizontal comparison.
    const rawX = normal.x * normal.y;
    const rawZ = normal.z * normal.y;
    const rawLength = Math.hypot(rawX, rawZ);
    const downhillX = rawLength > 0 ? rawX / rawLength : 0;
    const downhillZ = rawLength > 0 ? rawZ / rawLength : 0;

    return { angle, downhillX, downhillZ };
  }

  function startSlide() {
    const input = computeWorldInputDirection();
    const inputLength = Math.hypot(input.worldX, input.worldZ);
    // Sprint requires forward input, so this is always nonzero in practice;
    // the camera-forward fallback just avoids a divide-by-zero if that
    // condition is ever loosened.
    slideDirection =
      inputLength > 0
        ? { x: input.worldX / inputLength, z: input.worldZ / inputLength }
        : { x: -Math.sin(yaw), z: -Math.cos(yaw) };

    // Roll direction follows strafe input at the trigger moment (A = left,
    // D = right); straight-forward-only defaults to a subtle right tilt.
    slideRollSign = input.inputRight < 0 ? -1 : 1;

    setPlayerCrouch(true);
    slideSpeed = SPRINT_MOVE_SPEED * SLIDE_INITIAL_SPEED_MULTIPLIER;
    slideTimer = 0;
    isSliding = true;
  }

  // carryMomentum: true when the slide is ending because the player left
  // the ground (slide-jump, or sliding off a ledge) — stashes the current
  // slide velocity into airMomentum so it carries into the airtime instead
  // of vanishing. False for a normal grounded exit (timer/speed/crouch
  // release), where regular WASD ground movement takes over immediately.
  function endSlide(carryMomentum) {
    if (carryMomentum) {
      airMomentum = {
        x: slideDirection.x * slideSpeed,
        z: slideDirection.z * slideSpeed,
      };
    }
    isSliding = false;
    slideSpeed = 0;
  }

  function updateSlide(deltaTime) {
    slideTimer += deltaTime;

    const slope = getGroundSlopeInfo();
    if (slope === null) {
      // Slid off a ledge - no ground under the raycast to slide against.
      endSlide(true);
      return;
    }

    if (slope.angle > SLOPE_FLAT_THRESHOLD_RADIANS) {
      const alignment =
        slideDirection.x * slope.downhillX + slideDirection.z * slope.downhillZ;
      if (alignment > SLIDE_SLOPE_ALIGNMENT_DEADZONE) {
        // Downhill: suspend decay, add a slight accelerating pull so the
        // slide continues down the incline instead of petering out.
        slideSpeed = Math.min(
          SLIDE_MAX_SPEED,
          slideSpeed + SLIDE_DOWNHILL_ACCEL * deltaTime
        );
      } else if (alignment < -SLIDE_SLOPE_ALIGNMENT_DEADZONE) {
        // Uphill: decay twice as fast so momentum drains quickly.
        const step = 1 - Math.exp(-deltaTime / SLIDE_UPHILL_DECAY_TAU_SECONDS);
        slideSpeed += (SLIDE_MIN_SPEED - slideSpeed) * step;
      } else {
        // Crossing the slope near-perpendicular to its fall line: treat
        // like flat ground rather than picking a side at the boundary.
        const step = 1 - Math.exp(-deltaTime / SLIDE_FLAT_DECAY_TAU_SECONDS);
        slideSpeed += (SLIDE_MIN_SPEED - slideSpeed) * step;
      }
    } else {
      // Flat ground: smooth-damp back to walking speed over ~1 second.
      const step = 1 - Math.exp(-deltaTime / SLIDE_FLAT_DECAY_TAU_SECONDS);
      slideSpeed += (SLIDE_MIN_SPEED - slideSpeed) * step;
    }

    const wantCrouch = !!keysPressed["KeyC"] || !!keysPressed["ControlLeft"];
    const wantJump = !!keysPressed["Space"];
    const naturalEnd =
      slideTimer >= SLIDE_MAX_DURATION_SECONDS || slideSpeed < SLIDE_MIN_SPEED;

    if (naturalEnd || !wantCrouch || wantJump) {
      endSlide(wantJump);
      if (naturalEnd) {
        // Timer/speed-decay exits happen while the player is usually still
        // holding Crouch — auto-stand instead of falling straight into an
        // indefinite crouch-walk. setPlayerCrouch(false) is the same
        // ceiling-checked stand-up the manual crouch-release path uses, so
        // this can't clip the player into a low ceiling.
        setPlayerCrouch(false);
        // Require a release + re-press before crouch can trigger again so
        // the still-held key doesn't immediately force the player back
        // down on the very next frame.
        crouchSuppressedUntilReleased = true;
      }
    }
  }

  function updateCrouchAndSlide(deltaTime) {
    // C or left Ctrl (modern PC standard) both crouch.
    const wantCrouch = !!keysPressed["KeyC"] || !!keysPressed["ControlLeft"];
    const crouchJustPressed = wantCrouch && !crouchKeyHeldLastFrame;
    crouchKeyHeldLastFrame = wantCrouch;

    if (isSliding) {
      updateSlide(deltaTime);
      return;
    }

    // Sprinting (which already implies grounded forward motion, not
    // aiming/firing/reloading) + a fresh crouch press starts a slide
    // instead of the plain static crouch below.
    if (
      crouchJustPressed &&
      isSprinting &&
      characterController.computedGrounded()
    ) {
      startSlide();
      return;
    }

    if (wantCrouch) {
      // Suppressed right after a slide auto-stand until the key is
      // released once — see crouchSuppressedUntilReleased above.
      if (!isCrouching && !crouchSuppressedUntilReleased) setPlayerCrouch(true);
    } else {
      crouchSuppressedUntilReleased = false;
      if (isCrouching) {
        // Retry stand each frame so releasing C under a low ceiling, then
        // walking out, still lets the player stand once headroom is clear.
        setPlayerCrouch(false);
      }
    }
  }

  // Every currently-alive player/bot position, in world space. Feeds
  // pickSafeSpawnPoint() (via getBlueTeamSpawnTranslation/etc.) so a
  // respawn or OOB recovery doesn't drop someone on top of an entity
  // that's already standing there.
  function getLivingEntityPositions() {
    const positions = [];
    if (!isDead) {
      const p = playerBody.translation();
      positions.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    for (const bot of bots) {
      if (bot.destroyed) continue;
      const p = bot.body.translation();
      positions.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    return positions;
  }

  // Failsafe if the player somehow leaves the playable pad (e.g. a future
  // prop reopens a climb-out path). Soft teleport to spawn — no death/score
  // change — and force standing so a mid-crouch escape can't stick.
  function recoverPlayerFromOutOfBounds() {
    const pos = playerBody.translation();
    const limit = GROUND_HALF + OOB_MARGIN;
    if (Math.abs(pos.x) <= limit && Math.abs(pos.z) <= limit) return;

    verticalVelocity = 0;
    isSliding = false;
    slideSpeed = 0;
    slideRollBlend = 0;
    airMomentum = { x: 0, z: 0 };
    airMomentumAirborneSeen = false;
    crouchSuppressedUntilReleased = false;
    if (isCrouching) {
      playerCollider.setShape(
        new RAPIER.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS)
      );
      isCrouching = false;
    }
    playerBody.setTranslation(
      getBlueTeamSpawnTranslation(world, getLivingEntityPositions(), playerCollider),
      true
    );
    snapCameraHeightToPlayer();
  }

  // -----------------------------------------------------------------
  // Respawn (Milestone 6): these live here (rather than at module scope,
  // alongside handlePlayerDeath()/handleBotDeath() that schedule them) since
  // they need direct access to the live Rapier bodies/colliders, which only
  // exist once physics has finished initializing. Assigning them to the
  // module-level triggerPlayerRespawn / scheduleBotRespawn hooks is what
  // lets the death-handling code above actually call them.
  // -----------------------------------------------------------------

  function respawnPlayer() {
    isDead = false;
    playerRespawnAt = null;
    lastDisplayedRespawnSecond = null;
    playerRespawnTimeoutId = null;
    playerRespawnRemainingMs = null;
    deathOverlay.classList.add("hidden");
    verticalVelocity = 0;
    isSliding = false;
    slideSpeed = 0;
    slideRollBlend = 0;
    airMomentum = { x: 0, z: 0 };
    airMomentumAirborneSeen = false;
    crouchSuppressedUntilReleased = false;

    // Force standing before the teleport so death mid-crouch can't leave
    // the shorter capsule stuck on a standing spawn height.
    if (isCrouching) {
      playerCollider.setShape(
        new RAPIER.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS)
      );
      isCrouching = false;
    }

    // A direct teleport (not setNextKinematicTranslation, which is for the
    // normal per-frame collide-and-slide movement) since this needs to take
    // effect immediately - it's called from a setTimeout, not from inside
    // tick()'s usual movement step. Random blue-team spawn each time.
    playerBody.setTranslation(
      getBlueTeamSpawnTranslation(world, getLivingEntityPositions(), playerCollider),
      true
    );
    // Always face the enemy side (-Z) on respawn, same as the fresh-match
    // spawn - otherwise you keep whatever direction you happened to be
    // looking when you died.
    yaw = 0;
    pitch = 0;
    snapCameraHeightToPlayer();

    setPlayerHealth(PLAYER_MAX_HEALTH);
    playerLastDamageTime = -Infinity;
    playerRegenActive = false;
    playerRegenWasFull = true;
    playerInvulnerableUntil = performance.now() + SPAWN_INVULNERABILITY_MS;

    // Fairness: respawning shouldn't leave the player stuck reloading (or
    // out of ammo) from before they died.
    currentAmmo = MAGAZINE_SIZE;
    isReloading = false;
    updateAmmoDisplay();
  }
  triggerPlayerRespawn = respawnPlayer;

  function respawnBot(bot) {
    bot.destroyed = false;
    bot.collider.setEnabled(true);
    bot.group.visible = true;
    bot.minimapDot.style.display = "block";
    for (const m of bot.materials) m.emissive?.setHex(0x000000);
    // Clear the clamped death pose and restart the idle clip.
    if (bot.model.isGlb) bot.model.resetAlive();

    // Proximity-filtered team spawn each respawn (same pools as match
    // start, but steered clear of whoever's still alive on the map).
    const livingPositions = getLivingEntityPositions();
    const spawnPosition =
      bot.team === "blue"
        ? botStandingSpawnTranslation(
            world,
            pickSafeSpawnPoint(BLUE_TEAM_SPAWN_POINTS, livingPositions),
            bot.collider
          )
        : getRedTeamSpawnTranslation(world, livingPositions, bot.collider);
    bot.body.setTranslation(spawnPosition, true);
    bot.group.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    bot.group.rotation.y = 0;

    setBotHealth(bot, BOT_MAX_HEALTH);
    bot.lastDamageTime = -Infinity;
    bot.invulnerableUntil = performance.now() + SPAWN_INVULNERABILITY_MS;

    // Reset AI state so the bot doesn't instantly "remember" a target from
    // before it died - it should start fresh, as if just spawned.
    bot.spottedAtTime = null;
    bot.lastShotTime = -Infinity;
    bot.lastKnownTargetPosition = null;
    bot.moveTarget = null;
    bot.coverTarget = null;
    bot.holdingCover = false;
    bot.pauseUntil = 0;
    bot.scanYawTarget = null;
    bot.strafeSwitchAt = 0;
    bot.verticalVelocity = 0;
    bot.pendingMoveX = 0;
    bot.pendingMoveZ = 0;
  }
  scheduleBotRespawn = respawnBot;

  // -----------------------------------------------------------------
  // Shooting (Milestone 4, full-auto extension): holding left-click fires
  // repeated instant raycasts from the camera at a fixed fire rate. Set up
  // here (rather than at module scope) because it needs `world` /
  // `playerCollider`, which only exist once Rapier has finished initializing.
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
      !matchEnded &&
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
    applyRecoilKick();
    weaponViewmodel.fire();
    playGunshotSound();

    // Auto-reload (Milestone 4 extension): as soon as the last round is
    // fired, automatically start reloading - on top of the existing
    // manual "R" key, matching how most arcade shooters behave so the
    // player doesn't have to remember to reload themselves.
    if (currentAmmo === 0) startReload();

    const origin = camera.position;
    // Hip-fire cone spread vs near-perfect ADS accuracy, blended by how far
    // into the aim the viewmodel currently is.
    const adsBlend = weaponViewmodel.getAdsBlend();
    const spread =
      HIP_SPREAD_RADIANS + (ADS_SPREAD_RADIANS - HIP_SPREAD_RADIANS) * adsBlend;
    const direction = applyAimSpread(
      camera.getWorldDirection(new THREE.Vector3()),
      spread
    );
    const ray = new RAPIER.Ray(origin, direction);

    // Tracer start: an approximate muzzle-tip anchor on the viewmodel (see
    // MUZZLE_TIP_OFFSET in src/playerArms.js — tune it there if it drifts
    // from the gun's on-screen barrel once HIP_POSITION is dialed in).
    camera.updateMatrixWorld();
    const muzzlePosition = new THREE.Vector3();
    weaponViewmodel.muzzleTip.getWorldPosition(muzzlePosition);

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

    // World raycast: walls, ally bots, and enemy BODY capsules - whatever
    // the ray hits first among everything actually in the physics world.
    const worldHitDistance = hit ? hit.timeOfImpact : Infinity;

    // Independent head-sphere check (see HEAD_HITBOX_OFFSET above): tested
    // against EVERY living red bot's head sphere, not just whichever bot
    // the world raycast above happened to hit - the head sphere is a real,
    // separate hittable target of its own (see rayIntersectsSphere()), so
    // it has to be reachable even where it pokes outside its owner's body
    // capsule entirely, not just in the region where the two overlap
    // (checking it only when hit.collider was already that bot's capsule
    // was exactly that bug). Finds whichever red bot's head sphere the ray
    // reaches soonest, if any.
    let headshotBot = null;
    let headshotDistance = Infinity;
    for (const bot of bots) {
      if (bot.destroyed || bot.team !== "red") continue;
      const headCenter = getBotHeadCenter(bot, bot.body.translation());
      const d = rayIntersectsSphere(origin, direction, headCenter, HEAD_HITBOX_RADIUS);
      if (d !== null && d < headshotDistance) {
        headshotDistance = d;
        headshotBot = bot;
      }
    }

    // Whichever is actually closer along the ray wins - a wall or another
    // bot's capsule in front of a head sphere still blocks it.
    const isHeadshot = headshotBot !== null && headshotDistance <= worldHitDistance;

    if (isHeadshot || hit) {
      const hitDistance = isHeadshot ? headshotDistance : hit.timeOfImpact;
      const hitPoint = {
        x: origin.x + direction.x * hitDistance,
        y: origin.y + direction.y * hitDistance,
        z: origin.z + direction.z * hitDistance,
      };
      // Player only damages RED enemy bots — never blue allies (no FF).
      const hitBot = isHeadshot ? headshotBot : colliderToBot.get(hit.collider);

      spawnTracer(muzzlePosition, hitPoint, () => {
        // Bullet holes only make sense on static environment surfaces - a
        // decal on a bot doesn't track its animation and looks wrong once
        // it dies/respawns. Body hits get a directional blood splatter
        // (biased along the shot's travel direction) instead of dust.
        if (hitBot) {
          spawnBloodSplatterParticles(hitPoint, direction);
        } else {
          spawnImpactDecal(hitPoint, hit.normal);
          spawnWallSparkParticles(hitPoint, hit.normal);
        }
      });

      if (hitBot && hitBot.team === "red") {
        const damage = isHeadshot
          ? GUN_DAMAGE * HEADSHOT_MULTIPLIER
          : GUN_DAMAGE;
        // Capture before damageBot() mutates health, so an overkill hit on
        // a near-dead bot only scores the HP it actually had left. Rounded
        // because bot.health can be fractional between hits (continuous
        // regen ticks by HEALTH_REGEN_RATE_PER_SECOND * deltaTime) - a
        // capped killing blow would otherwise score a decimal HP amount.
        const cappedDamageForScoring = Math.round(Math.min(damage, hitBot.health));
        // "Headshot Kill Bonus" should only count headshots that actually
        // finished the bot off, not every headshot landed on a bot that
        // kept fighting - this is that hit's damage against its remaining
        // health, computed before damageBot() mutates it.
        const isLethalHit = damage >= hitBot.health;
        if (
          damageBot(hitBot, damage, { label: "You", team: "blue" }, () => {
            // Recorded from inside damageBot(), before its kill/match-end
            // cascade can run - a kill here may synchronously call
            // endMatch(), which snapshots these stats immediately, so they
            // must already include this shot by the time that happens.
            playerDamageDealt += cappedDamageForScoring;
            if (isHeadshot && isLethalHit) playerHeadshots += 1;
          })
        ) {
          showHitMarker(isHeadshot);
          spawnDamageNumber(hitPoint, damage, isHeadshot);
        }
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

  // Expose to the single module-level mousedown listener so Play Again can
  // restart the match without stacking duplicate shoot handlers.
  tryFireShotRef = tryFireShot;
  if (!shootInputBound) {
    shootInputBound = true;
    renderer.domElement.addEventListener("mousedown", (event) => {
      if (event.button === 2) {
        // Tracks the physical button regardless of pointer-lock/reloading
        // state, so startReload()'s finish callback can tell whether to
        // auto-resume ADS - see there.
        isRightMouseDown = true;
        // Right mouse: aim-down-sights (only meaningful while playing).
        // Blocked while reloading — see the mirror-image case in
        // startReload(), which cancels ADS instantly if a reload starts
        // while already aiming.
        if (
          document.pointerLockElement === renderer.domElement &&
          !isReloading
        ) {
          isAiming = true;
        }
        return;
      }
      if (event.button !== 0) return;
      isFiring = true;
      if (tryFireShotRef) tryFireShotRef(performance.now());
    });
    renderer.domElement.addEventListener("mouseup", (event) => {
      if (event.button === 0) isFiring = false;
      if (event.button === 2) {
        isRightMouseDown = false;
        isAiming = false;
      }
    });
  }

  // -----------------------------------------------------------------
  // Bot AI (Milestone 10): shared logic for every ally/enemy bot.
  // Team affiliation gates targets — blue only fights red; red fights
  // the player + blue. Difficulty only changes per-bot parameters.
  // -----------------------------------------------------------------
  function getBotEyePosition(bot) {
    const botPosition = bot.body.translation();
    return {
      x: botPosition.x,
      y: botPosition.y + EYE_HEIGHT,
      z: botPosition.z,
    };
  }
  // Player eye from the physics body (camera may not be updated yet when
  // updateBot runs earlier in the frame).
  function getPlayerEyePosition() {
    const playerPosition = playerBody.translation();
    return {
      x: playerPosition.x,
      y: playerPosition.y + getCurrentEyeHeight(),
      z: playerPosition.z,
    };
  }
  // Shared eye-to-eye Rapier raycast. True only if the first hit is
  // targetCollider. Excludes excludeCollider so a ray starting inside a
  // capsule doesn't instantly hit its own body.
  function hasLineOfSight(
    fromEyePosition,
    toEyePosition,
    excludeCollider,
    targetCollider
  ) {
    const toTarget = {
      x: toEyePosition.x - fromEyePosition.x,
      y: toEyePosition.y - fromEyePosition.y,
      z: toEyePosition.z - fromEyePosition.z,
    };
    const distance = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    if (distance === 0) return true;
    const direction = {
      x: toTarget.x / distance,
      y: toTarget.y / distance,
      z: toTarget.z / distance,
    };
    const ray = new RAPIER.Ray(fromEyePosition, direction);
    const hit = world.castRayAndGetNormal(
      ray,
      distance,
      true,
      undefined,
      undefined,
      excludeCollider
    );
    return hit !== null && hit.collider === targetCollider;
  }
  // True when geometry blocks a ray from threatEye to a standing eye at
  // slot {x,z} — used to pick Hard-tier cover that actually breaks LOS.
  function isSlotHiddenFromThreat(threatEye, slot, excludeCollider) {
    const slotEye = {
      x: slot.x,
      y: PLAYER_HALF_HEIGHT + PLAYER_RADIUS + EYE_HEIGHT,
      z: slot.z,
    };
    const toSlot = {
      x: slotEye.x - threatEye.x,
      y: slotEye.y - threatEye.y,
      z: slotEye.z - threatEye.z,
    };
    const distance = Math.hypot(toSlot.x, toSlot.y, toSlot.z);
    if (distance < 0.5) return false;
    const direction = {
      x: toSlot.x / distance,
      y: toSlot.y / distance,
      z: toSlot.z / distance,
    };
    const ray = new RAPIER.Ray(threatEye, direction);
    const hit = world.castRayAndGetNormal(
      ray,
      distance,
      true,
      undefined,
      undefined,
      excludeCollider
    );
    // Clear path to the slot = bad cover. A hit before the slot = hidden.
    if (hit === null) return false;
    return hit.timeOfImpact < distance - 0.15;
  }
  // Player → bot LOS for enemy floating health bars.
  function playerCanSeeBot(playerEyePosition, bot) {
    return hasLineOfSight(
      playerEyePosition,
      getBotEyePosition(bot),
      playerCollider,
      bot.collider
    );
  }
  // -----------------------------------------------------------------
  // Team-gated targeting (hard rule)
  // Blue allies → living red bots only (never the player / other blues).
  // Red enemies → living player + living blue bots (never other reds).
  // -----------------------------------------------------------------
  // Returns { kind: "player"|"bot", bot?, eye, position } or null.
  function getHostileCandidates(bot) {
    const candidates = [];
    if (bot.team === "red") {
      // Player counts as blue for targeting purposes.
      if (!isDead) {
        const playerPos = playerBody.translation();
        candidates.push({
          kind: "player",
          eye: getPlayerEyePosition(),
          position: { x: playerPos.x, z: playerPos.z },
        });
      }
      for (const other of bots) {
        if (other === bot || other.destroyed || other.team !== "blue") continue;
        const otherPos = other.body.translation();
        candidates.push({
          kind: "bot",
          bot: other,
          eye: getBotEyePosition(other),
          position: { x: otherPos.x, z: otherPos.z },
        });
      }
    } else {
      // Blue ally: only red enemy bots.
      for (const other of bots) {
        if (other === bot || other.destroyed || other.team !== "red") continue;
        const otherPos = other.body.translation();
        candidates.push({
          kind: "bot",
          bot: other,
          eye: getBotEyePosition(other),
          position: { x: otherPos.x, z: otherPos.z },
        });
      }
    }
    return candidates;
  }
  // Nearest living opposite-team unit this bot can currently see.
  function pickVisibleHostile(bot, botEyePosition) {
    const botPos = bot.body.translation();
    let best = null;
    let bestDistSq = Infinity;
    for (const candidate of getHostileCandidates(bot)) {
      const targetCollider =
        candidate.kind === "player" ? playerCollider : candidate.bot.collider;
      if (
        !hasLineOfSight(
          botEyePosition,
          candidate.eye,
          bot.collider,
          targetCollider
        )
      ) {
        continue;
      }
      const dx = candidate.position.x - botPos.x;
      const dz = candidate.position.z - botPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = candidate;
      }
    }
    return best;
  }
  function computeYawTowards(fromPosition, toPosition) {
    const dx = toPosition.x - fromPosition.x;
    const dz = toPosition.z - fromPosition.z;
    return Math.atan2(-dx, -dz);
  }
  // Turn-speed comes from the bot's difficulty tier (not a global constant).
  function rotateGroupTowards(bot, desiredYaw, deltaTime) {
    let angleDiff = desiredYaw - bot.group.rotation.y;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    const maxDelta = bot.turnSpeedRadiansPerSec * deltaTime;
    const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, angleDiff));
    bot.group.rotation.y += clampedDelta;
    return Math.abs(angleDiff - clampedDelta);
  }
  function applyAimSpread(direction, aimSpreadRadians) {
    const forward = new THREE.Vector3(direction.x, direction.y, direction.z);
    const arbitraryUp =
      Math.abs(forward.y) > 0.99
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3()
      .crossVectors(forward, arbitraryUp)
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const jitterRight = (Math.random() - 0.5) * 2 * aimSpreadRadians;
    const jitterUp = (Math.random() - 0.5) * 2 * aimSpreadRadians;
    return forward
      .add(right.multiplyScalar(jitterRight))
      .add(up.multiplyScalar(jitterUp))
      .normalize();
  }
  // Fires one bot shot at a hostile eye position. Damage is team-gated again
  // at the hit result so a wild spread shot can't hurt a teammate.
  function botFireShot(bot, targetEyePosition, botEyePosition) {
    const toTarget = {
      x: targetEyePosition.x - botEyePosition.x,
      y: targetEyePosition.y - botEyePosition.y,
      z: targetEyePosition.z - botEyePosition.z,
    };
    const distance = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    if (distance === 0) return;
    const aimDirection = applyAimSpread(
      {
        x: toTarget.x / distance,
        y: toTarget.y / distance,
        z: toTarget.z / distance,
      },
      bot.aimSpreadRadians
    );
    bot.group.updateMatrixWorld();
    const muzzlePosition = bot.group.localToWorld(BOT_MUZZLE_OFFSET.clone());
    spawnMuzzleFlash(muzzlePosition);
    playGunshotSound(muzzlePosition);
    const ray = new RAPIER.Ray(botEyePosition, aimDirection);
    const hit = world.castRayAndGetNormal(
      ray,
      BOT_SIGHT_RANGE,
      true,
      undefined,
      undefined,
      bot.collider
    );
    // position feeds the directional damage indicator (damagePlayer() in
    // module scope) - botEyePosition is world-space and already computed
    // right here, so no extra lookup needed.
    const killerInfo =
      bot.team === "blue"
        ? { label: "Ally", team: "blue", position: botEyePosition }
        : { label: "Enemy", team: "red", position: botEyePosition };
    if (hit) {
      const hitPoint = {
        x: botEyePosition.x + aimDirection.x * hit.timeOfImpact,
        y: botEyePosition.y + aimDirection.y * hit.timeOfImpact,
        z: botEyePosition.z + aimDirection.z * hit.timeOfImpact,
      };
      // Decals only for environment hits; bot-vs-bot hits get a directional
      // blood splatter instead of dust - see the matching comment in
      // fireShot() above. Hits on the local player never get 3D blood: the
      // splatter spawns at the impact point, which for the player is right
      // in front of the camera - it reads as the screen getting blinded by
      // red rather than as a hit effect. The 2D damage vignette/indicator
      // already covers "you got shot" feedback for the player.
      const isPlayerHit = hit.collider === playerCollider;
      const hitBot = colliderToBot.get(hit.collider);
      spawnTracer(muzzlePosition, hitPoint, () => {
        if (isPlayerHit) {
          // No 3D particles - see comment above.
        } else if (hitBot) {
          spawnBloodSplatterParticles(hitPoint, aimDirection);
        } else {
          spawnImpactDecal(hitPoint, hit.normal);
          spawnWallSparkParticles(hitPoint, hit.normal);
        }
      });
      if (bot.team === "red" && isPlayerHit) {
        damagePlayer(BOT_DAMAGE_PER_HIT, killerInfo);
      } else if (hitBot && hitBot.team !== bot.team) {
        damageBot(hitBot, BOT_DAMAGE_PER_HIT, killerInfo);
      }
    } else {
      const missPoint = {
        x: botEyePosition.x + aimDirection.x * BOT_SIGHT_RANGE,
        y: botEyePosition.y + aimDirection.y * BOT_SIGHT_RANGE,
        z: botEyePosition.z + aimDirection.z * BOT_SIGHT_RANGE,
      };
      spawnTracer(muzzlePosition, missPoint);
    }
  }
  function pickNewPatrolTarget(bot) {
    let index;
    let attempts = 0;
    do {
      index = Math.floor(Math.random() * BOT_PATROL_POINTS.length);
      attempts += 1;
      // Defensive: none of the current points fall inside a crouch
      // underpass, but re-check here so a future added point can't
      // silently send bots somewhere they can't fit. Bails out after a
      // few tries rather than looping forever if every point is somehow
      // excluded.
    } while (
      ((index === bot.lastPatrolPointIndex && BOT_PATROL_POINTS.length > 1) ||
        pointBlockedForBotNavigation(
          BOT_PATROL_POINTS[index].x,
          BOT_PATROL_POINTS[index].z
        )) &&
      attempts < 10
    );
    bot.lastPatrolPointIndex = index;
    bot.moveTarget = BOT_PATROL_POINTS[index];
  }
  // Nearest cover slot that breaks LOS from the threat eye, if any.
  function pickCoverSlot(bot, threatEye) {
    const botPos = bot.body.translation();
    let best = null;
    let bestDistSq = Infinity;
    for (const slot of coverSlots) {
      if (!isSlotHiddenFromThreat(threatEye, slot, bot.collider)) continue;
      const dx = slot.x - botPos.x;
      const dz = slot.z - botPos.z;
      const distSq = dx * dx + dz * dz;
      // Skip slots we're already standing on.
      if (distSq < BOT_WAYPOINT_ARRIVAL_RADIUS * BOT_WAYPOINT_ARRIVAL_RADIUS) {
        continue;
      }
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = slot;
      }
    }
    return best;
  }
  // Low-level move: records this frame's desired horizontal velocity.
  // Shared by pathing + combat strafing. Doesn't touch physics directly -
  // the actual collide-and-slide resolution (combined with gravity)
  // happens once per bot per frame in resolveBotMovement(), so a same-
  // frame gravity pass can't silently overwrite this via a second
  // setNextKinematicTranslation call.
  function moveBotByDirection(bot, dirX, dirZ, speed, deltaTime, now) {
    bot.pendingMoveX = dirX * speed;
    bot.pendingMoveZ = dirZ * speed;
    bot.isWalking = true;
    // Ground speed this frame — drives run-clip timeScale (anti foot-slide).
    bot.lastMoveSpeed = speed;
    // Spatial footstep while actively walking (cadence-gated, not every frame).
    if (now - bot.lastFootstepAt >= BOT_FOOTSTEP_INTERVAL_MS) {
      bot.lastFootstepAt = now;
      const currentPosition = bot.body.translation();
      playFootstepSound(
        { x: currentPosition.x, y: currentPosition.y, z: currentPosition.z },
        true
      );
    }
  }

  // Resolves this frame's actual physics for one bot: whatever horizontal
  // velocity moveBotByDirection()/applyCombatStrafe() requested this frame
  // (zero if the bot didn't move) combined with gravity, in a single
  // computeColliderMovement() call - mirrors how the player's own tick()
  // combines horizontal input + gravity into one desiredTranslation.
  // Called unconditionally every frame for every living bot (see
  // updateAllBots()), not just moving ones, so a stationary bot (e.g. an
  // Easy bot, which doesn't strafe) still settles back down if a prior
  // collision nudged it upward - without this, bots have no gravity of
  // their own and rely entirely on collision resolution to stay grounded,
  // which very rarely leaves one resting slightly above an obstacle edge
  // with nothing to pull it back down.
  function resolveBotMovement(bot, deltaTime) {
    if (bot.characterController.computedGrounded()) {
      // Same small constant downward speed the player uses to keep the
      // "grounded" check latched true instead of flickering (see tick()).
      bot.verticalVelocity = -0.5;
    } else {
      bot.verticalVelocity -= GRAVITY * deltaTime;
    }
    bot.characterController.computeColliderMovement(bot.collider, {
      x: bot.pendingMoveX * deltaTime,
      y: bot.verticalVelocity * deltaTime,
      z: bot.pendingMoveZ * deltaTime,
    });
    const correctedMovement = bot.characterController.computedMovement();
    const currentPosition = bot.body.translation();
    bot.body.setNextKinematicTranslation({
      x: currentPosition.x + correctedMovement.x,
      y: currentPosition.y + correctedMovement.y,
      z: currentPosition.z + correctedMovement.z,
    });
    bot.pendingMoveX = 0;
    bot.pendingMoveZ = 0;
  }

  function moveBotTowards(bot, target, deltaTime, now) {
    const botPosition = bot.body.translation();
    const dx = target.x - botPosition.x;
    const dz = target.z - botPosition.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= BOT_WAYPOINT_ARRIVAL_RADIUS) return true;
    if (now - bot.moveTargetSetAt >= BOT_MOVE_TIMEOUT_MS) return true;
    rotateGroupTowards(
      bot,
      computeYawTowards(botPosition, target),
      deltaTime
    );
    moveBotByDirection(
      bot,
      dx / distance,
      dz / distance,
      bot.moveSpeed,
      deltaTime,
      now
    );
    return false;
  }

  // Combat footwork while engaging a visible hostile: medium/hard bots
  // side-step perpendicular to the target, flipping direction on a random
  // timer; hard bots also hold an engagement range band (back up when
  // pushed, close distance when the target is far). Easy bots stand still
  // and shoot, like a training target.
  function applyCombatStrafe(bot, hostilePosition, now, deltaTime) {
    if (!bot.strafes) return;
    const botPosition = bot.body.translation();
    const dx = hostilePosition.x - botPosition.x;
    const dz = hostilePosition.z - botPosition.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) return;

    if (now >= bot.strafeSwitchAt) {
      bot.strafeDirection = Math.random() < 0.5 ? -1 : 1;
      bot.strafeSwitchAt = now + 700 + Math.random() * 1300;
    }

    // Perpendicular to the line toward the hostile.
    let moveX = (-dz / distance) * bot.strafeDirection;
    let moveZ = (dx / distance) * bot.strafeDirection;

    // Hard tier: blend in range-keeping (prefer ~7–14m).
    if (bot.usesCover) {
      if (distance < 7) {
        moveX -= (dx / distance) * 0.7;
        moveZ -= (dz / distance) * 0.7;
      } else if (distance > 14) {
        moveX += (dx / distance) * 0.7;
        moveZ += (dz / distance) * 0.7;
      }
    }
    const len = Math.hypot(moveX, moveZ);
    moveBotByDirection(
      bot,
      moveX / len,
      moveZ / len,
      bot.strafeSpeed,
      deltaTime,
      now
    );
  }
  // Per-bot AI tick. Same logic for every tier — only parameters differ.
  function updateBot(bot, now, deltaTime) {
    if (bot.destroyed) return;
    // Debug test mode ("P"): everything below this point is movement,
    // aiming, or firing logic - skip all of it so the bot sits still as a
    // stationary target dummy.
    if (DEBUG_FREEZE_BOTS) return;
    const botPosition = bot.body.translation();
    const botEyePosition = getBotEyePosition(bot);
    const visibleHostile = pickVisibleHostile(bot, botEyePosition);
    const underFire =
      bot.usesCover && now - bot.lastDamageTime < COVER_SEEK_WINDOW_MS;
    // Hard bots: after taking damage, peel to a cover slot that breaks LOS
    // from the current (or last-known) threat before standing in the open.
    if (underFire) {
      const threatEye =
        visibleHostile?.eye ??
        (bot.lastKnownTargetPosition
          ? {
              x: bot.lastKnownTargetPosition.x,
              y: botEyePosition.y,
              z: bot.lastKnownTargetPosition.z,
            }
          : null);
      if (threatEye && !bot.coverTarget && !bot.holdingCover) {
        bot.coverTarget = pickCoverSlot(bot, threatEye);
        if (bot.coverTarget) {
          bot.moveTarget = bot.coverTarget;
          bot.moveTargetSetAt = now;
        }
      }
    } else {
      bot.coverTarget = null;
      bot.holdingCover = false;
    }
    const relocatingToCover = bot.coverTarget !== null;
    if (relocatingToCover) {
      const reachedOrGaveUp = moveBotTowards(
        bot,
        bot.coverTarget,
        deltaTime,
        now
      );
      if (reachedOrGaveUp) {
        bot.coverTarget = null;
        bot.moveTarget = null;
        bot.holdingCover = true;
      }
      // Can still aim/fire while moving to cover if a hostile is visible.
      if (visibleHostile) {
        bot.lastKnownTargetPosition = {
          x: visibleHostile.position.x,
          z: visibleHostile.position.z,
        };
        if (bot.spottedAtTime === null) bot.spottedAtTime = now;
        const desiredYaw = computeYawTowards(botPosition, visibleHostile.eye);
        const remainingAngle = rotateGroupTowards(bot, desiredYaw, deltaTime);
        const hasReacted = now - bot.spottedAtTime >= bot.reactionDelayMs;
        const isAimed = remainingAngle <= BOT_AIM_ANGLE_THRESHOLD_RADIANS;
        const offCooldown = now - bot.lastShotTime >= BOT_FIRE_INTERVAL_MS;
        if (hasReacted && isAimed && offCooldown) {
          bot.lastShotTime = now;
          botFireShot(bot, visibleHostile.eye, botEyePosition);
        }
      } else {
        bot.spottedAtTime = null;
      }
      return;
    }
    if (visibleHostile) {
      // Sighted hostile: stop pathing, strafe (tier-dependent), turn to
      // face (tier turn-speed), fire when ready.
      bot.moveTarget = null;
      bot.pauseUntil = 0;
      bot.scanYawTarget = null;
      bot.lastKnownTargetPosition = {
        x: visibleHostile.position.x,
        z: visibleHostile.position.z,
      };
      if (bot.spottedAtTime === null) bot.spottedAtTime = now;
      applyCombatStrafe(bot, visibleHostile.position, now, deltaTime);
      const desiredYaw = computeYawTowards(botPosition, visibleHostile.eye);
      const remainingAngle = rotateGroupTowards(bot, desiredYaw, deltaTime);
      const hasReacted = now - bot.spottedAtTime >= bot.reactionDelayMs;
      const isAimed = remainingAngle <= BOT_AIM_ANGLE_THRESHOLD_RADIANS;
      const offCooldown = now - bot.lastShotTime >= BOT_FIRE_INTERVAL_MS;
      if (hasReacted && isAimed && offCooldown) {
        bot.lastShotTime = now;
        botFireShot(bot, visibleHostile.eye, botEyePosition);
      }
    } else {
      bot.spottedAtTime = null;

      // Waypoint dwell: after arriving somewhere, stand for a tier-scaled
      // beat and sweep the view around (like checking corners) before
      // committing to the next move.
      if (now < bot.pauseUntil) {
        if (bot.scanYawTarget === null) {
          bot.scanYawTarget =
            bot.group.rotation.y + (Math.random() - 0.5) * Math.PI * 1.2;
        }
        const remaining = rotateGroupTowards(
          bot,
          bot.scanYawTarget,
          deltaTime * 0.45 // slower, deliberate scan
        );
        if (remaining < 0.05) bot.scanYawTarget = null; // pick a new sweep
        return;
      }

      if (!bot.moveTarget) {
        // If the target's last known spot is inside a crouch underpass
        // (e.g. the player ducked through one), don't chase in there -
        // bots can't fit. Treat the trail as cold instead and fall back
        // to patrolling, same as if it had never been seen.
        if (
          bot.lastKnownTargetPosition &&
          pointBlockedForBotNavigation(
            bot.lastKnownTargetPosition.x,
            bot.lastKnownTargetPosition.z
          )
        ) {
          bot.lastKnownTargetPosition = null;
        }
        if (bot.lastKnownTargetPosition) {
          bot.moveTarget = bot.lastKnownTargetPosition;
        } else {
          pickNewPatrolTarget(bot);
        }
        bot.moveTargetSetAt = now;
      }
      const reachedOrGaveUp = moveBotTowards(
        bot,
        bot.moveTarget,
        deltaTime,
        now
      );
      if (reachedOrGaveUp) {
        if (bot.moveTarget === bot.lastKnownTargetPosition) {
          bot.lastKnownTargetPosition = null;
        }
        bot.moveTarget = null;
        const [minPause, maxPause] = bot.pauseAtWaypointMs;
        bot.pauseUntil = now + minPause + Math.random() * (maxPause - minPause);
        bot.scanYawTarget = null;
      }
    }
  }
  function updateAllBots(now, deltaTime) {
    for (const bot of bots) {
      updateBot(bot, now, deltaTime);
      // Runs even on frames the bot didn't move (pendingMoveX/Z default to
      // 0) so gravity still applies - see resolveBotMovement(). Skipped for
      // destroyed bots (collider disabled, nothing to resolve) and while
      // DEBUG_FREEZE_BOTS holds them as stationary target dummies.
      if (!bot.destroyed && !DEBUG_FREEZE_BOTS) {
        resolveBotMovement(bot, deltaTime);
      }
    }
  }

  // Reads WASD, normalizes, and rotates it by camera yaw into a world-space
  // direction. Shared by computeHorizontalMovement() (every frame's actual
  // movement) and startSlide() (which needs "current input direction" at
  // the instant a slide triggers, before that frame's movement is computed).
  function computeWorldInputDirection() {
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

    return { worldX, worldZ, inputForward, inputRight };
  }

  function computeHorizontalMovement(deltaTime) {
    const input = computeWorldInputDirection();

    moveInput01 =
      input.inputForward !== 0 || input.inputRight !== 0 ? 1 : 0;
    moveInputForward = input.inputForward;
    moveInputRight = input.inputRight;

    // Sprint: Shift + forward movement, blocked while crouching, aiming,
    // firing, or reloading — the standard modern-FPS rule set. (isCrouching
    // is already true while sliding, so this naturally excludes slides too.)
    isSprinting =
      (!!keysPressed["ShiftLeft"] || !!keysPressed["ShiftRight"]) &&
      input.inputForward > 0 &&
      !isCrouching &&
      !isAiming &&
      !isFiring &&
      !isReloading;

    // While sliding, horizontal movement is driven entirely by the slide's
    // own decaying velocity — WASD input is ignored (no mid-slide steering)
    // until updateSlide()/endSlide() hands control back.
    if (isSliding) {
      return {
        x: slideDirection.x * slideSpeed * deltaTime,
        z: slideDirection.z * slideSpeed * deltaTime,
      };
    }

    // Crouch is a static speed reduction; sliding (above) is the dynamic one.
    const speed = isCrouching
      ? CROUCH_MOVE_SPEED
      : isSprinting
        ? SPRINT_MOVE_SPEED
        : MOVE_SPEED;
    let dx = input.worldX * speed * deltaTime;
    let dz = input.worldZ * speed * deltaTime;

    // Slide-jump momentum carry: this kinematic controller has no
    // persistent velocity between frames otherwise, so a jump (or ledge
    // fall) out of a slide stashes its horizontal speed in airMomentum and
    // it's added on top of normal air-control WASD movement here until the
    // player lands again. computedGrounded() is one-frame-stale (still
    // reads true on the very frame the jump/fall is triggered), so
    // airMomentumAirborneSeen guards against clearing airMomentum on that
    // same stale-true frame before it's ever actually applied.
    if (!characterController.computedGrounded()) {
      dx += airMomentum.x * deltaTime;
      dz += airMomentum.z * deltaTime;
      airMomentumAirborneSeen = true;
    } else if (
      airMomentumAirborneSeen &&
      (airMomentum.x !== 0 || airMomentum.z !== 0)
    ) {
      airMomentum = { x: 0, z: 0 };
      airMomentumAirborneSeen = false;
    }

    return { x: dx, z: dz };
  }

  function tick(timestamp) {
    timer.update(timestamp);
    const deltaTime = Math.min(timer.getDelta(), MAX_DELTA_TIME);

    // Freeze the entire simulation while paused (overlay showing), dead, or
    // once the match has ended - no gravity, no movement, no physics
    // stepping - so the player can't fall, slide, or otherwise keep moving
    // while they have no control over the game. The scene still renders
    // below so the frame doesn't go blank.
    if (!isPaused && !isDead && !matchEnded) {
      // Full-auto: keep firing every frame the button is held, as long as
      // canFire()/the fire-rate cooldown allow it (see tryFireShot above).
      if (isFiring) tryFireShot(timestamp);

      // Bot AI: team-gated targeting, aim/turn, fire, patrol/chase/cover.
      updateAllBots(timestamp, deltaTime);

      // Gradual health regeneration for player + every living bot.
      regenPlayerHealth(timestamp, deltaTime);
      regenAllBotsHealth(timestamp, deltaTime);

      // Multi-kill combo chain: counts down the window since the last
      // kill and breaks the chain once it expires.
      updateMultiKillTimer(deltaTime);

      // In-flight bullet tracers + impact dust/spark bursts (ballistics
      // polish) - both freeze along with everything else while paused.
      updateTracers(deltaTime);
      updateImpactParticles(deltaTime);

      // Hold-C crouch / sprint+tap-C slide: resize capsule, adjust speed,
      // and advance slide decay before movement so this frame's
      // collide-and-slide uses the right shape and speed. isSprinting here
      // is last frame's value (computeHorizontalMovement runs after this),
      // the same one-frame staleness computedGrounded() already has below.
      updateCrouchAndSlide(deltaTime);

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

      // Player footsteps: grounded + actually moving horizontally, cadence-gated.
      const horizontalSpeed = Math.hypot(horizontal.x, horizontal.z);
      if (
        characterController.computedGrounded() &&
        horizontalSpeed > 0.0001
      ) {
        const interval = isCrouching
          ? PLAYER_CROUCH_FOOTSTEP_INTERVAL_MS
          : isSprinting
            ? PLAYER_SPRINT_FOOTSTEP_INTERVAL_MS
            : PLAYER_FOOTSTEP_INTERVAL_MS;
        if (timestamp - lastPlayerFootstepAt >= interval) {
          lastPlayerFootstepAt = timestamp;
          playFootstepSound(null, isCrouching);
        }
      }

      world.step();

      // After physics commits the new position — catch escapes past the
      // walls/containment colliders and snap back to spawn.
      recoverPlayerFromOutOfBounds();
    }

    // Follow the player's current position with the camera. Runs even while
    // paused so the camera stays put at the player's last known position
    // instead of needing separate paused/unpaused render paths.
    // Crouch/stand eases the view over ~0.15s; jump/fall still track the
    // body instantly. Shooting/LOS keep using getCurrentEyeHeight() (the
    // real physics eye), not this smoothed view height.
    const playerPosition = playerBody.translation();
    const targetCrouchBlend = isCrouching ? 1 : 0;
    const crouchBlendStep =
      1 - Math.exp(-deltaTime / CROUCH_CAMERA_TRANSITION_SECONDS);
    crouchCameraBlend +=
      (targetCrouchBlend - crouchCameraBlend) * crouchBlendStep;

    // Physics body Y already snaps by CROUCH_CENTER_OFFSET on crouch, so
    // rebuild height from a standing-equivalent center + an eased offset
    // that includes both the eye-height change and that center shift.
    const standingBodyY = isCrouching
      ? playerPosition.y + CROUCH_CENTER_OFFSET
      : playerPosition.y;
    const crouchEyeFromStanding = CROUCH_EYE_HEIGHT - CROUCH_CENTER_OFFSET;
    const visualEyeFromStanding =
      EYE_HEIGHT +
      (crouchEyeFromStanding - EYE_HEIGHT) * crouchCameraBlend;

    camera.position.set(
      playerPosition.x,
      standingBodyY + visualEyeFromStanding,
      playerPosition.z
    );

    // Snap layer only - decays toward zero each frame (Milestone 11;
    // reworked feat-scoring-system). The permanent climb lives in
    // pitch/yaw themselves (see applyRecoilKick()), so this decay never
    // erases the lasting part of the kick - only the cosmetic pop on top.
    const recoilDecay = Math.exp(-RECOIL_SNAP_RECOVERY_PER_SECOND * deltaTime);
    recoilPitch *= recoilDecay;
    recoilYaw *= recoilDecay;
    if (Math.abs(recoilPitch) < 0.0001) recoilPitch = 0;
    if (Math.abs(recoilYaw) < 0.0001) recoilYaw = 0;

    camera.rotation.y = yaw + recoilYaw;
    camera.rotation.x = Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, pitch + recoilPitch)
    );

    // Slide camera roll ("juice"): eases in/out over
    // SLIDE_CAMERA_ROLL_TRANSITION_SECONDS the same way crouchCameraBlend
    // does, direction set once at slide trigger (see startSlide()).
    const targetSlideRollBlend = isSliding ? 1 : 0;
    const slideRollStep =
      1 - Math.exp(-deltaTime / SLIDE_CAMERA_ROLL_TRANSITION_SECONDS);
    slideRollBlend += (targetSlideRollBlend - slideRollBlend) * slideRollStep;
    camera.rotation.z = -slideRollSign * SLIDE_CAMERA_ROLL_RADIANS * slideRollBlend;

    // --- Modern-overhaul: FOV blending + weapon viewmodel animation ---
    const playing = !isPaused && !isDead && !matchEnded;
    if (!playing) {
      isSprinting = false;
      moveInput01 = 0;
      moveInputForward = 0;
      moveInputRight = 0;
    }
    const targetFovAtReferenceAspect =
      isAiming && !isSprinting && playing
        ? ADS_FOV
        : isSprinting
          ? SPRINT_FOV
          : BASE_FOV;
    // Re-derived every frame from the CURRENT aspect ratio (not just once
    // on resize) so the horizontal FOV these constants imply at 16:9 stays
    // constant no matter the window shape - see convertVerticalFov() above.
    const targetFov = convertVerticalFov(
      targetFovAtReferenceAspect,
      FOV_REFERENCE_ASPECT,
      camera.aspect
    );
    const fovStep = 1 - Math.exp(-12 * deltaTime);
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * fovStep;
      camera.updateProjectionMatrix();
    }
    weaponViewmodel.update(deltaTime, {
      wantAds: isAiming && playing,
      sprinting: isSprinting,
      moveSpeed01: moveInput01,
      moveForward: moveInputForward,
      moveRight: moveInputRight,
    });

    // Hide the crosshair while ADS (the iron sights are the aim reference).
    crosshairEl.classList.toggle("hidden", weaponViewmodel.getAdsBlend() > 0.5);

    updateAudioListenerFromCamera();
    renderKillFeed();

    // Live death-overlay countdown (3…2…1). Runs even while the simulation
    // is frozen for isDead — uses performance.now() to stay aligned with
    // the setTimeout scheduled in handlePlayerDeath().
    if (isDead) {
      updateDeathOverlayCountdown(performance.now());
    }

    // Match timer HUD (Milestone 6). Runs even while paused so the display
    // doesn't glitch, but simply stops advancing once the match has ended -
    // note this counts real elapsed time since the first play, and doesn't
    // subtract time spent paused mid-match; an accepted simplification for
    // a single-player portfolio demo rather than something worth the extra
    // bookkeeping.
    if (matchStartTime !== null && !matchEnded) {
      matchTimerEl.textContent = formatMatchTime(timestamp - matchStartTime);
    }

    // Spawn-invulnerability visual cues (Milestone 6) - purely cosmetic,
    // the actual no-damage effect is enforced in damagePlayer()/damageBot()
    // above. Checked every frame against the stored "invulnerable until"
    // timestamps rather than using setTimeout, so it can't drift out of
    // sync with the real damage-blocking logic.
    const playerIsInvulnerable = timestamp < playerInvulnerableUntil;
    spawnInvulnOverlay.classList.toggle(
      "active",
      playerIsInvulnerable && !isDead && !matchEnded
    );

    // Sync every bot mesh + invuln opacity + floating health bar after
    // world.step() (same timing as the player camera sync above).
    const playerEyeForBars = getPlayerEyePosition();
    for (const bot of bots) {
      // Advance the animation mixer even for corpses (the death clip has to
      // finish playing) — but only while the simulation is live, so paused
      // frames genuinely freeze everything.
      if (bot.model.isGlb && playing) bot.model.update(deltaTime);

      if (bot.destroyed) {
        bot.isWalking = false;
        continue;
      }

      const botIsInvulnerable = timestamp < bot.invulnerableUntil;
      const botOpacity = botIsInvulnerable ? 0.5 : 1;
      for (const m of bot.materials) m.opacity = botOpacity;

      const botPosition = bot.body.translation();
      bot.group.position.set(botPosition.x, botPosition.y, botPosition.z);

      // Animation state from what the AI did this frame (flag set in
      // moveBotByDirection): run w/ speed-matched timeScale, a short shoot
      // hold after firing, otherwise idle. Procedural fallback keeps the
      // old leg-swing walk cycle.
      if (bot.model.isGlb) {
        bot.model.setLocomotion(
          bot.isWalking,
          bot.lastMoveSpeed ?? BOT_MOVE_SPEED,
          timestamp - bot.lastShotTime < SHOOT_ANIM_HOLD_MS
        );
      } else {
        bot.model.walk(deltaTime, bot.isWalking ? 1 : 0);
      }
      bot.isWalking = false;

      const barVisible =
        !bot.healthBar.isEnemy || playerCanSeeBot(playerEyeForBars, bot);
      updateFloatingHealthBarPosition(
        bot.healthBar,
        {
          x: botPosition.x,
          y: botPosition.y + BOT_HEALTH_BAR_HEIGHT_OFFSET,
          z: botPosition.z,
        },
        barVisible
      );
    }

    // Minimap (Milestone 8): live top-down dots for player + all bots.
    updateMinimap(playerPosition, yaw);

    renderer.render(scene, camera);
    sampleHudLuminance(timestamp);
    animationFrameId = requestAnimationFrame(tick);
  }
  animationFrameId = requestAnimationFrame(tick);
}

// -----------------------------------------------------------------------
// Pre-match menu (Milestone 9) — gates arena build + physics bootstrap
// -----------------------------------------------------------------------

const prematchMenu = document.getElementById("prematch-menu");
const prematchStartButton = document.getElementById("prematch-start-button");
const prematchTeamHint = document.getElementById("prematch-team-hint");

// Live selection state while the menu is open (defaults match the HTML
// "selected" buttons). Copied into matchConfig on Start Match.
const pendingMatchSettings = {
  teamSize: "3v3",
  difficulty: "medium",
  killTarget: 10,
};

// Applied match settings after Start Match — allyBots/enemyBots drive spawn.
let matchConfig = {
  teamSize: "3v3",
  difficulty: "medium",
  killTarget: 10,
  allyBots: 2,
  enemyBots: 3,
};

const TEAM_SIZE_HINTS = {
  "1v1": "1v1 = you vs 1 enemy bot",
  "3v3": "3v3 = you + 2 ally bots vs 3 enemy bots",
  "5v5": "5v5 = you + 4 ally bots vs 5 enemy bots",
};

function updatePrematchTeamHint() {
  prematchTeamHint.textContent =
    TEAM_SIZE_HINTS[pendingMatchSettings.teamSize] ?? TEAM_SIZE_HINTS["1v1"];
}

// Wire each button group: clicking an option selects it and updates
// pendingMatchSettings. data-group on the parent names the setting key.
function wirePrematchOptionGroup(groupElement) {
  const groupKey = groupElement.dataset.group;
  const buttons = groupElement.querySelectorAll(".prematch-option");

  for (const button of buttons) {
    button.addEventListener("click", () => {
      for (const other of buttons) {
        other.classList.remove("selected");
      }
      button.classList.add("selected");

      const rawValue = button.dataset.value;
      if (groupKey === "killTarget") {
        pendingMatchSettings.killTarget = Number(rawValue);
      } else if (groupKey === "teamSize") {
        pendingMatchSettings.teamSize = rawValue;
        updatePrematchTeamHint();
      } else if (groupKey === "difficulty") {
        pendingMatchSettings.difficulty = rawValue;
      }
    });
  }
}

wirePrematchOptionGroup(document.getElementById("prematch-team-size"));
wirePrematchOptionGroup(document.getElementById("prematch-difficulty"));
wirePrematchOptionGroup(document.getElementById("prematch-kill-target"));
updatePrematchTeamHint();

// Kick the (large) GLB downloads off immediately so they overlap with the
// player's time on the Match Setup screen instead of blocking Start Match.
// Cached — Start Match/Play Again reuse the same promise. Previously fired
// from the title splash's Continue click; now that that screen is gone,
// the Match Setup menu is the first thing shown, so this just runs at load.
loadGameAssets();

// -----------------------------------------------------------------------
// Soft reset / Play Again (Milestone 13)
// -----------------------------------------------------------------------

function disposeAllBots() {
  for (const bot of bots) {
    scene.remove(bot.group);
    for (const m of bot.materials) m.dispose();
    if (bot.debugHitboxMeshes) {
      for (const mesh of [bot.debugHitboxMeshes.body, bot.debugHitboxMeshes.head]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    if (bot.healthBar?.container?.parentNode) {
      bot.healthBar.container.parentNode.removeChild(bot.healthBar.container);
    }
    if (bot.minimapDot?.parentNode) {
      bot.minimapDot.parentNode.removeChild(bot.minimapDot);
    }
  }
  bots.length = 0;
  colliderToBot.clear();
}

// Tears down the live match and returns to Match Setup without a page reload
// so Play Again can start a fresh match with new menu choices.
function returnToPrematchMenu() {
  clearLockRetry();
  clearTrackedTimeouts();
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }

  disposeAllBots();
  activeWorld = null;
  tryFireShotRef = null;
  triggerPlayerRespawn = null;
  scheduleBotRespawn = null;

  // Drop arena visuals; next startMatch() rebuilds for the chosen size.
  clearArenaCoverMeshes();
  if (groundMesh) {
    scene.remove(groundMesh);
    disposeObjectGeometry(groundMesh);
    groundMesh = null;
  }
  for (const mesh of wallMeshes) {
    scene.remove(mesh);
    disposeObjectGeometry(mesh);
  }
  wallMeshes.length = 0;
  clearSkyline();
  if (minimapLayoutEl) minimapLayoutEl.innerHTML = "";

  matchReady = false;
  matchEnded = false;
  isPaused = true;
  hasPlayedBefore = false;
  matchStartTime = null;
  blueScore = 0;
  redScore = 0;
  playerKills = 0;
  playerDeaths = 0;
  resetResultsStats();
  killTarget = pendingMatchSettings.killTarget;
  updateScoreHud();
  matchTimerEl.textContent = "0:00";
  clearKillFeed();

  isDead = false;
  playerRespawnAt = null;
  lastDisplayedRespawnSecond = null;
  playerRespawnTimeoutId = null; // already cleared via clearTrackedTimeouts()
  playerRespawnRemainingMs = null;
  deathOverlay.classList.add("hidden");
  deathOverlaySubtitle.textContent = "";
  setPlayerHealth(PLAYER_MAX_HEALTH);
  playerLastDamageTime = -Infinity;
  playerRegenActive = false;
  playerRegenWasFull = true;
  playerInvulnerableUntil = -Infinity;
  currentAmmo = MAGAZINE_SIZE;
  isReloading = false;
  isFiring = false;
  isAiming = false;
  camera.fov = convertVerticalFov(BASE_FOV, FOV_REFERENCE_ASPECT, camera.aspect);
  camera.updateProjectionMatrix();
  updateAmmoDisplay();
  vignette.classList.remove("active");
  spawnInvulnOverlay.classList.remove("active");
  hitMarkerEl.classList.remove("active");
  resetKillstreak();
  damageNumbersEl.innerHTML = "";
  damageIndicatorsEl.innerHTML = "";
  liveDamageIndicators.length = 0;

  // Drop any bullet tracers/decals/particle bursts still live from the
  // just-ended match - the arena they're drawn against is about to be
  // torn down/rebuilt, so leaving these in the scene would show floating
  // debris with nothing left to have caused it.
  for (const tracer of activeTracers) scene.remove(tracer.group);
  activeTracers.length = 0;
  for (const decal of liveDecals) scene.remove(decal);
  liveDecals.length = 0;
  for (const burst of activeParticleBursts) {
    scene.remove(burst.mesh);
    burst.mesh.material.dispose();
  }
  activeParticleBursts.length = 0;

  recoilPitch = 0;
  recoilYaw = 0;
  yaw = 0;
  pitch = 0;
  lastPlayerFootstepAt = -Infinity;

  matchEndOverlay.classList.add("hidden");
  pauseOverlay.classList.add("hidden");
  prematchMenu.classList.remove("hidden");
  prematchStartButton.disabled = false;
  prematchStartButton.textContent = "Start Match";
}

matchEndPlayAgainButton.addEventListener("click", () => {
  returnToPrematchMenu();
});

// Applies menu choices, builds the sized arena, then starts physics + the
// render loop. Safe to call again after Play Again → returnToPrematchMenu().
function startMatch() {
  ensureAudio();

  const teamSize = pendingMatchSettings.teamSize;
  const difficulty = pendingMatchSettings.difficulty;
  const chosenKillTarget = pendingMatchSettings.killTarget;
  const botCounts = TEAM_SIZE_BOT_COUNTS[teamSize] ?? TEAM_SIZE_BOT_COUNTS["1v1"];
  // Unknown difficulty strings fall back to medium before spawn copies knobs.
  const resolvedDifficulty = DIFFICULTY_TIERS[difficulty] ? difficulty : "medium";

  matchConfig = {
    teamSize,
    difficulty: resolvedDifficulty,
    killTarget: chosenKillTarget,
    allyBots: botCounts.allyBots,
    enemyBots: botCounts.enemyBots,
  };
  killTarget = chosenKillTarget;

  // Reset per-match counters in case Start Match is used after a soft reset
  // that somehow left scores non-zero (Play Again already clears these).
  blueScore = 0;
  redScore = 0;
  playerKills = 0;
  playerDeaths = 0;
  resetResultsStats();
  matchEnded = false;
  hasPlayedBefore = false;
  matchStartTime = null;
  updateScoreHud();
  matchTimerEl.textContent = "0:00";
  clearKillFeed();

  buildArena(ARENA_SIZES[teamSize] ?? ARENA_SIZES["1v1"]);
  buildMinimapLayout();

  // Disable the button so a double-click can't start physics twice.
  prematchStartButton.disabled = true;
  prematchStartButton.textContent = "Loading...";

  // GLB assets FIRST, then physics: bots are spawned inside initPhysics(),
  // so gameAssets must already be populated by the time it runs or the
  // first match silently falls back to the procedural placeholder bots
  // (the "SWAT mesh not applying" bug). The loading manager reports
  // per-file progress on the button so the (large) bot mesh download never
  // looks frozen; loadGameAssets() is cached — Play Again resolves instantly.
  loadGameAssets((loaded, total) => {
    prematchStartButton.textContent = `Loading assets… ${loaded}/${total}`;
  })
    .then((assets) => {
      gameAssets = assets;
      if (!assets.botTemplate) {
        console.error(
          "swat_mesh.glb unavailable — bots will use the procedural fallback"
        );
      }
      for (const name of ["idle", "run", "shoot", "death"]) {
        if (!assets.botClips?.[name]) {
          console.error(`Bot animation clip failed to load/extract: ${name}`);
        }
      }
      if (!assets.playerArms) {
        console.error(
          "player_arms.glb unavailable — the player's viewmodel will be " +
            "invisible (no procedural fallback for it)"
        );
      }
      weaponViewmodel.setArmsModel(
        assets.playerArms?.scene,
        assets.playerArms?.animations
      );
      return initPhysics();
    })
    .then((physics) => {
      startRenderLoop(physics);
      // Reveal Click to Play only after physics + the render loop are ready,
      // so the player can't lock the pointer into a half-initialized match.
      matchReady = true;
      prematchMenu.classList.add("hidden");
      if (DEV_AUTOPLAY) {
        hidePauseOverlay();
      } else {
        showPauseOverlay();
      }
    })
    .catch((error) => {
      console.error("Failed to initialize Rapier physics:", error);
      // Let the player try again if WASM init somehow failed.
      prematchStartButton.disabled = false;
      prematchStartButton.textContent = "Start Match";
    });
}

prematchStartButton.addEventListener("click", () => {
  startMatch();
});

// devplay test mode: skip the menus entirely and start a default match so
// headless/automated runs can capture real gameplay frames.
if (DEV_AUTOPLAY) {
  prematchMenu.classList.add("hidden");
  startMatch();
}
