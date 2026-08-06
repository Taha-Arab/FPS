// ---------------------------------------------------------------------------
// Humanoid soldier model (modern-overhaul): replaces the debug capsules.
// Built from primitives + a procedural camo texture, sized to fit inside the
// existing Rapier capsule collider (total height 2.0m, origin at the capsule
// CENTER, i.e. 1.0m above the feet). Includes a simple walk cycle.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { createCamoTexture } from "./textures.js";

// Head starts this far above the capsule center — used by main.js for
// headshot detection on the hitscan ray.
export const HEADSHOT_MIN_Y_OFFSET = 0.52;

// One camo texture per team, created lazily and shared by all bots.
let redCamo = null;
let blueCamo = null;
function getTeamCamo(team) {
  if (team === "red") {
    if (!redCamo) redCamo = createCamoTexture("#6e4a42", "#4a2e2a", "#8a6152");
    return redCamo;
  }
  if (!blueCamo) blueCamo = createCamoTexture("#45566e", "#2c3a52", "#5d7391");
  return blueCamo;
}

// Builds one soldier. Returns:
//   group      — add to scene; position at the Rapier capsule center
//   materials  — every material (for invuln opacity / hit flash)
//   headMesh   — for potential headshot VFX
//   walk(dt, speed01) — advances the walk cycle (0 = idle pose)
export function buildSoldierModel(team) {
  const group = new THREE.Group();

  const camoMap = getTeamCamo(team);
  const uniformMat = new THREE.MeshStandardMaterial({
    map: camoMap,
    roughness: 0.85,
    metalness: 0.05,
    transparent: true,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xb08d6a,
    roughness: 0.7,
    transparent: true,
  });
  const gearMat = new THREE.MeshStandardMaterial({
    color: team === "red" ? 0x3a2420 : 0x20283a,
    roughness: 0.8,
    transparent: true,
  });
  const gunMat = new THREE.MeshStandardMaterial({
    color: 0x222428,
    roughness: 0.5,
    metalness: 0.7,
    transparent: true,
  });
  const materials = [uniformMat, skinMat, gearMat, gunMat];

  // All local Y values below are relative to the capsule CENTER (feet at
  // -1.0, top of head near +1.0).

  // --- Torso ---
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.26), uniformMat);
  torso.position.y = 0.12;
  group.add(torso);
  // Chest rig / plate carrier.
  const rig = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 0.1), gearMat);
  rig.position.set(0, 0.16, -0.16);
  group.add(rig);
  // Belt.
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.28), gearMat);
  belt.position.y = -0.18;
  group.add(belt);

  // --- Head + helmet ---
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), skinMat);
  head.position.y = 0.62;
  group.add(head);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    uniformMat
  );
  helmet.position.y = 0.68;
  group.add(helmet);

  // --- Limb builder: pivot at the joint so rotation swings naturally ---
  function limb(width, length, mat, x, y, z) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, length, width), mat);
    mesh.position.y = -length / 2;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }

  const leftLeg = limb(0.15, 0.62, uniformMat, -0.12, -0.36, 0);
  const rightLeg = limb(0.15, 0.62, uniformMat, 0.12, -0.36, 0);
  // Boots.
  for (const legPivot of [leftLeg, rightLeg]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.24), gearMat);
    boot.position.set(0, -0.62, -0.03);
    legPivot.add(boot);
  }

  // Arms: posed holding a rifle across the chest, pointing forward (-Z).
  const leftArm = limb(0.12, 0.5, uniformMat, -0.27, 0.34, 0);
  const rightArm = limb(0.12, 0.5, uniformMat, 0.27, 0.34, 0);
  leftArm.rotation.x = -1.1;
  leftArm.rotation.z = 0.55;
  rightArm.rotation.x = -1.15;
  rightArm.rotation.z = -0.3;

  // --- Rifle held in front (also the bots' visual muzzle origin) ---
  const rifle = new THREE.Group();
  const rifleBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.55), gunMat);
  rifle.add(rifleBody);
  const rifleMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), gunMat);
  rifleMag.position.set(0, -0.11, 0.05);
  rifleMag.rotation.x = 0.25;
  rifle.add(rifleMag);
  const rifleBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.22, 8),
    gunMat
  );
  rifleBarrel.rotation.x = Math.PI / 2;
  rifleBarrel.position.set(0, 0.015, -0.36);
  rifle.add(rifleBarrel);
  rifle.position.set(0.05, 0.25, -0.32);
  rifle.rotation.x = -0.06;
  group.add(rifle);

  // Muzzle anchor (world position via localToWorld on the group).
  const muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.position.set(0.05, 0.27, -0.8);
  group.add(muzzleAnchor);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  let walkPhase = Math.random() * Math.PI * 2;
  function walk(deltaTime, speed01) {
    if (speed01 > 0.02) {
      walkPhase += deltaTime * 7.5 * Math.max(speed01, 0.3);
      const swing = Math.sin(walkPhase) * 0.55 * speed01;
      leftLeg.rotation.x = swing;
      rightLeg.rotation.x = -swing;
    } else {
      // Ease back to idle.
      leftLeg.rotation.x *= Math.exp(-8 * deltaTime);
      rightLeg.rotation.x *= Math.exp(-8 * deltaTime);
    }
  }

  return { group, materials, headMesh: head, muzzleAnchor, walk, isGlb: false };
}

// ---------------------------------------------------------------------------
// GLB SWAT bot (feat/fps-overhaul): a per-bot SkeletonUtils clone of the
// async-loaded swat_mesh.glb, driven by a THREE.AnimationMixer with the
// idle / run / shoot / death clips. Same return shape as buildSoldierModel
// plus the animation API — main.js branches on `isGlb`.
// ---------------------------------------------------------------------------

// The run clip is authored for roughly this ground speed (m/s); playing it
// at a different bot speed scales timeScale so the feet never slide.
export const BOT_BASE_RUN_SPEED = 3;

const BOT_MODEL_HEIGHT = 1.92; // meters after normalization
const ANIM_FADE_SECONDS = 0.18;
// How long after a shot the shoot pose holds before falling back.
export const SHOOT_ANIM_HOLD_MS = 400;

const TEAM_TINTS = {
  blue: new THREE.Color(0.62, 0.78, 1.35),
  red: new THREE.Color(1.35, 0.62, 0.58),
};

// Scales/positions the SWAT clone so its rendered height matches
// targetHeight with the feet at local y = feetY. Measured from the
// SKELETON's bone world positions, not the geometry bounding box: skinned
// vertices follow the bones (authored in cm-scale armature space), so the
// unskinned bbox wildly misreports the rendered size — this was the
// "100x giant bots" bug.
function fitSkeletonToCapsule(source, targetHeight, feetY) {
  const wrapper = new THREE.Group();
  wrapper.add(source);
  source.updateMatrixWorld(true);

  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let boneCount = 0;
  source.traverse((obj) => {
    if (!obj.isBone) return;
    boneCount += 1;
    obj.getWorldPosition(v);
    min.min(v);
    max.max(v);
  });
  if (boneCount === 0) return wrapper; // no skeleton — leave untouched

  // Bones stop at toe/skull joints, a hair inside the actual mesh surface.
  const skeletonHeight = (max.y - min.y) * 1.04;
  const scale = skeletonHeight > 0.0001 ? targetHeight / skeletonHeight : 1;
  source.scale.multiplyScalar(scale);
  source.position.set(
    -((min.x + max.x) / 2) * scale,
    feetY - min.y * scale,
    -((min.z + max.z) / 2) * scale
  );
  return wrapper;
}

// ---------------------------------------------------------------------------
// Bot-held rifle (feat/fps-overhaul): clones the same rifle.glb used for the
// first-person viewmodel and parents it to the SWAT skeleton's right-hand
// bone, so it inherits the hand's animated position/rotation for free during
// run/shoot/death.
// ---------------------------------------------------------------------------

// TODO: tune these if the gun still looks off after further playtesting —
// e.g. grip depth in the palm, or a slight muzzle pitch/roll to taste. These
// are added ON TOP of the auto-computed base orientation/position below
// (which points the muzzle forward and seats the pistol-grip mesh in the
// hand), not a replacement for it — small nudges only.
// RIFLE_HAND_EXTRA_SCALE is a plain multiplier on the auto-computed
// counter-scale (1 = same real-world size as the first-person viewmodel's
// rifle; >1 bigger, <1 smaller).
const RIFLE_HAND_POSITION_TWEAK = new THREE.Vector3(8, 15, 3);
const RIFLE_HAND_ROTATION_TWEAK = new THREE.Euler(0, 0.18, 0);
const RIFLE_HAND_EXTRA_SCALE = 1;

// The mesh name (case/spacing-insensitive) whose center marks where the
// hand should grip the rifle — used to offset the model so the character
// holds it by the handle instead of by its geometric middle.
const GRIP_MESH_NAME_PATTERN = /pistol.?grip/i;

// Matches bone names across both the raw GLB convention ("mixamorig:RightHand",
// dropped to "mixamorigRightHand" by GLTFLoader's node-name sanitizer) and
// the common alternate rig convention ("Hand_R"). Deliberately anchors the
// pattern so finger joints (e.g. "RightHandThumb1", which also *contains*
// "RightHand") don't match instead of the palm joint itself.
function findRightHandBone(root) {
  let exact = null;
  let fallback = null;
  root.traverse((obj) => {
    if (!obj.isBone || exact) return;
    const name = obj.name;
    if (!name) return;
    if (/^mixamorig:?RightHand$/i.test(name) || /^Hand_R$/i.test(name)) {
      exact = obj;
      return;
    }
    if (
      !fallback &&
      /righthand|hand_r/i.test(name) &&
      !/thumb|index|middle|ring|pinky/i.test(name)
    ) {
      fallback = obj;
    }
  });
  return exact ?? fallback;
}

// Finds the mesh marking the grip (GRIP_MESH_NAME_PATTERN) and returns its
// center, expressed as an offset from rifleScene's own origin in real-world
// meters along rifleScene's OWN (unrotated) local axes — i.e. "how far, and
// in which of the rifle's own directions, the grip sits from the model's
// pivot". Measured via a neutral clone at identity position/rotation (but
// carrying rifleScene's own scale) so the result already accounts for
// normalizeRifleGeometry()'s real-world-length normalization from
// assets.js (applied unconditionally at load time — see there), independent
// of wherever the source object actually lives in the scene graph right
// now. Falls back to (0,0,0) — hold at the model's own pivot — if no grip
// mesh is found, so a naming change degrades gracefully instead of crashing.
function findGripOffset(rifleScene) {
  const probe = rifleScene.clone(true);
  probe.position.set(0, 0, 0);
  probe.rotation.set(0, 0, 0);
  const rig = new THREE.Group();
  rig.add(probe);
  rig.updateMatrixWorld(true);

  let gripMesh = null;
  probe.traverse((obj) => {
    if (!gripMesh && obj.isMesh && GRIP_MESH_NAME_PATTERN.test(obj.name)) {
      gripMesh = obj;
    }
  });
  if (!gripMesh) {
    console.error(
      "findGripOffset: no mesh matching /pistol.?grip/i on rifle.glb — " +
        "holding at the model's own pivot instead"
    );
    return new THREE.Vector3();
  }
  return new THREE.Box3()
    .setFromObject(gripMesh)
    .getCenter(new THREE.Vector3());
}

// Clones rifleScene (loaded and normalized once, unconditionally, in
// assets.js — normalizeRifleGeometry() — so bot weapons never depend on
// whatever the player-facing viewmodel does or doesn't do with rifle.glb)
// and attaches it to this skeleton's right hand, oriented from the hand's
// CURRENT pose (caller must have already posed the skeleton into a natural
// stance — e.g. idle — before calling this; see buildSwatModel()).
// Attaching against the raw T/A-pose bind pose instead (arms spread out to
// the sides) is what produced the original "held sideways, stock up,
// muzzle down" bug: that bind pose has nothing to do with how the hand is
// actually oriented once idle/run/shoot are playing.
//
// Orientation: cancels the hand bone's current world rotation, so the
// rifle's own axes (-Z muzzle, +Y sights-up, per normalizeRifleGeometry()'s
// normalization in assets.js) land on world -Z (character forward) / +Y
// (up) in that reference pose — i.e. "point the barrel forward and keep it
// right-side up", regardless of how the hand bone itself happens to be
// oriented in the rig.
//
// Position: findGripOffset() locates the grip mesh's offset from the
// rifle's own pivot in the rifle's own (unrotated) local axes; rotating
// that by the same cancelling rotation and negating it seats the grip
// exactly at the hand bone's origin instead of the rifle's geometric
// center (the "held from the middle" half of the original bug).
//
// Scale: the clone is parented INSIDE this bot's skeleton, so it inherits
// every ancestor's cumulative scale — not just fitSkeletonToCapsule()'s
// shrink factor on the skeleton root, but also whatever scale the rig's own
// bind pose bakes into intermediate bones (Mixamo/FBX imports commonly do
// this; empirically ~10x here, not the clean 1:1 the root-only factor would
// suggest). Rather than guess at that chain, measure the hand bone's ACTUAL
// world scale directly and counteract exactly that.
function attachRifleToHand(source, assets) {
  if (!assets.rifleScene) return; // rifle.glb failed to load — skip, don't throw
  const handBone = findRightHandBone(source);
  if (!handBone) {
    console.error(
      "attachRifleToHand: no RightHand/Hand_R bone found on the SWAT " +
        "skeleton — bot will be unarmed"
    );
    return;
  }
  source.updateMatrixWorld(true);
  const handWorldScale = handBone.getWorldScale(new THREE.Vector3());
  const handWorldQuat = handBone.getWorldQuaternion(new THREE.Quaternion());

  const rifleClone = assets.rifleScene.clone(true);
  const clonedMaterials = [];
  rifleClone.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false; // bind-pose bbox is stale once bone-attached
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = mats.map((m) => {
      const c = m.clone();
      c.transparent = true; // needed for the spawn-invuln opacity fade
      return c;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
    clonedMaterials.push(...cloned);
  });

  const orientationOffset = handWorldQuat.clone().invert();
  orientationOffset.multiply(
    new THREE.Quaternion().setFromEuler(RIFLE_HAND_ROTATION_TWEAK)
  );

  const gripOffset = findGripOffset(assets.rifleScene);
  const positionOffset = gripOffset
    .clone()
    .applyQuaternion(orientationOffset)
    .negate()
    .add(RIFLE_HAND_POSITION_TWEAK);

  // rifleClone.scale was just copied (via clone(true)) from assets.rifleScene,
  // which already carries the ~real-world-length normalization baked in by
  // normalizeRifleGeometry() in assets.js. MULTIPLY that by the counter-scale
  // (never overwrite it with setScalar) — replacing it would throw away that
  // normalization and apply the counter-scale to the raw, un-normalized
  // mesh instead, which is what produced a multi-hundred-meter rifle here.
  const counterScale =
    handWorldScale.x > 0.0001 ? 1 / handWorldScale.x : 1;
  rifleClone.scale.multiplyScalar(counterScale * RIFLE_HAND_EXTRA_SCALE);
  rifleClone.position.copy(positionOffset);
  rifleClone.quaternion.copy(orientationOffset);
  handBone.add(rifleClone);

  return clonedMaterials;
}

export function buildSwatModel(team, assets) {
  const source = cloneSkeleton(assets.botTemplate);
  // Mixamo characters face +Z; the bot AI treats -Z as forward (matching
  // the procedural soldier), so flip before measuring the skeleton.
  source.rotation.y = Math.PI;

  // Origin at the Rapier capsule CENTER (feet at -1.0), like the old model.
  const inner = fitSkeletonToCapsule(source, BOT_MODEL_HEIGHT, -1.0);
  const group = new THREE.Group();
  group.add(inner);

  // Per-bot material clones: team tint (subtle blue/red push) + transparent
  // for the spawn-invuln fade + emissive for the hit flash.
  const tint = TEAM_TINTS[team] ?? TEAM_TINTS.red;
  const materials = [];
  source.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    // Skinned meshes animate outside their rest-pose bounds; never cull.
    obj.frustumCulled = false;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = mats.map((m) => {
      const c = m.clone();
      c.transparent = true;
      if (c.color) c.color.multiply(tint);
      return c;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
    materials.push(...cloned);
  });

  const mixer = new THREE.AnimationMixer(inner);
  const actions = {};
  for (const name of ["idle", "run", "shoot", "death"]) {
    const clip = assets.botClips?.[name];
    if (clip) actions[name] = mixer.clipAction(clip);
  }
  if (actions.death) {
    actions.death.setLoop(THREE.LoopOnce, 1);
    actions.death.clampWhenFinished = true;
  }

  let currentState = null;
  function fadeTo(name) {
    if (currentState === name) return;
    const next = actions[name];
    if (!next) return;
    const previous = actions[currentState];
    next.reset();
    next.play();
    if (previous) {
      next.crossFadeFrom(previous, ANIM_FADE_SECONDS, false);
    }
    currentState = name;
  }
  fadeTo("idle");
  // Bake the idle clip's first-frame pose onto the skeleton's bones right
  // now (update(0) evaluates the action's current — zero — time without
  // advancing it) BEFORE attaching the rifle. Skipping this would leave the
  // skeleton in its raw T/A-pose bind pose (arms spread to the sides) at
  // attachment time, which has nothing to do with how the hand is actually
  // oriented once idle/run/shoot are playing — that mismatch was the
  // original "held sideways, stock up, muzzle down" bug.
  mixer.update(0);

  // Give the bot a rifle in its hand. MUST run after the body-tint traverse
  // above: the rifle becomes a descendant of `source` via the hand bone,
  // and that traverse's `isMesh` check would otherwise also catch (and
  // team-tint) the rifle's own meshes.
  const rifleMaterials = attachRifleToHand(source, assets);
  if (rifleMaterials) materials.push(...rifleMaterials);

  // Muzzle anchor kept for interface parity with the procedural soldier.
  const muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.position.set(0.05, 0.27, -0.8);
  group.add(muzzleAnchor);

  return {
    group,
    materials,
    headMesh: null,
    muzzleAnchor,
    isGlb: true,
    mixer,

    // Interface parity no-op (the mixer drives the legs instead).
    walk() {},

    update(deltaTime) {
      mixer.update(deltaTime);
    },

    // Locomotion state machine. speedMps only matters while moving —
    // timeScale = speed / base keeps footfalls matched to ground speed.
    setLocomotion(isMoving, speedMps, shotRecently) {
      if (currentState === "death") return;
      if (shotRecently && actions.shoot) {
        fadeTo("shoot");
        return;
      }
      if (isMoving && actions.run) {
        actions.run.timeScale = Math.max(
          0.35,
          speedMps / BOT_BASE_RUN_SPEED
        );
        fadeTo("run");
        return;
      }
      fadeTo("idle");
    },

    // Plays the death clip exactly once and clamps on the final pose.
    playDeath() {
      if (currentState === "death") return;
      if (!actions.death) return;
      fadeTo("death");
    },

    // Back to life on respawn: clear the clamped death pose, restart idle.
    resetAlive() {
      mixer.stopAllAction();
      currentState = null;
      fadeTo("idle");
    },
  };
}
