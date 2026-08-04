// ---------------------------------------------------------------------------
// Visual prop composer (modern-overhaul v2).
//
// The gameplay layout lives in main.js as plain box/pillar/ramp defs that
// drive BOTH the Rapier colliders and (previously) plain box meshes. This
// module keeps those defs (and therefore all collision/AI/minimap behavior)
// untouched, but builds rich prop visuals inside each def's footprint:
//   tall thin walls  → concrete T-wall (blast wall) panel rows
//   low wide covers  → stacked sandbag emplacements
//   crate-ish boxes  → detailed shipping containers (doors, posts, ribs)
//   pillars          → banded concrete columns with plinth + cap
//   ramps/decks      → plated steel with edge rails / perimeter railings
// Every builder returns a THREE.Group positioned so it fills the same
// envelope as the collider box.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import {
  createConcreteTexture,
  createContainerTexture,
  createMetalDeckTexture,
  createBarrierTexture,
  createSandbagTexture,
} from "./textures.js";

// Deterministic per-arena RNG so prop variation is stable between loads.
let seed = 99;
function rand() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}
export function resetPropRandom() {
  seed = 99;
}

// --- Shared materials (lazy singletons) -----------------------------------

let mats = null;
function getMats() {
  if (mats) return mats;

  const concrete = createConcreteTexture(1.2, 1);
  const barrier = createBarrierTexture(1);
  const deck = createMetalDeckTexture(1.5, 1.5);
  const sandbag = createSandbagTexture();

  const containerPalettes = ["#5b6e58", "#6e5348", "#4e5c6e", "#71685a"];
  const containerMats = containerPalettes.map((color) => {
    const tex = createContainerTexture(color, 1.5, 1);
    return new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.6,
      metalness: 0.35,
    });
  });

  mats = {
    concrete: new THREE.MeshStandardMaterial({
      map: concrete.map,
      normalMap: concrete.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.92,
      metalness: 0.0,
    }),
    barrier: new THREE.MeshStandardMaterial({
      map: barrier.map,
      normalMap: barrier.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.9,
      metalness: 0.0,
    }),
    deck: new THREE.MeshStandardMaterial({
      map: deck.map,
      normalMap: deck.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.55,
      metalness: 0.5,
    }),
    sandbag: new THREE.MeshStandardMaterial({
      map: sandbag.map,
      normalMap: sandbag.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.95,
      metalness: 0.0,
    }),
    darkSteel: new THREE.MeshStandardMaterial({
      color: 0x3c4046,
      roughness: 0.5,
      metalness: 0.7,
    }),
    rustSteel: new THREE.MeshStandardMaterial({
      color: 0x6e4a35,
      roughness: 0.8,
      metalness: 0.4,
    }),
    lampGlow: new THREE.MeshBasicMaterial({ color: 0xffe9b8 }),
    containerMats,
  };
  return mats;
}

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function box(group, w, h, d, mat, x, y, z, ry = 0) {
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  mesh.position.set(x, y, z);
  if (ry) mesh.rotation.y = ry;
  group.add(mesh);
  return mesh;
}

// --- Blast wall (concrete T-wall) row -------------------------------------
// For tall, thin box defs. Panels run along the def's long axis.

function buildBlastWall(def) {
  const m = getMats();
  const group = new THREE.Group();
  const alongX = def.hx >= def.hz;
  const halfLength = alongX ? def.hx : def.hz;
  const thickness = (alongX ? def.hz : def.hx) * 2;
  const height = def.hy * 2;

  const panelWidth = 1.05;
  const count = Math.max(1, Math.round((halfLength * 2) / panelWidth));
  const actualWidth = (halfLength * 2) / count;

  for (let i = 0; i < count; i++) {
    const offset = -halfLength + actualWidth * (i + 0.5);
    const jitterH = height * (0.97 + rand() * 0.05);
    const panel = new THREE.Group();

    // Upright slab (slightly narrower than the slot so seams show).
    const slabW = actualWidth * 0.94;
    const slab = shadowed(
      new THREE.Mesh(
        new THREE.BoxGeometry(slabW, jitterH * 0.82, thickness * 0.55),
        m.concrete
      )
    );
    slab.position.y = jitterH * 0.18 + (jitterH * 0.82) / 2;
    panel.add(slab);

    // Tapered base: wider footing wedge.
    const base = shadowed(
      new THREE.Mesh(
        new THREE.BoxGeometry(slabW, jitterH * 0.2, thickness),
        m.concrete
      )
    );
    base.position.y = jitterH * 0.1;
    panel.add(base);
    const mid = shadowed(
      new THREE.Mesh(
        new THREE.BoxGeometry(slabW, jitterH * 0.16, thickness * 0.78),
        m.concrete
      )
    );
    mid.position.y = jitterH * 0.26;
    panel.add(mid);

    // Small cap lip.
    const cap = shadowed(
      new THREE.Mesh(
        new THREE.BoxGeometry(slabW, jitterH * 0.05, thickness * 0.62),
        m.concrete
      )
    );
    cap.position.y = jitterH * 0.995;
    panel.add(cap);

    panel.rotation.y = (rand() - 0.5) * 0.03;
    if (alongX) panel.position.x = offset;
    else {
      panel.position.z = offset;
      panel.rotation.y += Math.PI / 2;
    }
    group.add(panel);
  }

  group.position.set(def.x, 0, def.z);
  return group;
}

// --- Sandbag emplacement ---------------------------------------------------
// For low box defs: rows of stacked bags along the long axis.

function buildSandbagWall(def) {
  const m = getMats();
  const group = new THREE.Group();
  const alongX = def.hx >= def.hz;
  const halfLength = alongX ? def.hx : def.hz;
  const depth = (alongX ? def.hz : def.hx) * 2;
  const height = def.hy * 2;

  const bagLength = 0.52;
  const bagRadius = Math.min(0.16, depth * 0.35);
  const layers = Math.max(2, Math.round(height / (bagRadius * 1.7)));
  const perRow = Math.max(1, Math.round((halfLength * 2) / bagLength));
  const bagGeo = new THREE.CapsuleGeometry(bagRadius, bagLength * 0.62, 3, 8);

  for (let layer = 0; layer < layers; layer++) {
    const y = bagRadius + layer * bagRadius * 1.55;
    const stagger = (layer % 2) * bagLength * 0.5;
    for (let i = 0; i < perRow; i++) {
      const offset =
        -halfLength + bagLength * (i + 0.5) + stagger - bagLength * 0.25;
      if (offset < -halfLength || offset > halfLength) continue;
      const bag = shadowed(new THREE.Mesh(bagGeo, m.sandbag));
      bag.rotation.z = Math.PI / 2;
      bag.rotation.y = (rand() - 0.5) * 0.25;
      bag.scale.y = 0.75; // squashed under weight
      if (alongX) bag.position.set(offset, y, (rand() - 0.5) * depth * 0.2);
      else {
        bag.position.set((rand() - 0.5) * depth * 0.2, y, offset);
        bag.rotation.y += Math.PI / 2;
      }
      group.add(bag);
    }
  }

  group.position.set(def.x, 0, def.z);
  return group;
}

// --- Shipping container ----------------------------------------------------

function buildContainer(def) {
  const m = getMats();
  const group = new THREE.Group();
  const mat = m.containerMats[Math.floor(rand() * m.containerMats.length)];
  const w = def.hx * 2;
  const h = def.hy * 2;
  const d = def.hz * 2;

  // Main corrugated body, inset slightly behind the corner posts.
  box(group, w * 0.96, h * 0.96, d * 0.96, mat, 0, h / 2, 0);

  // Corner posts + top/bottom rails.
  const postSize = Math.min(0.09, w * 0.08, d * 0.08);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(
        group,
        postSize,
        h,
        postSize,
        m.darkSteel,
        sx * (w / 2 - postSize / 2),
        h / 2,
        sz * (d / 2 - postSize / 2)
      );
    }
  }
  for (const sy of [0.03, 0.97]) {
    box(group, w, postSize * 0.8, postSize * 0.8, m.darkSteel, 0, h * sy, d / 2 - postSize / 2);
    box(group, w, postSize * 0.8, postSize * 0.8, m.darkSteel, 0, h * sy, -(d / 2 - postSize / 2));
  }

  // Door end (on the +X or -X short side, whichever is shorter): two door
  // panels + lock rods.
  const doorOnX = w <= d;
  const faceW = doorOnX ? d : w;
  const rodGeo = new THREE.CylinderGeometry(0.018, 0.018, h * 0.85, 6);
  const doorGroup = new THREE.Group();
  for (const side of [-1, 1]) {
    const rod = shadowed(new THREE.Mesh(rodGeo, m.darkSteel));
    rod.position.set(side * faceW * 0.2, h / 2, 0.03);
    doorGroup.add(rod);
  }
  if (doorOnX) {
    doorGroup.rotation.y = Math.PI / 2;
    doorGroup.position.x = w / 2;
  } else {
    doorGroup.position.z = d / 2;
  }
  group.add(doorGroup);

  group.rotation.y = (rand() - 0.5) * 0.04; // slight settle
  group.position.set(def.x, 0, def.z);
  return group;
}

// --- Concrete column (pillar defs) ----------------------------------------

export function buildColumnProp(def) {
  const m = getMats();
  const group = new THREE.Group();

  const shaft = shadowed(
    new THREE.Mesh(
      new THREE.CylinderGeometry(def.radius * 0.92, def.radius * 0.98, def.height, 14),
      m.barrier
    )
  );
  shaft.position.y = def.height / 2;
  group.add(shaft);

  // Plinth + cap.
  const plinth = shadowed(
    new THREE.Mesh(
      new THREE.CylinderGeometry(def.radius * 1.12, def.radius * 1.2, def.height * 0.1, 14),
      m.concrete
    )
  );
  plinth.position.y = def.height * 0.05;
  group.add(plinth);
  const cap = shadowed(
    new THREE.Mesh(
      new THREE.CylinderGeometry(def.radius * 1.1, def.radius * 0.95, def.height * 0.07, 14),
      m.concrete
    )
  );
  cap.position.y = def.height * 0.965;
  group.add(cap);

  group.position.set(def.x, 0, def.z);
  return group;
}

// --- Box cover dispatcher --------------------------------------------------

export function buildBoxCoverProp(def) {
  const thin = Math.min(def.hx, def.hz) <= 0.7;
  if (def.hy >= 1.0 && thin) return buildBlastWall(def);
  if (def.hy <= 0.6) return buildSandbagWall(def);
  return buildContainer(def);
}

// --- Plated ramp with side rails ------------------------------------------
// Used for both ground ramps and elevated ramp pieces. The visual plate
// matches the collider box; rails ride the top face's long edges.

export function buildRampProp(def, y, tiltRadians) {
  const m = getMats();
  const group = new THREE.Group();

  box(group, def.hx * 2, def.hy * 2, def.hz * 2, m.deck, 0, 0, 0);

  const railH = 0.05;
  for (const side of [-1, 1]) {
    box(
      group,
      0.06,
      railH * 2,
      def.hz * 2,
      m.darkSteel,
      side * (def.hx - 0.04),
      def.hy + railH,
      0
    );
  }

  group.position.set(def.x, y, def.z);
  group.rotation.x = tiltRadians;
  return group;
}

// --- Elevated deck / leg pieces -------------------------------------------

export function buildDeckProp(piece) {
  const m = getMats();
  const group = new THREE.Group();

  box(group, piece.hx * 2, piece.hy * 2, piece.hz * 2, m.deck, 0, 0, 0);

  // Perimeter railing on the two X-side edges (Z edges stay open for ramp
  // access) — posts + a top rail. Rail height stays below jump clearance
  // and has no collider, so movement is unchanged.
  const railHeight = 0.42;
  for (const side of [-1, 1]) {
    const xEdge = side * (piece.hx - 0.05);
    box(group, 0.05, 0.05, piece.hz * 2, m.darkSteel, xEdge, piece.hy + railHeight, 0);
    const postCount = Math.max(2, Math.round(piece.hz / 0.7) + 1);
    for (let i = 0; i < postCount; i++) {
      const z = -piece.hz + (piece.hz * 2 * i) / (postCount - 1);
      box(group, 0.04, railHeight, 0.04, m.darkSteel, xEdge, piece.hy + railHeight / 2, z * 0.92);
    }
  }

  group.position.set(piece.x, piece.y, piece.z);
  return group;
}

export function buildLegProp(piece) {
  const m = getMats();
  const group = new THREE.Group();
  // Steel column with a wider foot plate.
  box(group, piece.hx * 2, piece.hy * 2, piece.hz * 2, m.darkSteel, 0, 0, 0);
  box(
    group,
    piece.hx * 3.2,
    0.04,
    piece.hz * 3.2,
    m.darkSteel,
    0,
    -piece.hy + 0.02,
    0
  );
  group.position.set(piece.x, piece.y, piece.z);
  return group;
}

// --- Boundary wall segment -------------------------------------------------
// Concrete wall with pilaster columns and a cap beam, filling one wall def.

export function buildBoundaryWallProp(wall, wallHeight) {
  const m = getMats();
  const group = new THREE.Group();
  const alongX = wall.hx >= wall.hz;
  const halfLength = alongX ? wall.hx : wall.hz;
  const thickness = (alongX ? wall.hz : wall.hx) * 2;

  const inner = new THREE.Group();

  // Main wall slab.
  const slab = shadowed(
    new THREE.Mesh(
      new THREE.BoxGeometry(halfLength * 2, wallHeight, thickness * 0.85),
      m.concrete
    )
  );
  slab.position.y = wallHeight / 2;
  inner.add(slab);

  // Pilasters every ~6m.
  const count = Math.max(2, Math.round(halfLength / 3));
  for (let i = 0; i <= count; i++) {
    const x = -halfLength + (halfLength * 2 * i) / count;
    const pil = shadowed(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.5, wallHeight * 1.03, thickness * 1.05),
        m.concrete
      )
    );
    pil.position.set(x, (wallHeight * 1.03) / 2, 0);
    inner.add(pil);
  }

  // Cap beam.
  const capBeam = shadowed(
    new THREE.Mesh(
      new THREE.BoxGeometry(halfLength * 2, 0.25, thickness * 1.1),
      m.concrete
    )
  );
  capBeam.position.y = wallHeight + 0.1;
  inner.add(capBeam);

  if (!alongX) inner.rotation.y = Math.PI / 2;
  group.add(inner);
  group.position.set(wall.x, 0, wall.z);
  return group;
}

// --- Corner floodlight towers ---------------------------------------------
// Pure decoration with a bloom-friendly emissive lamp head. Placed inside
// the four corners, outside normal play space (tight against the walls).

export function buildFloodlightTower(x, z) {
  const m = getMats();
  const group = new THREE.Group();

  const pole = shadowed(
    new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 7.4, 8), m.darkSteel)
  );
  pole.position.y = 3.7;
  group.add(pole);

  // Head bracket + two lamp boxes angled into the arena (toward origin).
  const head = new THREE.Group();
  head.position.y = 7.2;
  const bracket = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.16), m.darkSteel)
  );
  head.add(bracket);
  for (const side of [-1, 1]) {
    const lampBody = shadowed(
      new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.18), m.darkSteel)
    );
    lampBody.position.set(side * 0.18, -0.12, 0);
    lampBody.rotation.x = 0.5;
    head.add(lampBody);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.24),
      m.lampGlow
    );
    glow.position.set(side * 0.18, -0.2, 0.08);
    glow.rotation.x = -0.9;
    head.add(glow);
  }
  head.rotation.y = Math.atan2(-x, -z); // face arena center
  group.add(head);

  group.position.set(x, 0, z);
  return group;
}

// --- Scatter decoration ----------------------------------------------------
// Small visual-only debris (barrels, pallets, rubble) hugging the walls so
// the pad edges don't feel sterile. Kept close to the boundary so it never
// meaningfully intersects play space (no colliders).

export function buildScatterDecor(groundHalf) {
  const m = getMats();
  const group = new THREE.Group();

  const barrelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.85, 12);
  const edge = groundHalf - 0.9;
  const spots = 14;
  for (let i = 0; i < spots; i++) {
    const t = rand();
    const side = Math.floor(rand() * 4);
    const along = (t * 2 - 1) * (groundHalf - 2.5);
    let x = 0;
    let z = 0;
    if (side === 0) [x, z] = [along, -edge];
    else if (side === 1) [x, z] = [along, edge];
    else if (side === 2) [x, z] = [-edge, along];
    else [x, z] = [edge, along];

    const kind = rand();
    if (kind < 0.55) {
      // Barrel (sometimes tipped).
      const barrel = shadowed(new THREE.Mesh(barrelGeo, kind < 0.3 ? m.rustSteel : m.darkSteel));
      if (rand() < 0.3) {
        barrel.rotation.z = Math.PI / 2;
        barrel.position.set(x, 0.28, z);
      } else {
        barrel.position.set(x, 0.425, z);
      }
      barrel.rotation.y = rand() * Math.PI;
      group.add(barrel);
    } else {
      // Rubble chunk.
      const s = 0.25 + rand() * 0.4;
      const chunk = shadowed(
        new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s * 0.8), m.concrete)
      );
      chunk.position.set(x, s * 0.3, z);
      chunk.rotation.y = rand() * Math.PI;
      chunk.rotation.z = (rand() - 0.5) * 0.2;
      group.add(chunk);
    }
  }
  return group;
}
