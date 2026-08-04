// ---------------------------------------------------------------------------
// First-person weapon viewmodel (modern-overhaul): a procedural low-poly
// assault rifle parented to the camera, with hip/ADS pose blending, walk
// bob, mouse sway, recoil kick-back and a muzzle flash. Purely visual —
// hit detection stays the camera-center raycast in main.js.
// ---------------------------------------------------------------------------

import * as THREE from "three";

// Poses in camera-local space (+X right, +Y up, -Z forward).
const HIP_POSITION = new THREE.Vector3(0.22, -0.2, -0.42);
const HIP_ROTATION = new THREE.Euler(0, -0.06, 0.02);
const ADS_POSITION = new THREE.Vector3(0, -0.116, -0.3);
const ADS_ROTATION = new THREE.Euler(0, 0, 0);
const SPRINT_POSITION = new THREE.Vector3(0.16, -0.26, -0.4);
const SPRINT_ROTATION = new THREE.Euler(-0.5, 0.5, 0.15);

const ADS_LERP_PER_SECOND = 14; // how fast the pose blends
const BOB_FREQUENCY = 8.5; // steps per second-ish
const BOB_AMOUNT = 0.009;
const SPRINT_BOB_MULT = 2.0;
const SWAY_AMOUNT = 0.0016;
const SWAY_MAX = 0.035;
const RECOIL_KICK_BACK = 0.05;
const RECOIL_KICK_UP = 0.035;
const RECOIL_RECOVERY_PER_SECOND = 12;
const MUZZLE_FLASH_MS = 45;

function metal(color, roughness = 0.55, metalness = 0.65) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

// Builds the rifle mesh. Returns { rifle, muzzleTip } — muzzleTip is an
// Object3D at the barrel exit for the flash + tracer start point.
function buildRifleMesh() {
  const rifle = new THREE.Group();

  const bodyMat = metal(0x2b2d30, 0.5, 0.75); // dark receiver
  const accentMat = metal(0x3a3d42, 0.6, 0.6); // polymer furniture
  const barrelMat = metal(0x1e2022, 0.35, 0.9);

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    rifle.add(m);
    return m;
  }

  // Receiver (main body).
  box(0.055, 0.07, 0.34, bodyMat, 0, 0, -0.05);
  // Handguard with rail bumps.
  box(0.05, 0.055, 0.26, accentMat, 0, -0.004, -0.33);
  for (let i = 0; i < 5; i++) {
    box(0.052, 0.008, 0.02, bodyMat, 0, 0.032, -0.24 - i * 0.05);
  }
  // Barrel.
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.011, 0.2, 10),
    barrelMat
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.005, -0.53);
  rifle.add(barrel);
  // Flash hider.
  const hider = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.015, 0.05, 10),
    barrelMat
  );
  hider.rotation.x = Math.PI / 2;
  hider.position.set(0, 0.005, -0.615);
  rifle.add(hider);
  // Stock.
  box(0.045, 0.062, 0.16, accentMat, 0, -0.006, 0.18);
  box(0.05, 0.085, 0.035, accentMat, 0, -0.012, 0.265);
  // Pistol grip (angled).
  const grip = box(0.038, 0.1, 0.045, accentMat, 0, -0.075, 0.075);
  grip.rotation.x = 0.35;
  // Magazine (curved-ish: two angled segments).
  const mag1 = box(0.04, 0.1, 0.055, bodyMat, 0, -0.085, -0.06);
  mag1.rotation.x = 0.12;
  const mag2 = box(0.038, 0.08, 0.05, bodyMat, 0, -0.155, -0.045);
  mag2.rotation.x = 0.35;
  // Rear sight: two posts with a gap the player aims through at ADS.
  box(0.008, 0.03, 0.012, bodyMat, -0.014, 0.055, 0.06);
  box(0.008, 0.03, 0.012, bodyMat, 0.014, 0.055, 0.06);
  // Front sight post.
  box(0.006, 0.035, 0.01, bodyMat, 0, 0.052, -0.44);

  // Muzzle tip anchor for flash + visual tracer origin.
  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0, 0.005, -0.645);
  rifle.add(muzzleTip);

  // Viewmodels shouldn't cast big fake shadows onto the world.
  rifle.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });

  return { rifle, muzzleTip };
}

// Creates the viewmodel and returns a controller object used by main.js.
export function createWeaponViewmodel(camera) {
  const root = new THREE.Group(); // pose blend target
  const swayGroup = new THREE.Group(); // mouse sway / bob layer
  const { rifle, muzzleTip } = buildRifleMesh();
  swayGroup.add(rifle);
  root.add(swayGroup);
  camera.add(root);

  root.position.copy(HIP_POSITION);
  root.rotation.copy(HIP_ROTATION);

  // Muzzle flash: a small glowing plane cross + point light at the tip.
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd977,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flashGeo = new THREE.PlaneGeometry(0.14, 0.14);
  const flashA = new THREE.Mesh(flashGeo, flashMat);
  const flashB = new THREE.Mesh(flashGeo, flashMat);
  flashB.rotation.z = Math.PI / 4;
  const flashGroup = new THREE.Group();
  flashGroup.add(flashA, flashB);
  flashGroup.visible = false;
  muzzleTip.add(flashGroup);

  const flashLight = new THREE.PointLight(0xffc36b, 0, 6, 2);
  muzzleTip.add(flashLight);

  let flashHideAt = 0;

  let adsBlend = 0; // 0 = hip, 1 = aiming down sights
  let sprintBlend = 0;
  let bobPhase = 0;
  let recoilZ = 0;
  let recoilPitch = 0;
  const swayTarget = new THREE.Vector2();

  const tmpPos = new THREE.Vector3();
  const tmpRotA = new THREE.Quaternion();
  const tmpRotB = new THREE.Quaternion();
  const hipQuat = new THREE.Quaternion().setFromEuler(HIP_ROTATION);
  const adsQuat = new THREE.Quaternion().setFromEuler(ADS_ROTATION);
  const sprintQuat = new THREE.Quaternion().setFromEuler(SPRINT_ROTATION);

  return {
    muzzleTip,

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

    triggerRecoil() {
      recoilZ += RECOIL_KICK_BACK;
      recoilPitch += RECOIL_KICK_UP;
      flashGroup.visible = true;
      flashGroup.rotation.z = Math.random() * Math.PI;
      const scale = 0.8 + Math.random() * 0.5;
      flashGroup.scale.setScalar(scale);
      flashLight.intensity = 14;
      flashHideAt = performance.now() + MUZZLE_FLASH_MS;
    },

    getAdsBlend() {
      return adsBlend;
    },

    // state: { wantAds, sprinting, moveSpeed01, grounded }
    update(deltaTime, state) {
      const adsTarget = state.wantAds && !state.sprinting ? 1 : 0;
      const lerpStep = 1 - Math.exp(-ADS_LERP_PER_SECOND * deltaTime);
      adsBlend += (adsTarget - adsBlend) * lerpStep;
      sprintBlend += ((state.sprinting ? 1 : 0) - sprintBlend) * lerpStep;

      // Pose: hip → ads, then hip-side poses blend toward sprint carry.
      tmpPos.lerpVectors(HIP_POSITION, ADS_POSITION, adsBlend);
      tmpRotA.slerpQuaternions(hipQuat, adsQuat, adsBlend);
      if (sprintBlend > 0.001) {
        tmpPos.lerp(SPRINT_POSITION, sprintBlend * (1 - adsBlend));
        tmpRotB.copy(tmpRotA).slerp(sprintQuat, sprintBlend * (1 - adsBlend));
        tmpRotA.copy(tmpRotB);
      }

      // Recoil: pull the gun back and tilt up briefly.
      const recoilDecay = Math.exp(-RECOIL_RECOVERY_PER_SECOND * deltaTime);
      recoilZ *= recoilDecay;
      recoilPitch *= recoilDecay;
      tmpPos.z += recoilZ * (1 - adsBlend * 0.4);

      root.position.copy(tmpPos);
      root.quaternion.copy(tmpRotA);
      root.rotation.x += recoilPitch;

      // Walk bob (reduced hard when aiming).
      const bobStrength =
        state.moveSpeed01 *
        (state.grounded ? 1 : 0.2) *
        (1 - adsBlend * 0.85) *
        (state.sprinting ? SPRINT_BOB_MULT : 1);
      bobPhase +=
        deltaTime * BOB_FREQUENCY * (state.sprinting ? 1.35 : 1) *
        Math.max(state.moveSpeed01, 0.001);
      const bobX = Math.sin(bobPhase) * BOB_AMOUNT * bobStrength;
      const bobY = -Math.abs(Math.cos(bobPhase)) * BOB_AMOUNT * 1.4 * bobStrength;

      // Mouse sway eases back to center; damped harder during ADS.
      const swayEase = 1 - Math.exp(-10 * deltaTime);
      swayGroup.position.x +=
        (swayTarget.x * (1 - adsBlend * 0.8) + bobX - swayGroup.position.x) *
        swayEase;
      swayGroup.position.y +=
        (swayTarget.y * (1 - adsBlend * 0.8) + bobY - swayGroup.position.y) *
        swayEase;
      swayTarget.multiplyScalar(Math.exp(-6 * deltaTime));

      // Muzzle flash timeout.
      if (flashGroup.visible && performance.now() >= flashHideAt) {
        flashGroup.visible = false;
        flashLight.intensity = 0;
      }
    },
  };
}
