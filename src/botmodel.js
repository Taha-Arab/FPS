// ---------------------------------------------------------------------------
// Humanoid soldier model (modern-overhaul): replaces the debug capsules.
// Built from primitives + a procedural camo texture, sized to fit inside the
// existing Rapier capsule collider (total height 2.0m, origin at the capsule
// CENTER, i.e. 1.0m above the feet). Includes a simple walk cycle.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { createCamoTexture } from "./textures.js";
import { normalizeModelHeight } from "./assets.js";

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

export function buildSwatModel(team, assets) {
  const source = cloneSkeleton(assets.botTemplate);
  // Mixamo characters face +Z; the bot AI treats -Z as forward (matching
  // the procedural soldier), so flip before measuring the bounding box.
  source.rotation.y = Math.PI;

  // Origin at the Rapier capsule CENTER (feet at -1.0), like the old model.
  const inner = normalizeModelHeight(source, BOT_MODEL_HEIGHT, -1.0);
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
