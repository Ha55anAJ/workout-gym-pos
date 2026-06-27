'use strict';
/* Generates the PWA icons (icon-192.png, icon-512.png, apple-touch-icon.png)
   as REAL, valid PNGs using the pure-JS `pngjs` lib (no native deps).
   Draws a brand-colored rounded tile with a simple dumbbell motif.

   Run:  node scripts/gen-icons.js
   The generated PNGs are committed to cloud/public/. */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', 'public');

// Brand palette (matches the SPA theme).
const BG_TOP = [99, 102, 241];     // indigo-500
const BG_BOT = [79, 70, 229];      // indigo-600 (subtle vertical gradient)
const BAR = [255, 255, 255];       // white dumbbell
const BAR_SHADOW = [67, 56, 202];  // indigo-700 (under the tile, transparent corners)

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// Rounded-rect coverage with light anti-aliasing via supersampling the edge.
function tileAlpha(x, y, size, radius) {
  // distance into the rounded-rect; returns 0..1 coverage
  const r = radius;
  // clamp point to inner rect, measure distance to corner circle when in corner zone
  let dx = 0, dy = 0;
  if (x < r) dx = r - x; else if (x > size - r) dx = x - (size - r);
  if (y < r) dy = r - y; else if (y > size - r) dy = y - (size - r);
  if (dx === 0 && dy === 0) return 1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const edge = r - dist;          // >0 inside, <0 outside
  const aa = 1.2;                 // anti-alias width in px
  if (edge >= aa) return 1;
  if (edge <= -aa) return 0;
  return (edge + aa) / (2 * aa);
}

function drawIcon(size) {
  const png = new PNG({ width: size, height: size });
  const radius = Math.round(size * 0.22); // maskable-friendly rounding

  // Dumbbell geometry (centered, horizontal).
  const cx = size / 2;
  const cy = size / 2;
  const barLen = size * 0.46;     // length of the central bar
  const barThick = Math.max(2, size * 0.055);
  const plateW = Math.max(3, size * 0.075);   // thickness of each weight plate
  const plateInnerH = size * 0.30;            // taller inner plates
  const plateOuterH = size * 0.20;            // shorter outer plates
  const gap = size * 0.012;

  const barX0 = cx - barLen / 2;
  const barX1 = cx + barLen / 2;

  function inBar(x, y) {
    return x >= barX0 && x <= barX1 && Math.abs(y - cy) <= barThick / 2;
  }
  // a vertical plate centered on plateCx with given width/height
  function inPlate(x, y, plateCx, w, h) {
    return Math.abs(x - plateCx) <= w / 2 && Math.abs(y - cy) <= h / 2;
  }

  const innerLeftCx = barX0 - gap - plateW / 2;
  const innerRightCx = barX1 + gap + plateW / 2;
  const outerLeftCx = innerLeftCx - plateW - gap;
  const outerRightCx = innerRightCx + plateW + gap;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const a = tileAlpha(x + 0.5, y + 0.5, size, radius);

      // background vertical gradient
      const t = y / size;
      let r = lerp(BG_TOP[0], BG_BOT[0], t);
      let g = lerp(BG_TOP[1], BG_BOT[1], t);
      let b = lerp(BG_TOP[2], BG_BOT[2], t);

      // dumbbell on top (white)
      const onDumbbell =
        inBar(x, y) ||
        inPlate(x, y, innerLeftCx, plateW, plateInnerH) ||
        inPlate(x, y, innerRightCx, plateW, plateInnerH) ||
        inPlate(x, y, outerLeftCx, plateW, plateOuterH) ||
        inPlate(x, y, outerRightCx, plateW, plateOuterH);

      if (onDumbbell) { r = BAR[0]; g = BAR[1]; b = BAR[2]; }

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = Math.round(a * 255);
    }
  }
  return png;
}

function write(name, size) {
  const png = drawIcon(size);
  const file = path.join(OUT_DIR, name);
  const buf = PNG.sync.write(png);
  fs.writeFileSync(file, buf);
  console.log('wrote', name, '(' + size + 'x' + size + ',', buf.length, 'bytes)');
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  write('icon-192.png', 192);
  write('icon-512.png', 512);
  write('apple-touch-icon.png', 180);
  console.log('done.');
}

main();
