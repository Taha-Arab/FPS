// ---------------------------------------------------------------------------
// First-person player arms viewmodel (feat/player-arms): a fully animated
// arms+gun model (public/assets/player/player_arms.glb) parented to the
// camera, replacing the old static-rifle viewmodel from weapon.js.
//
// rifle.glb (weapon.js's former subject) is untouched and still loads in
// the background via assets.js — enemy/ally bots still clone it for their
// held weapon (see attachRifleToHand() in botmodel.js). This module has
// nothing to do with that; it's the LOCAL PLAYER's own view only.
// ---------------------------------------------------------------------------

import * as THREE from "three";

// TODO: tune these to line the gun up with the crosshair. Position is in
// camera-local space (+X right, +Y up, -Z forward); rotation is Euler
// radians. Both are layered ON TOP of the model's built-in camera-bone
// alignment (see setArmsModel() below) — that alignment already puts the
// rig's own "eye" reference roughly at the camera's origin, so (0,0,0) here
// is a reasonable starting point, not the model's raw/unprocessed
// coordinates. Get HIP_* framed nicely in the corner first, then tune ADS_*
// so the sights line up dead-center with the crosshair.
const HIP_POSITION = new THREE.Vector3(0.12, -0.15, 0.05);
const HIP_ROTATION = new THREE.Euler(0, 0, 0);
const ADS_POSITION = new THREE.Vector3(0, -0.05, 0.18);
const ADS_ROTATION = new THREE.Euler(0, 0, 0);

// TODO: nudge to match the gun barrel's actual on-screen tip once HIP_* is
// dialed in above — this drives the tracer/muzzle-flash origin in main.js.
// player_arms.glb has no named muzzle bone to anchor to (unlike the bots'
// rifle-grip attachment), so it's a flat offset in camera-local space, same
// approach main.js already uses for the bots' own muzzle origin.
const MUZZLE_TIP_OFFSET = new THREE.Vector3(0.05, -0.05, -0.6);

const ADS_LERP_PER_SECOND = 14; // how fast the hip/ADS pose blends
const SWAY_AMOUNT = 0.0016;
const SWAY_MAX = 0.035;
const LOCOMOTION_FADE_SECONDS = 0.2;
const ONE_SHOT_FADE_SECONDS = 0.08;

// Maps each locomotion/action slot to a pattern matched against this GLB's
// own animation names ("Armature|Idle", "Armature|Shoot", etc.) rather than
// a hardcoded array index. The brief that produced this file specified
// indices 2-6 for Idle/Shoot/Reload/Walk/Run, but this asset's actual
// gltf.animations array is [0:Take, 1:Idle, 2:Shoot, 3:Reload, 4:Walk,
// 5:Run, 6:Hide] — every one of those indices is off by one from what was
// asked for (and 6 isn't Run, it's an unrelated "Hide" clip). Matching by
// name lands on the exact same 5 clips that were intended and is immune to
// the export ever reordering them again.
const CLIP_NAME_PATTERNS = {
  idle: /idle/i,
  shoot: /shoot/i,
  reload: /reload/i,
  walk: /walk/i,
  run: /run/i,
};

// Creates the viewmodel and returns a controller object used by main.js.
export function createPlayerArms(camera) {
  const root = new THREE.Group(); // hip/ADS pose blend target
  const swayGroup = new THREE.Group(); // mouse-look sway layer
  root.add(swayGroup);
  camera.add(root);

  root.position.copy(HIP_POSITION);
  root.rotation.copy(HIP_ROTATION);

  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.copy(MUZZLE_TIP_OFFSET);
  root.add(muzzleTip);

  let mixer = null;
  const actions = {};
  let currentAction = null;
  let activeOneShot = null; // the specific one-shot action we're waiting on

  let adsBlend = 0; // 0 = hip, 1 = aiming down sights
  const swayTarget = new THREE.Vector2();
  const hipQuat = new THREE.Quaternion().setFromEuler(HIP_ROTATION);
  const adsQuat = new THREE.Quaternion().setFromEuler(ADS_ROTATION);
  const tmpPos = new THREE.Vector3();
  const tmpRot = new THREE.Quaternion();

  // Crossfades into a LOOPING action (idle/walk/run). No-ops if it's
  // already the current action — restarting a loop every frame would pop.
  function crossFadeTo(action, fadeSeconds) {
    if (!action || currentAction === action) return;
    action.reset().play();
    if (currentAction) action.crossFadeFrom(currentAction, fadeSeconds, false);
    currentAction = action;
  }

  // Plays a ONE-SHOT action (shoot/reload) once through, then — once the
  // mixer's "finished" event fires for it — hands control back to whatever
  // the normal per-frame locomotion state resolves to (see update() below).
  // Re-triggering the SAME one-shot while it's already playing (e.g.
  // full-auto fire) restarts it from frame 0 instead of crossfading, so
  // rapid shots don't blend into a smeared half-played animation.
  function playOneShot(action) {
    if (!action) return;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    const isRestart = currentAction === action;
    action.reset().play();
    if (!isRestart && currentAction) {
      action.crossFadeFrom(currentAction, ONE_SHOT_FADE_SECONDS, false);
    }
    currentAction = action;
    activeOneShot = action;
  }

  return {
    muzzleTip,

    // Swaps in the async-loaded player_arms.glb. Safe to call once, any
    // time — renders as an empty (invisible) group until then.
    setArmsModel(scene, animations) {
      if (!scene) return;

      if (animations && animations.length > 0) {
        mixer = new THREE.AnimationMixer(scene);
        for (const [key, pattern] of Object.entries(CLIP_NAME_PATTERNS)) {
          const clip = animations.find((c) => pattern.test(c.name));
          if (clip) {
            actions[key] = mixer.clipAction(clip);
          } else {
            console.error(
              `createPlayerArms: no animation clip matching ${pattern} on ` +
                `player_arms.glb — "${key}" will be a no-op`
            );
          }
        }
        mixer.addEventListener("finished", (event) => {
          if (event.action === activeOneShot) activeOneShot = null;
        });
        // Settle into the idle pose now (update(0) evaluates time-zero
        // without advancing it) so the camera-bone alignment below measures
        // the actual resting stance, not the raw T/A-pose bind pose.
        if (actions.idle) {
          actions.idle.play();
          currentAction = actions.idle;
          mixer.update(0);
        }
      }

      // The rig's own "camera_01" bone marks where its author intended the
      // camera to sit; aligning that bone to this group's local origin
      // means (0,0,0) + small HIP_POSITION tweaks is a sane starting point
      // instead of needing to reverse-engineer the raw mesh's coordinates.
      // Confirmed empirically (not guessed): without the accompanying 180°
      // yaw, the gun renders directly BEHIND the camera — this rig's
      // forward convention is the opposite of Three.js's camera (-Z-forward).
      scene.updateMatrixWorld(true);
      const cameraBone = scene.getObjectByName("camera_01");
      if (cameraBone) {
        const camBoneWorld = cameraBone.getWorldPosition(new THREE.Vector3());
        scene.position.sub(camBoneWorld);
      } else {
        console.error(
          "createPlayerArms: no camera_01 bone found on player_arms.glb — " +
            "skipping the auto camera-alignment offset, expect a larger " +
            "manual HIP_POSITION/HIP_ROTATION correction than usual"
        );
      }
      const wrapper = new THREE.Group();
      wrapper.add(scene);
      wrapper.rotation.y = Math.PI;
      swayGroup.add(wrapper);

      scene.traverse((obj) => {
        if (obj.isMesh || obj.isSkinnedMesh) {
          obj.castShadow = false;
          obj.receiveShadow = false;
          // Skinned bounds go stale relative to the bind-pose bbox once
          // animated; never let that cull the viewmodel.
          obj.frustumCulled = false;
        }
      });
    },

    // Call from the mousemove handler with raw movementX/Y.
    addLookSway(movementX, movementY) {
      swayTarget.x = THREE.MathUtils.clamp(
        swayTarget.x - movementX * SWAY_AMOUNT,
        -SWAY_MAX,
        SWAY_MAX
      );
      swayTarget.y = THREE.MathUtils.clamp(
        swayTarget.y + movementY * SWAY_AMOUNT,
        -SWAY_MAX,
        SWAY_MAX
      );
    },

    // Plays the Shoot clip once, restarting it on every call (full-auto
    // fire keeps re-triggering this every shot).
    fire() {
      playOneShot(actions.shoot);
    },

    // Plays the Reload clip once. Call from startReload() in main.js, which
    // already covers both the manual R key and auto-reload-on-empty-mag —
    // no separate wiring needed for either trigger.
    reload() {
      playOneShot(actions.reload);
    },

    getAdsBlend() {
      return adsBlend;
    },

    // state: { wantAds, sprinting, moveSpeed01 }
    update(deltaTime, state) {
      const adsTarget = state.wantAds && !state.sprinting ? 1 : 0;
      const lerpStep = 1 - Math.exp(-ADS_LERP_PER_SECOND * deltaTime);
      adsBlend += (adsTarget - adsBlend) * lerpStep;

      // Hip -> ADS lerp, per the brief: smoothly blend position/rotation
      // from the default hip-fire pose to the centered aimed pose. (FOV
      // reduction during ADS is handled generically in main.js's tick() —
      // camera.fov isn't owned by any one viewmodel — so it isn't
      // duplicated here.)
      tmpPos.lerpVectors(HIP_POSITION, ADS_POSITION, adsBlend);
      tmpRot.slerpQuaternions(hipQuat, adsQuat, adsBlend);
      root.position.copy(tmpPos);
      root.quaternion.copy(tmpRot);

      // Mouse sway eases back to center; damped harder during ADS.
      const swayEase = 1 - Math.exp(-10 * deltaTime);
      swayGroup.position.x +=
        (swayTarget.x * (1 - adsBlend * 0.8) - swayGroup.position.x) *
        swayEase;
      swayGroup.position.y +=
        (swayTarget.y * (1 - adsBlend * 0.8) - swayGroup.position.y) *
        swayEase;
      swayTarget.multiplyScalar(Math.exp(-6 * deltaTime));

      if (!mixer) return;
      mixer.update(deltaTime);

      // Locomotion (idle/walk/run) only drives while no one-shot
      // (shoot/reload) is currently playing. Once the one-shot's mixer
      // "finished" event clears activeOneShot, this resumes on its own —
      // landing on idle if the player has since stopped moving (satisfying
      // "then return to idle" for the common case) or continuing
      // walk/run if they kept moving while firing/reloading, rather than
      // forcing a jarring snap-to-idle either way.
      if (activeOneShot) return;
      if (state.sprinting && actions.run) {
        crossFadeTo(actions.run, LOCOMOTION_FADE_SECONDS);
      } else if (state.moveSpeed01 > 0 && actions.walk) {
        crossFadeTo(actions.walk, LOCOMOTION_FADE_SECONDS);
      } else if (actions.idle) {
        crossFadeTo(actions.idle, LOCOMOTION_FADE_SECONDS);
      }
    },
  };
}
