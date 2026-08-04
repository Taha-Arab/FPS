// ---------------------------------------------------------------------------
// Procedural texture generation (modern-overhaul).
//
// The game must stay a zero-asset static site (see AGENTS.md), so instead of
// shipping image files we paint realistic-ish surfaces onto <canvas> elements
// at startup and use them as Three.js textures. Each generator returns
// { map, roughnessMap?, normal-ish shading baked in } style canvases.
// ---------------------------------------------------------------------------

import * as THREE from "three";

// Small seeded PRNG so textures look the same every load (mulberry32).
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function canvasTexture(canvas, repeatX = 1, repeatY = 1) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Derives a tangent-space normal map from a canvas's luminance (treating
// brightness as height). This is what makes flat surfaces catch light like
// real relief — cheap Sobel filter, run once at startup.
export function canvasToNormalTexture(sourceCanvas, strength = 1.5, repeatX = 1, repeatY = 1) {
  const size = sourceCanvas.width;
  const srcCtx = sourceCanvas.getContext("2d");
  const src = srcCtx.getImageData(0, 0, size, size).data;

  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    height[i] =
      (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) /
      255;
  }

  const out = makeCanvas(size);
  const outCtx = out.getContext("2d");
  const img = outCtx.createImageData(size, size);
  const data = img.data;

  const at = (x, y) =>
    height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      // Normalize (-dx, -dy, 1/strength) into RGB.
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  outCtx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(out);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  // Normal maps carry vectors, not colors — must stay linear.
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Speckled noise pass shared by several materials.
function speckle(ctx, size, rng, count, alphaMax, light) {
  for (let i = 0; i < count; i++) {
    const shade = Math.floor(rng() * 60);
    const value = light ? 200 + shade : 20 + shade;
    ctx.fillStyle = `rgba(${value}, ${value}, ${value}, ${rng() * alphaMax})`;
    const s = 1 + rng() * 2.5;
    ctx.fillRect(rng() * size, rng() * size, s, s);
  }
}

// Weathered asphalt/concrete ground with expansion cracks + stains.
export function createAsphaltTexture(repeat = 8) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(1337);

  ctx.fillStyle = "#4a4a4c";
  ctx.fillRect(0, 0, size, size);

  // Large soft stains / tonal variation.
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 40 + rng() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng() > 0.5;
    g.addColorStop(0, dark ? "rgba(30,30,32,0.25)" : "rgba(110,110,112,0.18)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  speckle(ctx, size, rng, 9000, 0.16, false);
  speckle(ctx, size, rng, 6000, 0.10, true);

  // Hairline cracks: random walks.
  ctx.strokeStyle = "rgba(20,20,22,0.55)";
  ctx.lineWidth = 1;
  for (let c = 0; c < 10; c++) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 12 + Math.floor(rng() * 20);
    for (let s = 0; s < steps; s++) {
      x += (rng() - 0.5) * 40;
      y += (rng() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return {
    map: canvasTexture(canvas, repeat, repeat),
    normalMap: canvasToNormalTexture(canvas, 1.2, repeat, repeat),
  };
}

// Poured concrete with form-board seams — boundary walls / barriers.
export function createConcreteTexture(repeatX = 4, repeatY = 1) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(2024);

  ctx.fillStyle = "#8d8d90";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 20; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 50 + rng() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.4 ? "rgba(70,70,74,0.20)" : "rgba(160,160,164,0.16)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  speckle(ctx, size, rng, 7000, 0.12, false);
  speckle(ctx, size, rng, 5000, 0.10, true);

  // Horizontal form seams + tie holes, classic poured-concrete look.
  ctx.strokeStyle = "rgba(50,50,54,0.5)";
  ctx.lineWidth = 2;
  for (const y of [size * 0.33, size * 0.66]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(40,40,44,0.6)";
  for (let i = 0; i < 8; i++) {
    const x = (i + 0.5) * (size / 8);
    for (const y of [size * 0.18, size * 0.5, size * 0.84]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Water streaks running down from the seams.
  for (let i = 0; i < 30; i++) {
    const x = rng() * size;
    const y = rng() * size * 0.5;
    const h = 30 + rng() * 120;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(60,60,64,0.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 2 + rng() * 3, h);
  }

  return {
    map: canvasTexture(canvas, repeatX, repeatY),
    normalMap: canvasToNormalTexture(canvas, 1.4, repeatX, repeatY),
  };
}

// Corrugated shipping-container metal, tinted per-call.
export function createContainerTexture(baseColor = "#5b6e58", repeatX = 2, repeatY = 1) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(777);

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // Vertical corrugation ridges: alternating light/dark bands.
  const bandWidth = size / 16;
  for (let i = 0; i < 16; i++) {
    const x = i * bandWidth;
    const g = ctx.createLinearGradient(x, 0, x + bandWidth, 0);
    g.addColorStop(0, "rgba(0,0,0,0.28)");
    g.addColorStop(0.35, "rgba(255,255,255,0.10)");
    g.addColorStop(0.65, "rgba(255,255,255,0.10)");
    g.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, bandWidth, size);
  }

  // Rust blooms + scuffs.
  for (let i = 0; i < 24; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 8 + rng() * 45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${110 + Math.floor(rng() * 40)}, ${60 + Math.floor(rng() * 20)}, 30, ${0.12 + rng() * 0.22})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(ctx, size, rng, 3500, 0.10, false);

  return {
    map: canvasTexture(canvas, repeatX, repeatY),
    // Strong relief so the corrugation ridges read as real 3D metal.
    normalMap: canvasToNormalTexture(canvas, 3.2, repeatX, repeatY),
  };
}

// Dark scuffed metal for platforms / deck plating, with tread pattern.
export function createMetalDeckTexture(repeatX = 2, repeatY = 2) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(4242);

  ctx.fillStyle = "#4e5257";
  ctx.fillRect(0, 0, size, size);

  // Diamond-plate tread marks.
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  const step = 42;
  for (let y = 0; y < size + step; y += step) {
    for (let x = 0; x < size + step; x += step) {
      const offset = (Math.floor(y / step) % 2) * (step / 2);
      ctx.save();
      ctx.translate(x + offset, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-9, -3, 18, 6);
      ctx.restore();
    }
  }

  speckle(ctx, size, rng, 5000, 0.14, false);
  speckle(ctx, size, rng, 2500, 0.08, true);

  // Edge scratches.
  ctx.strokeStyle = "rgba(200,200,205,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 60, y + (rng() - 0.5) * 12);
    ctx.stroke();
  }

  return {
    map: canvasTexture(canvas, repeatX, repeatY),
    normalMap: canvasToNormalTexture(canvas, 2.4, repeatX, repeatY),
  };
}

// Concrete jersey-barrier style surface for pillars / low cover.
export function createBarrierTexture(repeat = 1) {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(9090);

  ctx.fillStyle = "#9a968e";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 12; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 20 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.5 ? "rgba(120,116,108,0.25)" : "rgba(60,58,54,0.18)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(ctx, size, rng, 2600, 0.14, false);
  speckle(ctx, size, rng, 1800, 0.10, true);

  // Yellow hazard stripe band near the bottom, weathered.
  ctx.fillStyle = "rgba(190,160,40,0.35)";
  ctx.fillRect(0, size * 0.8, size, size * 0.12);
  speckle(ctx, size, rng, 700, 0.2, false);

  return {
    map: canvasTexture(canvas, repeat, repeat),
    normalMap: canvasToNormalTexture(canvas, 1.6, repeat, repeat),
  };
}

// Dusty tan sandbag fabric.
export function createSandbagTexture() {
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(313);

  ctx.fillStyle = "#8a7a5c";
  ctx.fillRect(0, 0, size, size);
  // Weave hint: fine alternating lines.
  ctx.strokeStyle = "rgba(60,52,38,0.18)";
  ctx.lineWidth = 1;
  for (let y = 0; y < size; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (rng() - 0.5) * 2);
    ctx.stroke();
  }
  speckle(ctx, size, rng, 900, 0.14, false);
  speckle(ctx, size, rng, 500, 0.1, true);

  return {
    map: canvasTexture(canvas, 1, 1),
    normalMap: canvasToNormalTexture(canvas, 1.0, 1, 1),
  };
}

// One-shot (non-tiling) ground decal layer for the whole arena: faded lane
// paint, a big worn helipad-style circle, tire marks and oil stains. Drawn
// at 1024px and stretched over the pad on a transparent overlay plane.
export function createGroundMarkingsTexture() {
  const size = 1024;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(6001);

  // Worn yellow center circle (helipad vibe) around the chokepoint.
  ctx.strokeStyle = "rgba(200,170,60,0.30)";
  ctx.lineWidth = 10;
  ctx.setLineDash([46, 30]);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Faded traffic lane lines crossing the pad.
  ctx.strokeStyle = "rgba(210,210,210,0.16)";
  ctx.lineWidth = 7;
  ctx.setLineDash([60, 45]);
  for (const x of [size * 0.22, size * 0.78]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Oil stains + tire arcs.
  for (let i = 0; i < 22; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 18 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(15,15,18,${0.10 + rng() * 0.22})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.strokeStyle = "rgba(25,25,28,0.20)";
  ctx.lineWidth = 9;
  for (let i = 0; i < 8; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 60 + rng() * 160;
    const a0 = rng() * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a0 + 0.5 + rng() * 1.2);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Camo fabric pattern for soldier bodies (tint = team hue mixed in).
export function createCamoTexture(baseColor, blotchColorA, blotchColorB) {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  const rng = makeRng(555);

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  function blotches(color, count, minR, maxR) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = rng() * size;
      const y = rng() * size;
      ctx.beginPath();
      // Irregular blob: several overlapping circles.
      for (let b = 0; b < 4; b++) {
        const r = minR + rng() * (maxR - minR);
        ctx.arc(x + (rng() - 0.5) * r, y + (rng() - 0.5) * r, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
  blotches(blotchColorA, 26, 8, 22);
  blotches(blotchColorB, 22, 6, 16);
  speckle(ctx, size, rng, 1500, 0.10, false);

  return canvasTexture(canvas, 1, 1);
}
