/*
 * Wildfire spread model: JavaScript copy of scripts/firemodel.py.
 *
 * Same rules, line for line, so the model runs in the browser.
 * Also includes the simplified ignition model (picks the starting cell).
 * Random numbers come from a seeded generator (mulberry32), not NumPy's, so
 * runs match Python statistically, not cell for cell.
 * Tested by scripts/verify_port.mjs.
 */
// Works in the browser (window.FireModelModule) and in Node (require).
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else root.FireModelModule = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --- Cell states -----------------------------------------------------
  // Unburned cells hold their land-cover class (1-8); these codes mark the rest.
  const EMPTY = 0,        // water: never burns
        BURNING = 9,
        BURNED = 10,
        NODATA = -999;    // missing data: never burns

  // --- 8 neighbors (row, col offsets) ----------------------------------
  const NEIGHBORHOOD = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  // --- Fuel factor per Dynamic World land-cover class (P_den) ----------
  // 0 = shrub/grass baseline; positive burns easier, negative harder.
  const FUEL_TO_FACTOR = {
    1: 0.4,    // Trees
    2: 0.0,    // Grass
    3: -0.2,   // Flooded vegetation
    4: -0.3,   // Crops
    5: 0.0,    // Shrub & scrub
    6: -0.6,   // Built
    7: -0.4,   // Bare
    8: -0.8,   // Snow & ice
  };
  function fuelFactor(cls, dflt) {
    return Object.prototype.hasOwnProperty.call(FUEL_TO_FACTOR, cls)
      ? FUEL_TO_FACTOR[cls] : dflt;
  }

  // --- Calibrated coefficients (see README) ----------------------------
  const DEFAULT_COEFFS = { P0: 0.58, C1: 0.045, C2: 0.131, A: 0.078 };

  const DEG = 180 / Math.PI, RAD = Math.PI / 180;

  // --- Seeded random numbers (same seed = same run) --------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class FireModel {
    /**
     * Grids are flat, row-major arrays of length rows * cols.
     * @param {Int32Array|number[]} landcover class 1-8, 0 = water, -999 = no data
     * @param {Float64Array|number[]} ndvi NDVI, -999 = no data (never burns)
     * @param {Float64Array|number[]} slope degrees
     * @param {{rows:number, cols:number, coeffs?, seed?, residenceTime?, spotting?}} opts
     */
    constructor(landcover, ndvi, slope, opts) {
      opts = opts || {};
      this.rows = opts.rows;
      this.cols = opts.cols;
      this.landcover = Int32Array.from(landcover);
      this.ndvi = Float64Array.from(ndvi);
      this.slope = Float64Array.from(slope);
      this.coeffs = Object.assign({}, DEFAULT_COEFFS, opts.coeffs || {});
      this.residenceTime = opts.residenceTime == null ? 3 : opts.residenceTime | 0;   // steps a cell burns
      this.spotting = !!opts.spotting;                                                 // optional ember spotting
      this.reset(opts.seed || 0);
    }

    /** Clear all fire; start again from the land-cover grid. */
    reset(seed) {
      this.rand = mulberry32(seed >>> 0);
      this.grid = Int32Array.from(this.landcover);
      this.burnAge = new Int32Array(this.rows * this.cols);   // steps each cell has burned
      this.stepIdx = 0;
      return this;
    }

    idx(r, c) { return r * this.cols + c; }

    ignite(row, col) { this.grid[this.idx(row, col)] = BURNING; }

    /** Ignite the cell at (lat, lon). bounds = {west, south, east, north}. */
    igniteLatLon(lat, lon, bounds) {
      let col = Math.floor((lon - bounds.west) / (bounds.east - bounds.west) * this.cols);
      let row = Math.floor((bounds.north - lat) / (bounds.north - bounds.south) * this.rows);   // row 0 = north edge
      row = Math.min(Math.max(row, 0), this.rows - 1);
      col = Math.min(Math.max(col, 0), this.cols - 1);
      this.ignite(row, col);
      return [row, col];
    }

    /**
     * Chance fire spreads INTO cell targetIdx from the neighbor at offset (dRow, dCol).
     * windDir is a model angle: 0 = toward +row (south), 90 = toward +col (east).
     */
    probability(targetIdx, dRow, dCol, windSpeed, windDir) {
      const coef = this.coeffs;
      const fuel = fuelFactor(this.landcover[targetIdx], 0);    // P_den
      const ndvi = this.ndvi[targetIdx];                        // P_veg (-999 -> never burns)
      const fireDir = Math.atan2(dCol, dRow) * DEG;             // spread direction, same angle frame
      const theta = Math.cos(Math.abs(windDir - fireDir) * RAD); // 1 = with wind, -1 = against
      const windFactor = Math.exp(coef.C1 * windSpeed) * Math.exp(coef.C2 * windSpeed * (theta - 1));
      const slopeFactor = Math.exp(coef.A * this.slope[targetIdx]);
      return coef.P0 * (1 + fuel) * (1 + ndvi) * windFactor * slopeFactor;
    }

    // Shuffle in place with the seeded generator.
    _shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }

    /** Advance the fire one step. */
    tick(windSpeed, windDir) {
      const g = this.grid, next = Int32Array.from(g);   // read old grid, write new: all cells update at once
      const rows = this.rows, cols = this.cols;
      for (let row = 1; row < rows - 1; row++) {        // edge cells skipped
        for (let col = 1; col < cols - 1; col++) {
          const i = row * cols + col;
          if (g[i] !== BURNING) continue;
          this.burnAge[i] += 1;
          if (this.burnAge[i] === 1) continue;          // just ignited: wait one step
          if (this.burnAge[i] < this.residenceTime) {
            // Try each neighbor, in random order.
            const order = this._shuffle(NEIGHBORHOOD.map((o) => o));
            for (let k = 0; k < order.length; k++) {
              const dRow = order[k][0], dCol = order[k][1];
              const ni = (row + dRow) * cols + (col + dCol);
              const s = g[ni];
              if (s !== BURNING && s !== BURNED && s !== EMPTY && s !== NODATA) {
                if (this.rand() < this.probability(ni, dRow, dCol, windSpeed, windDir)) {
                  next[ni] = BURNING;
                }
              }
            }
            // Optional ember spotting: first 11 steps, 1% chance, up to 10 cells away.
            if (this.spotting && this.stepIdx < 11 && this.rand() < 0.01) {
              const oRow = Math.floor(this.rand() * 20) - 10;   // -10..9, like np integers(-10, 10)
              const oCol = Math.floor(this.rand() * 20) - 10;
              const sRow = Math.min(Math.max(row + oRow, 1), rows - 2);
              const sCol = Math.min(Math.max(col + oCol, 1), cols - 2);
              const si = sRow * cols + sCol;
              const s = g[si];
              if (s !== BURNING && s !== BURNED && s !== EMPTY && s !== NODATA) {
                if (fuelFactor(this.landcover[si], -1) > -0.6) next[si] = BURNING;
              }
            }
          } else {
            next[i] = BURNED;                           // burned out
          }
        }
      }
      this.grid = next;
      this.stepIdx += 1;
      return this;
    }

    stats() {
      let burning = 0, burned = 0;
      const g = this.grid;
      for (let i = 0; i < g.length; i++) {
        if (g[i] === BURNING) burning++;
        else if (g[i] === BURNED) burned++;
      }
      return { step: this.stepIdx, burning: burning, burned: burned };
    }
  }


  // --- Ignition model (simplified): where a fire is most likely to start ---
  // Logistic weighted overlay from notebooks/Experimentation_validation.ipynb,
  // using the 3 layers available here at their original weights.
  const IGNITION_WEIGHTS = { veg: 0.25, slope: 0.15, landUse: 0.15 };

  // Ignition weight per Dynamic World class (0 = never starts a fire).
  const LAND_USE_WEIGHTS = {
    1: 0.9,   // Trees
    2: 0.6,   // Grass
    3: 0.0,   // Flooded vegetation
    4: 0.5,   // Crops
    5: 0.6,   // Shrub & scrub
    6: 0.3,   // Built
    7: 0.0,   // Bare
    8: 0.0,   // Snow & ice
  };

  /** Ignition probability per cell (0-1); NaN where fire can't burn. Flat row-major arrays. */
  function ignitionProbability(landcover, ndvi, slope) {
    const n = landcover.length;
    const burnable = (i) => landcover[i] !== EMPTY && landcover[i] !== NODATA && ndvi[i] > NODATA;
    // min-max scale to 0-1 over burnable cells
    function norm(a) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) if (burnable(i)) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
      return (i) => (a[i] - lo) / (hi - lo + 1e-6);
    }
    const vegN = norm(ndvi), slopeN = norm(slope), w = IGNITION_WEIGHTS;
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (!burnable(i)) { p[i] = NaN; continue; }
      const landW = LAND_USE_WEIGHTS[landcover[i]] || 0;
      const z = w.veg * vegN(i) + w.slope * slopeN(i) + w.landUse * landW;
      p[i] = 1 / (1 + Math.exp(-z));                 // logistic -> 0-1
    }
    return p;
  }

  /**
   * [row, col] with the highest ignition probability; null if nothing burns.
   * margin: cells to skip along each border (edge cells never spread).
   */
  function highestRiskCell(landcover, ndvi, slope, rows, cols, margin) {
    const m = margin == null ? 1 : margin;
    const p = ignitionProbability(landcover, ndvi, slope);
    let best = null, bestP = -Infinity;
    for (let row = m; row < rows - m; row++) {
      for (let col = m; col < cols - m; col++) {
        const v = p[row * cols + col];
        if (v > bestP) { bestP = v; best = [row, col]; }
      }
    }
    return best;
  }

  return {
    FireModel, mulberry32, ignitionProbability, highestRiskCell,
    EMPTY, BURNING, BURNED, NODATA,
    NEIGHBORHOOD, FUEL_TO_FACTOR, DEFAULT_COEFFS, fuelFactor,
  };
});
