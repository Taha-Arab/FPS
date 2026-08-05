// ---------------------------------------------------------------------------
// Async asset loading manager (feat/fps-overhaul): loads the rifle viewmodel
// GLB and the SWAT bot mesh + its 4 animation clips through a shared
// THREE.LoadingManager, without blocking the main thread. Results are cached
// so Play Again never re-downloads. Every consumer must tolerate `null`
// (load failure) and fall back to the procedural models.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const RIFLE_URL = "/assets/guns/rifle.glb";
const BOT_MESH_URL = "/assets/bots/swat_mesh.glb";
const BOT_CLIP_URLS = {
  idle: "/assets/bots/idle.glb",
  run: "/assets/bots/run.glb",
  shoot: "/assets/bots/shoot.glb",
  death: "/assets/bots/death.glb",
};

// The idle/run/shoot files were converted through Assimp, which splits one
// Mixamo take into dozens of per-node sub-clips and re-parents each bone's
// FBX transform into "<bone>_$AssimpFbx$_Translation/PreRotation/Rotation"
// pseudo-nodes. The SWAT mesh's real skeleton only has the plain
// "mixamorig:<bone>" nodes, so those tracks must be folded back:
//   - "<bone>_$AssimpFbx$_Translation.position"  -> "<bone>.position"
//   - "<bone>_$AssimpFbx$_Rotation.quaternion"   -> "<bone>.quaternion",
//     with every key premultiplied by the static PreRotation node's
//     quaternion (FBX local rotation = PreRotation * Rotation).
const ASSIMP_MARKER = "_$AssimpFbx$_";

function retargetTrack(track, sceneRoot) {
  const dotIndex = track.name.lastIndexOf(".");
  const nodeName = track.name.slice(0, dotIndex);
  const property = track.name.slice(dotIndex + 1);

  if (!nodeName.includes(ASSIMP_MARKER)) {
    if (property === "scale") return null; // uniform-scale noise, drop it
    return track.clone();
  }

  const [boneName, kind] = nodeName.split(ASSIMP_MARKER);
  if (kind === "Translation" && property === "position") {
    const clone = track.clone();
    clone.name = `${boneName}.position`;
    return clone;
  }
  if (kind === "Rotation" && property === "quaternion") {
    const preNode = sceneRoot.getObjectByName(
      `${boneName}${ASSIMP_MARKER}PreRotation`
    );
    const clone = track.clone();
    clone.name = `${boneName}.quaternion`;
    if (preNode) {
      const pre = preNode.quaternion;
      const key = new THREE.Quaternion();
      for (let i = 0; i < clone.values.length; i += 4) {
        key.fromArray(clone.values, i);
        key.premultiply(pre);
        key.toArray(clone.values, i);
      }
    }
    return clone;
  }
  return null;
}

// The root (Hips) tracks are authored relative to the animation file's own
// scene frame. The SWAT mesh's armature carries a different static rotation
// (FBX Z-up → Y-up baked differently by each converter), so without a
// correction the whole character plays rotated ~90° at the root. This
// computes the rotation between the two parent frames and re-expresses the
// Hips position/quaternion keys in the target skeleton's frame. For the
// native death.glb (identical hierarchy) the correction is identity.
const HIPS_TRACK_PREFIX = "mixamorigHips";

function correctRootFrame(clip, animScene, template) {
  if (!animScene || !template) return clip;
  const templateHips = template.getObjectByName(HIPS_TRACK_PREFIX);
  const animHips = animScene.getObjectByName(HIPS_TRACK_PREFIX);
  if (!templateHips || !animHips) return clip;

  template.updateMatrixWorld(true);
  animScene.updateMatrixWorld(true);

  // The folded track values live in the frame ABOVE the Assimp pseudo-node
  // chain, so climb past it before reading the parent orientation.
  let topOfChain = animHips;
  while (
    topOfChain.parent &&
    topOfChain.parent.name &&
    topOfChain.parent.name.includes(ASSIMP_MARKER)
  ) {
    topOfChain = topOfChain.parent;
  }
  const animFrame = topOfChain.parent ?? animScene;

  const qTemplate = new THREE.Quaternion();
  templateHips.parent.getWorldQuaternion(qTemplate);
  const qAnim = new THREE.Quaternion();
  animFrame.getWorldQuaternion(qAnim);
  // correction maps anim-frame-local values into template-frame-local ones.
  const correction = qTemplate.invert().multiply(qAnim);
  if (correction.angleTo(new THREE.Quaternion()) < 0.01) return clip; // identity

  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (const track of clip.tracks) {
    if (track.name === `${HIPS_TRACK_PREFIX}.position`) {
      for (let i = 0; i < track.values.length; i += 3) {
        v.fromArray(track.values, i).applyQuaternion(correction);
        v.toArray(track.values, i);
      }
    } else if (track.name === `${HIPS_TRACK_PREFIX}.quaternion`) {
      for (let i = 0; i < track.values.length; i += 4) {
        q.fromArray(track.values, i).premultiply(correction);
        q.toArray(track.values, i);
      }
    }
  }
  return clip;
}

// Pins the hips' horizontal translation to its first key so clips with
// baked root motion play in place — actual movement is code-driven.
// upAxisIndex is the dominant axis of the hips' rest offset in its parent
// frame (the SWAT armature is -Z-up at the hips, not Y-up), so "horizontal"
// means the other two axes; the up axis keeps its bounce.
function pinHorizontalRootMotion(clip, upAxisIndex = 1) {
  for (const track of clip.tracks) {
    if (!track.name.endsWith("Hips.position")) continue;
    for (let axis = 0; axis < 3; axis++) {
      if (axis === upAxisIndex) continue;
      const first = track.values[axis];
      for (let i = axis; i < track.values.length; i += 3) {
        track.values[i] = first;
      }
    }
  }
  return clip;
}

// Dominant axis of the template skeleton's hips rest offset — see above.
function hipsUpAxisIndex(template) {
  const hips = template?.getObjectByName(HIPS_TRACK_PREFIX);
  if (!hips) return 1;
  const p = hips.position;
  const abs = [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)];
  return abs.indexOf(Math.max(...abs));
}

// Merges every sub-clip in an animation-only GLB into one usable clip whose
// tracks target the real "mixamorig:" bones.
function extractClip(gltf, name) {
  const clips = gltf.animations ?? [];
  if (clips.length === 0) return null;

  if (clips.length === 1) {
    const clip = clips[0].clone();
    clip.name = name;
    return clip;
  }

  const tracks = [];
  const seen = new Set();
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const retargeted = retargetTrack(track, gltf.scene);
      if (!retargeted || seen.has(retargeted.name)) continue;
      seen.add(retargeted.name);
      tracks.push(retargeted);
    }
  }
  if (tracks.length === 0) return null;

  let duration = 0;
  for (const track of tracks) {
    duration = Math.max(duration, track.times[track.times.length - 1]);
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

// Normalizes an arbitrary loaded model: wraps it in a group scaled so its
// bounding-box height equals targetHeight, with the feet (bbox bottom)
// sitting at local y = feetY. Returns the wrapper group.
export function normalizeModelHeight(object, targetHeight, feetY) {
  const bbox = new THREE.Box3().setFromObject(object);
  const size = bbox.getSize(new THREE.Vector3());
  const scale = size.y > 0.0001 ? targetHeight / size.y : 1;
  const wrapper = new THREE.Group();
  wrapper.add(object);
  object.scale.multiplyScalar(scale);
  object.position.set(
    -((bbox.min.x + bbox.max.x) / 2) * scale,
    feetY - bbox.min.y * scale,
    -((bbox.min.z + bbox.max.z) / 2) * scale
  );
  return wrapper;
}

// Module-level cache: one load per page life, shared by every match.
let loadPromise = null;

// Loads everything. Resolves to:
//   { rifleScene, botTemplate, botClips: { idle, run, shoot, death } }
// Any piece that failed to load resolves as null in that slot instead of
// rejecting the whole bundle, so the game can fall back per-feature.
export function loadGameAssets(onProgress = null) {
  if (loadPromise) return loadPromise;

  const manager = new THREE.LoadingManager();
  if (onProgress) {
    manager.onProgress = (_url, loaded, total) => onProgress(loaded, total);
  }
  const loader = new GLTFLoader(manager);

  const loadOne = (url) =>
    new Promise((resolve) => {
      loader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (error) => {
          console.error(`Asset load failed: ${url}`, error);
          resolve(null);
        }
      );
    });

  loadPromise = Promise.all([
    loadOne(RIFLE_URL),
    loadOne(BOT_MESH_URL),
    loadOne(BOT_CLIP_URLS.idle),
    loadOne(BOT_CLIP_URLS.run),
    loadOne(BOT_CLIP_URLS.shoot),
    loadOne(BOT_CLIP_URLS.death),
  ]).then(([rifle, botMesh, idle, run, shoot, death]) => {
    const template = botMesh ? botMesh.scene : null;
    const upAxis = hipsUpAxisIndex(template);
    // Extract → re-express the root in the target skeleton's frame → pin
    // horizontal root motion (in that frame). death.glb ships the full mesh
    // again; only its clip is kept.
    const prepare = (gltf, name) => {
      if (!gltf) return null;
      const clip = extractClip(gltf, name);
      if (!clip) return null;
      correctRootFrame(clip, gltf.scene, template);
      return pinHorizontalRootMotion(clip, upAxis);
    };
    const botClips = {
      idle: prepare(idle, "idle"),
      run: prepare(run, "run"),
      shoot: prepare(shoot, "shoot"),
      death: prepare(death, "death"),
    };
    return {
      rifleScene: rifle ? rifle.scene : null,
      botTemplate: template,
      botClips,
    };
  });

  return loadPromise;
}
