#!/usr/bin/env node
/** Selection-toolbar seam checker for visual-review screenshots.
 *
 * Finds candidate toolbar bands (background-delimited chrome blocks),
 * locates pills (long contiguous non-bar spans that persist across the band),
 * and reports vertical hairline artifacts inside them, with a hint at the
 * likely cause (backdrop slit from an unbled joint, or doubled translucent
 * tint from overlapping overlay parts — typically ~24dp from a pill edge).
 * Pass --dpr N when the capture uses a device scale factor other than 1.
 *
 * Usage: node scripts/selection-seam-check.mjs SHOT.png [MORE.png ...] [--dpr N]
 * Exit code: 0 clean, 1 artifacts found, 2 usage/dependency error.
 */
import { readFileSync } from "node:fs";
let PNG;
try {
  ({ PNG } = await import("pngjs"));
} catch {
  console.error("pngjs not resolvable (npm i -D pngjs) — it is a hoisted transitive dependency in this workspace.");
  process.exit(2);
}
const args = process.argv.slice(2);
const dprIndex = args.indexOf("--dpr");
const dpr = dprIndex >= 0 ? Number(args[dprIndex + 1]) || 1 : 1;
const files = args.filter((a, i) => a !== "--dpr" && (dprIndex < 0 || i !== dprIndex + 1));
if (!files.length) {
  console.error("usage: node scripts/selection-seam-check.mjs SHOT.png [MORE.png ...] [--dpr N]");
  process.exit(2);
}

const lum = c => 0.21 * c[0] + 0.72 * c[1] + 0.07 * c[2];

function analyze(file) {
  const png = PNG.sync.read(readFileSync(file));
  const { width: W, height: H, data } = png;
  const px = (x, y) => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const bg = px(2, H - 2);
  const bgLum = lum(bg);
  // Chrome blocks: maximal runs of rows (bottom 45%) with >30% non-background.
  const blocks = [];
  let current = null;
  for (let y = Math.floor(H * 0.55); y < H; y++) {
    let off = 0;
    for (let x = 0; x < W; x += 3) if (Math.abs(lum(px(x, y)) - bgLum) > 8) off++;
    const chrome = off * 3 > W * 0.3;
    if (chrome && !current) current = { top: y };
    if (!chrome && current) { current.bottom = y - 1; blocks.push(current); current = null; }
  }
  if (current) { current.bottom = H - 1; blocks.push(current); }
  const candidates = blocks.filter(b => b.bottom - b.top >= Math.round(36 * dpr) && b.bottom - b.top <= Math.round(140 * dpr));
  const findings = [];
  let pillBands = 0;
  for (const block of candidates) {
    const rows = [];
    for (let y = block.top; y <= block.bottom; y += 1) rows.push(y);
    // Bar color: dominant color of rows just inside the block's flat edges
    // (between the corner arcs, above/below the pills).
    const inset = Math.max(2, Math.round(2 * dpr));
    const counts = new Map();
    for (const y of [...rows.slice(inset, inset + 6), ...rows.slice(-inset - 6, -inset)]) {
      for (let x = 0; x < W; x += 2) {
        const c = px(x, y);
        const key = (c[0] >> 3) + "," + (c[1] >> 3) + "," + (c[2] >> 3);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!dominant) continue;
    const bar = dominant[0].split(",").map(v => (Number(v) << 3) + 4);
    const barLum = lum(bar);
    // Pills: non-bar spans on the band's middle row (pill centers, widest
    // extent), verified as pill-colored along their center column.
    const middle = rows[Math.floor(rows.length / 2)];
    const candidateSpans = [];
    let start = null;
    for (let x = 0; x <= W; x++) {
      const off = x < W && Math.abs(lum(px(x, middle)) - barLum) > 7;
      if (off && start == null) start = x;
      if (!off && start != null) { candidateSpans.push([start, x - 1]); start = null; }
    }
    const pills = [];
    for (const [left, right] of candidateSpans) {
      if (right - left < Math.round(36 * dpr) || right - left > Math.round(230 * dpr)) continue;
      const center = Math.round((left + right) / 2);
      let colored = 0;
      for (const y of rows) if (Math.abs(lum(px(center, y)) - barLum) > 7) colored++;
      if (colored >= rows.length * 0.5) pills.push({ left, right });
    }
    if (pills.length < 1 || pills.length > 8) continue;
    pillBands++;
    // Vertical anomalies inside each pill, persisting over most of the band.
    for (const pill of pills) {
      const columns = [];
      const baseSamples = [];
      for (const y of rows) {
        for (let x = pill.left + Math.round(4 * dpr); x <= pill.right - Math.round(4 * dpr); x += 2) {
          const c = px(x, y);
          if (baseSamples.length < 4096) baseSamples.push(lum(c));
        }
        for (let x = pill.left + Math.round(6 * dpr); x <= pill.right - Math.round(6 * dpr); x++) {
          const c = px(x, y), l = px(x - 2, y), r = px(x + 2, y);
          if (Math.abs(lum(l) - lum(c)) > 3.5 && Math.abs(lum(r) - lum(c)) > 3.5 && Math.abs(lum(l) - lum(r)) < 3.5) {
            let entry = columns.find(e => Math.abs(e.rawX - x) <= Math.round(3 * dpr));
            if (!entry) { entry = { count: 0, colors: [], rawX: x }; columns.push(entry); }
            entry.count++;
            if (entry.colors.length < 8) entry.colors.push(c);
          }
        }
      }
      baseSamples.sort((a, b) => a - b);
      const pillLum = baseSamples.length ? baseSamples[Math.floor(baseSamples.length / 2)] : barLum + 10;
      for (const entry of columns) {
        if (entry.count < Math.round(rows.length * 0.5)) continue;
        const lineLum = entry.colors.reduce((s, c) => s + lum(c), 0) / entry.colors.length;
        const kind = lineLum < pillLum - 3 ? "darker hairline (backdrop through the surface, or a doubled dark tint)"
          : lineLum > pillLum + 3 ? "lighter hairline (doubled translucent tint, or backdrop through a dark tint)"
          : "unknown vertical hairline";
        findings.push({
          x: Math.round(entry.rawX / dpr),
          fromRight: Math.round((pill.right - entry.rawX) / dpr),
          kind,
          pill: [Math.round(pill.left / dpr), Math.round(pill.right / dpr)],
        });
      }
    }
  }
  const seen = new Set();
  const unique = findings.filter(f => {
    const key = `${f.pill[0]}-${f.pill[1]}:${f.fromRight}:${f.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { file, W, H, pillBands, unique };
}

let dirty = false;
for (const file of files) {
  let result;
  try {
    result = analyze(file);
  } catch (error) {
    console.log(`${file}: unreadable (${error.message})`);
    process.exitCode = 2;
    continue;
  }
  if (result.unique.length) {
    dirty = true;
    console.log(`${result.file}: ${result.unique.length} vertical artifact(s) across ${result.pillBands} toolbar band(s)`);
    for (const f of result.unique) {
      console.log(`  x≈${f.x} (~${f.fromRight}dp from pill right edge, pill [${f.pill[0]}, ${f.pill[1]}]): ${f.kind}`);
    }
  } else {
    console.log(`${result.file}: clean (${result.pillBands ? `${result.pillBands} toolbar band(s) checked` : "no toolbar band found"})`);
  }
}
if (dirty) process.exitCode = 1;
