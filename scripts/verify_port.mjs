/*
 * Verifies the JS FireModel port (web/js/model.js).
 *
 *   1. Determinism   -- identical seed => identical output.
 *   2. Divergence    -- different seeds => different output.
 *   3. Wind response -- burned mass shifts toward the wind-driven direction,
 *                       and 0 deg drives the fire DOWN the grid (south/+row),
 *                       confirming the fire_dir convention.
 *   4. Nodata mask   -- NDVI = -999 cells never ignite.
 *   5. Ignition      -- highest-risk cell is burnable, off the edge, and the max.
 *   6. Diagonal fix  -- diagonalDelay makes the burn round instead of square.
 *
 * If a layers JSON is passed as argv[2], the model is ALSO run on those exact
 * layers so burned counts can be compared with the Python model:
 *   python scripts/firemodel.py gen --out layers.json
 *   python scripts/firemodel.py run --layers layers.json --seed 0 --steps 40
 *
 * Run: node scripts/verify_port.mjs [layers.json]
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { FireModel, ignitionProbability, highestRiskCell } = require(join(here, "..", "web", "js", "model.js"));

// --- tiny synthetic landscape (self-contained, no data dependency) --------
function makeLayers(n, seed) {
  let a = (seed ^ 0x9e3779b9) >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lc = new Int32Array(n * n), ndvi = new Float64Array(n * n), slope = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const v = 0.3 + 0.4 * rnd();          // NDVI ~ 0.3..0.7 (all burnable)
    ndvi[i] = v;
    slope[i] = 5 * rnd();
    lc[i] = v > 0.55 ? 1 : 5;              // trees or shrub
  }
  return { lc, ndvi, slope, n };
}

function run(layers, opts, ignite, steps, windSpeed, windDir) {
  const { lc, ndvi, slope, n } = layers;
  const m = new FireModel(lc, ndvi, slope, Object.assign({ rows: n, cols: n }, opts));
  ignite(m, n);
  for (let s = 0; s < steps; s++) m.tick(windSpeed, windDir);
  return m;
}

function centroid(model, n) {
  let r = 0, c = 0, k = 0;
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
    const s = model.grid[x * n + y];
    if (s === 9 || s === 10) { r += x; c += y; k++; }
  }
  return k ? { row: r / k, col: c / k, mass: k } : { row: NaN, col: NaN, mass: 0 };
}

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  ok ? pass++ : fail++;
};

const n = 81, ctr = (m) => m.ignite((n / 2) | 0, (n / 2) | 0);
const L = makeLayers(n, 12345);

console.log("1. Determinism (same seed -> identical grid)");
{
  const a = run(L, { seed: 7 }, ctr, 30, 8, 0);
  const b = run(L, { seed: 7 }, ctr, 30, 8, 0);
  let identical = a.grid.length === b.grid.length;
  for (let i = 0; identical && i < a.grid.length; i++) if (a.grid[i] !== b.grid[i]) identical = false;
  check("seed 7 == seed 7", identical, `burned=${a.stats().burned}`);
}

console.log("2. Divergence (different seeds -> different grids)");
{
  const a = run(L, { seed: 1 }, ctr, 30, 8, 0);
  const b = run(L, { seed: 2 }, ctr, 30, 8, 0);
  let diff = 0;
  for (let i = 0; i < a.grid.length; i++) if (a.grid[i] !== b.grid[i]) diff++;
  check("seed 1 != seed 2", diff > 0, `${diff} cells differ`);
}

console.log("3. Wind response (fire_dir convention)");
{
  // Average centroid over several seeds to beat stochastic noise.
  const dirs = { 0: [], 90: [], 180: [], 270: [] };
  for (const dir of [0, 90, 180, 270]) {
    for (let seed = 0; seed < 24; seed++) {
      const m = run(L, { seed }, ctr, 22, 12, dir);
      dirs[dir].push(centroid(m, n));
    }
  }
  const avg = (arr, k) => arr.reduce((s, o) => s + o[k], 0) / arr.length;
  const mid = (n / 2) | 0;
  const d0 = avg(dirs[0], "row") - mid;     // +row = down/south
  const d180 = avg(dirs[180], "row") - mid; // should be negative (up/north)
  const d90 = avg(dirs[90], "col") - mid;   // +col = right/east
  const d270 = avg(dirs[270], "col") - mid; // should be negative (left/west)
  console.log(`     0 deg -> row drift ${d0.toFixed(2)} (expect > 0, fire runs DOWN/south)`);
  console.log(`   180 deg -> row drift ${d180.toFixed(2)} (expect < 0, up/north)`);
  console.log(`    90 deg -> col drift ${d90.toFixed(2)} (expect > 0, right/east)`);
  console.log(`   270 deg -> col drift ${d270.toFixed(2)} (expect < 0, left/west)`);
  check("0 deg drives fire down (south, +row)", d0 > 0.3);
  check("180 deg drives fire up (north, -row)", d180 < -0.3);
  check("90 deg drives fire right (east, +col)", d90 > 0.3);
  check("270 deg drives fire left (west, -col)", d270 < -0.3);
  check("0 and 180 are opposite", d0 * d180 < 0);
}

console.log("4. Nodata mask (NDVI = -999 never ignites)");
{
  const lc = Int32Array.from(L.lc), ndvi = Float64Array.from(L.ndvi), slope = Float64Array.from(L.slope);
  // Make a vertical wall of nodata just right of centre; fire must not cross.
  const wall = ((n / 2) | 0) + 3;
  for (let x = 0; x < n; x++) ndvi[x * n + wall] = -999;
  const m = new FireModel(lc, ndvi, slope, { rows: n, cols: n, seed: 3 });
  m.ignite((n / 2) | 0, (n / 2) | 0);
  for (let s = 0; s < 40; s++) m.tick(15, 90); // strong east wind pushing INTO the wall
  let wallBurned = 0, beyond = 0;
  for (let x = 0; x < n; x++) {
    const s1 = m.grid[x * n + wall]; if (s1 === 9 || s1 === 10) wallBurned++;
    for (let y = wall + 1; y < n; y++) { const s2 = m.grid[x * n + y]; if (s2 === 9 || s2 === 10) beyond++; }
  }
  check("no nodata cell ignited", wallBurned === 0, `wall burned=${wallBurned}`);
  check("fire did not cross the nodata wall", beyond === 0, `beyond=${beyond}`);
}

console.log("5. Ignition model (highest-risk cell)");
{
  const lc = Int32Array.from(L.lc);
  for (let i = 0; i < n; i++) lc[i * n + 10] = 0;         // a water column: must never be picked
  const p = ignitionProbability(lc, L.ndvi, L.slope);
  const cell = highestRiskCell(lc, L.ndvi, L.slope, n, n);
  const [row, col] = cell, i = row * n + col;
  let maxInner = -Infinity;
  for (let r = 1; r < n - 1; r++) for (let c = 1; c < n - 1; c++) {
    const v = p[r * n + c]; if (v > maxInner) maxInner = v;
  }
  check("picked cell is burnable", lc[i] !== 0 && L.ndvi[i] > -999, `class=${lc[i]}`);
  check("picked cell is off the edge", row > 0 && col > 0 && row < n - 1 && col < n - 1, `[${row}, ${col}]`);
  check("picked cell has the max probability", p[i] === maxInner, `p=${p[i].toFixed(4)}`);
  check("water gets no probability", Number.isNaN(p[10]));
}

console.log("6. Diagonal correction (burn shape on a flat, uniform grid)");
{
  // Reach along the axis vs along the diagonal (in cell widths); 1.41 = square, ~1 = round.
  const nn = 121, c = (nn / 2) | 0;
  const lc = new Int32Array(nn * nn).fill(5), ndvi = new Float64Array(nn * nn).fill(0.3), slope = new Float64Array(nn * nn);
  const ratio = (diagonalDelay) => {
    const m = new FireModel(lc, ndvi, slope, { rows: nn, cols: nn, seed: 1, residenceTime: 4, diagonalDelay });
    m.ignite(c, c);
    for (let s = 0; s < 50; s++) m.tick(0, 0);
    const b = (r, q) => m.grid[r * nn + q] === 9 || m.grid[r * nn + q] === 10;
    let ax = 0, dg = 0;
    for (let k = 1; k < c; k++) { if (b(c, c + k)) ax = k; if (b(c + k, c + k)) dg = k * Math.SQRT2; }
    return dg / ax;
  };
  const r0 = ratio(false), r1 = ratio(true);
  check("original grows as a square", r0 > 1.2, `diagonal/axis reach = ${r0.toFixed(2)}`);
  check("corrected grows round", r1 > 0.85 && r1 < 1.1, `diagonal/axis reach = ${r1.toFixed(2)}`);
}

// --- Optional: run on Python-generated layers for cross-language compare ---
const layersPath = process.argv[2];
if (layersPath) {
  console.log("7. Cross-language layers (" + layersPath + ")");
  const d = JSON.parse(readFileSync(layersPath, "utf8"));
  const nn = d.size;
  const lc = Int32Array.from(d.landcover), ndvi = Float64Array.from(d.ndvi), slope = Float64Array.from(d.slope);
  const runs = [];
  for (let seed = 0; seed < 40; seed++) {
    const m = new FireModel(lc, ndvi, slope, { rows: nn, cols: nn, seed });
    m.ignite((nn / 2) | 0, (nn / 2) | 0);
    for (let s = 0; s < 40; s++) m.tick(0, 0);
    const st = m.stats(); runs.push(st.burning + st.burned);
  }
  const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
  const sd = Math.sqrt(runs.reduce((a, b) => a + (b - mean) ** 2, 0) / runs.length);
  console.log(`     JS  total-affected over 40 seeds: mean=${mean.toFixed(1)} sd=${sd.toFixed(1)} min=${Math.min(...runs)} max=${Math.max(...runs)}`);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
