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

  return canvasTexture(canvas, repeat, repeat);
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

  return canvasTexture(canvas, repeatX, repeatY);
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

  return canvasTexture(canvas, repeatX, repeatY);
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

  return canvasTexture(canvas, repeatX, repeatY);
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

  return canvasTexture(canvas, repeat, repeat);
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
