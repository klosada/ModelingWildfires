"""Wildfire spread model: a cellular automaton on a raster grid.

Each step, every burning cell tries to ignite its 8 neighbors with probability

    P = P0 (1 + P_veg)(1 + P_den) exp(C1 V) exp(C2 V (cos θ - 1)) exp(A slope)

(Alexandridis et al. 2008; terms defined in the README).
Per-cell inputs: land cover, NDVI, slope. Wind is uniform across the grid.
Also includes a simplified ignition model and validation (IoU vs observed).

Ported unchanged from notebooks/ActualCA.ipynb (the validated model).
web/js/model.js is a line-for-line JavaScript copy for the browser.
"""

from __future__ import annotations

import numpy as np

# --- Cell states -------------------------------------------------------------
# Unburned cells hold their land-cover class (1-8); these codes mark the rest.
EMPTY = 0        # water: never burns
BURNING = 9
BURNED = 10
NODATA = -999    # missing data: never burns

# --- 8 neighbors (row, col offsets) ------------------------------------------
NEIGHBORHOOD = [(-1, -1), (-1, 0), (-1, 1),
                (0, -1),           (0, 1),
                (1, -1),  (1, 0),  (1, 1)]

# --- Fuel factor per Dynamic World land-cover class (P_den) -----------------
# 0 = shrub/grass baseline; positive burns easier, negative harder.
# Water (0) isn't listed: it never burns.
FUEL_TO_FACTOR = {
    1:  0.4,   # Trees
    2:  0.0,   # Grass
    3: -0.2,   # Flooded vegetation
    4: -0.3,   # Crops
    5:  0.0,   # Shrub & scrub
    6: -0.6,   # Built
    7: -0.4,   # Bare
    8: -0.8,   # Snow & ice
}

# --- Calibrated coefficients (see README) ------------------------------------
DEFAULT_COEFFS = {"P0": 0.58, "C1": 0.045, "C2": 0.131, "A": 0.078}


class FireModel:
    """Fire spread over fixed land-cover / NDVI / slope grids.

    Parameters
    ----------
    landcover : 2-D int array; class 1-8, 0 = water, -999 = no data.
    ndvi      : 2-D float array; NDVI, -999 = no data (never burns).
    slope     : 2-D float array; degrees.
    coeffs    : optional overrides for P0 / C1 / C2 / A.
    seed      : random seed (same seed = same run).
    residence_time : steps a cell burns before burning out.
    spotting  : optional ember spotting (default off).
    """

    def __init__(self, landcover, ndvi, slope, coeffs=None, seed=0,
                 residence_time=3, spotting=False):
        self.landcover = np.asarray(landcover, dtype=np.int64)
        self.ndvi = np.asarray(ndvi, dtype=np.float64)
        self.slope = np.asarray(slope, dtype=np.float64)
        self.coeffs = dict(DEFAULT_COEFFS)
        if coeffs:
            self.coeffs.update(coeffs)
        self.residence_time = int(residence_time)
        self.spotting = bool(spotting)
        self.rows, self.cols = self.landcover.shape
        self.reset(seed)

    # -- setup ------------------------------------------------------------------
    def reset(self, seed=0):
        """Clear all fire; start again from the land-cover grid."""
        self.rng = np.random.default_rng(seed)
        self.grid = self.landcover.copy()
        self.burn_age = np.zeros_like(self.grid)   # steps each cell has burned
        self.step_idx = 0
        return self

    def ignite(self, row, col):
        self.grid[row, col] = BURNING

    def ignite_latlon(self, lat, lon, bounds):
        """Ignite the cell at (lat, lon). bounds = (west, south, east, north)."""
        west, south, east, north = bounds
        col = int((lon - west) / (east - west) * self.cols)
        row = int((north - lat) / (north - south) * self.rows)  # row 0 = north edge
        row = min(max(row, 0), self.rows - 1)
        col = min(max(col, 0), self.cols - 1)
        self.ignite(row, col)
        return row, col

    # -- spread probability -----------------------------------------------------
    def probability(self, row, col, d_row, d_col, wind_speed, wind_dir):
        """Chance fire spreads INTO cell (row, col) from the neighbor at offset (d_row, d_col).

        wind_dir is a model angle: 0 = toward +row (south), 90 = toward +col (east).
        """
        coef = self.coeffs
        fuel = FUEL_TO_FACTOR.get(int(self.landcover[row, col]), 0) # P_den
        ndvi = self.ndvi[row, col]                                 # P_veg (-999 -> never burns)
        fire_dir = np.degrees(np.arctan2(d_col, d_row))            # spread direction, same angle frame
        theta = np.cos(np.deg2rad(abs(wind_dir - fire_dir)))       # 1 = with wind, -1 = against
        wind_factor = np.exp(coef["C1"] * wind_speed) * np.exp(coef["C2"] * wind_speed * (theta - 1))
        slope_factor = np.exp(coef["A"] * self.slope[row, col])
        return coef["P0"] * (1 + fuel) * (1 + ndvi) * wind_factor * slope_factor

    # -- one timestep -----------------------------------------------------------
    def tick(self, wind_speed, wind_dir):
        """Advance the fire one step."""
        new = self.grid.copy()   # read old grid, write new: all cells update at once
        for row in range(1, self.rows - 1):        # edge cells skipped
            for col in range(1, self.cols - 1):
                if self.grid[row, col] != BURNING:
                    continue
                self.burn_age[row, col] += 1
                if self.burn_age[row, col] == 1:
                    continue                       # just ignited: wait one step
                if self.burn_age[row, col] < self.residence_time:
                    # Try each neighbor, in random order.
                    order = NEIGHBORHOOD[:]
                    self.rng.shuffle(order)
                    for d_row, d_col in order:
                        n_row, n_col = row + d_row, col + d_col
                        if self.grid[n_row, n_col] not in (BURNING, BURNED, EMPTY, NODATA):
                            p = self.probability(n_row, n_col, d_row, d_col, wind_speed, wind_dir)
                            if self.rng.random() < p:
                                new[n_row, n_col] = BURNING
                    # Optional ember spotting: first 11 steps, 1% chance, up to 10 cells away.
                    if self.spotting and self.step_idx < 11 and self.rng.random() < 0.01:
                        s_row = min(max(row + int(self.rng.integers(-10, 10)), 1), self.rows - 2)
                        s_col = min(max(col + int(self.rng.integers(-10, 10)), 1), self.cols - 2)
                        if self.grid[s_row, s_col] not in (BURNING, BURNED, EMPTY, NODATA):
                            if FUEL_TO_FACTOR.get(int(self.landcover[s_row, s_col]), -1) > -0.6:
                                new[s_row, s_col] = BURNING
                else:
                    new[row, col] = BURNED             # burned out
        self.grid = new
        self.step_idx += 1
        return self

    # -- stats ------------------------------------------------------------------
    def stats(self):
        return {
            "step": self.step_idx,
            "burning": int(np.count_nonzero(self.grid == BURNING)),
            "burned": int(np.count_nonzero(self.grid == BURNED)),
        }


# -----------------------------------------------------------------------------
# Ignition model (simplified): where a fire is most likely to start.
# Logistic weighted overlay from notebooks/Experimentation_validation.ipynb,
# using the 3 layers available here at their original weights
# (the full model also uses roads, temperature, dryness, lightning, fire history).
# -----------------------------------------------------------------------------
IGNITION_WEIGHTS = {"veg": 0.25, "slope": 0.15, "land_use": 0.15}

# Ignition weight per Dynamic World class (0 = never starts a fire).
LAND_USE_WEIGHTS = {
    1: 0.9,   # Trees
    2: 0.6,   # Grass
    3: 0.0,   # Flooded vegetation
    4: 0.5,   # Crops
    5: 0.6,   # Shrub & scrub
    6: 0.3,   # Built
    7: 0.0,   # Bare
    8: 0.0,   # Snow & ice
}


def ignition_probability(landcover, ndvi, slope):
    """Ignition probability per cell (0-1); NaN where fire can't burn."""
    landcover = np.asarray(landcover)
    ndvi = np.asarray(ndvi, dtype=np.float64)
    slope = np.asarray(slope, dtype=np.float64)
    burnable = (landcover != EMPTY) & (landcover != NODATA) & (ndvi > NODATA)

    def norm(a):                                   # min-max scale to 0-1 over burnable cells
        a = np.where(burnable, a, np.nan)
        return (a - np.nanmin(a)) / (np.nanmax(a) - np.nanmin(a) + 1e-6)

    land_w = np.vectorize(lambda cls: LAND_USE_WEIGHTS.get(int(cls), 0.0))(landcover)
    w = IGNITION_WEIGHTS
    z = w["veg"] * norm(ndvi) + w["slope"] * norm(slope) + w["land_use"] * land_w
    return 1 / (1 + np.exp(-z))                    # logistic -> 0-1


def highest_risk_cell(landcover, ndvi, slope, margin=1):
    """(row, col) with the highest ignition probability; None if nothing burns.

    margin: cells to skip along each border (edge cells never spread).
    """
    p = ignition_probability(landcover, ndvi, slope)
    p[:margin, :] = np.nan
    p[-margin:, :] = np.nan
    p[:, :margin] = np.nan
    p[:, -margin:] = np.nan
    if np.all(np.isnan(p)):
        return None
    row, col = np.unravel_index(np.nanargmax(p), p.shape)
    return int(row), int(col)


# -----------------------------------------------------------------------------
# Validation: compare a run to the observed burn perimeter.
# IoU = match / (match + over-predicted + missed); 1 = perfect overlap, 0 = none.
# -----------------------------------------------------------------------------
NEITHER, MATCH, OVER, MISSED = 0, 1, 2, 3   # difference-map classes


def difference_map(grid, observed):
    """Per-cell class: MATCH (both burned), OVER (model only), MISSED (observed only)."""
    model = np.isin(grid, (BURNING, BURNED))
    obs = np.asarray(observed).astype(bool)
    diff = np.full(model.shape, NEITHER, dtype=np.int64)
    diff[model & obs] = MATCH
    diff[model & ~obs] = OVER
    diff[~model & obs] = MISSED
    return diff


def compare_to_observed(grid, observed):
    """Cell counts per class + IoU."""
    diff = difference_map(grid, observed)
    match, over, missed = (int(np.count_nonzero(diff == k)) for k in (MATCH, OVER, MISSED))
    union = match + over + missed
    return {"match": match, "over": over, "missed": missed,
            "iou": match / union if union else 0.0}


# -----------------------------------------------------------------------------
# Synthetic test landscape (for the CLI and cross-checks with the JS model).
# -----------------------------------------------------------------------------
def _value_noise(size, octaves, rng):
    """Smooth random field in 0..1 (layered value noise)."""
    field = np.zeros((size, size), dtype=np.float64)
    amp, total = 1.0, 0.0
    freq = 4
    for _ in range(octaves):
        g = rng.random((freq + 1, freq + 1))
        ys = np.linspace(0, freq, size)
        xs = np.linspace(0, freq, size)
        y0 = np.clip(np.floor(ys).astype(int), 0, freq - 1)
        x0 = np.clip(np.floor(xs).astype(int), 0, freq - 1)
        fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        # smoothstep
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        g00 = g[np.ix_(y0, x0)]; g10 = g[np.ix_(y0 + 1, x0)]
        g01 = g[np.ix_(y0, x0 + 1)]; g11 = g[np.ix_(y0 + 1, x0 + 1)]
        top = g00 * (1 - fx) + g01 * fx
        bot = g10 * (1 - fx) + g11 * fx
        field += amp * (top * (1 - fy) + bot * fy)
        total += amp; amp *= 0.5; freq *= 2
    return field / total


def gen_synthetic_layers(size=120, seed=1, roughness=3, veg_shift=0.0):
    """Random land cover / NDVI / slope grids for testing."""
    rng = np.random.default_rng(seed)
    elev = _value_noise(size, max(1, int(roughness)), rng)
    gy, gx = np.gradient(elev * 300.0)                         # elevation ~0-300 m
    slope = np.degrees(np.arctan(np.sqrt(gx * gx + gy * gy)))
    ndvi = _value_noise(size, 3, rng) * 0.9 - 0.1 + veg_shift  # ~ -0.1..0.85
    ndvi = np.clip(ndvi, -0.1, 0.85)
    # Land cover from NDVI + elevation thresholds (Dynamic World classes).
    lc = np.full((size, size), 5, dtype=np.int64)              # shrub
    lc[ndvi > 0.55] = 1                                        # trees
    lc[(ndvi > 0.3) & (ndvi <= 0.55)] = 2                      # grass
    lc[ndvi < 0.05] = 7                                        # bare
    lc[elev < 0.25] = 0                                        # water in low areas
    lc[(elev > 0.85) & (ndvi < 0.2)] = 8                       # snow on high peaks
    return lc, ndvi, slope


# -----------------------------------------------------------------------------
# CLI: generate test layers, or run the model and print burn counts.
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse, json

    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gen", help="generate synthetic layers -> JSON")
    g.add_argument("--size", type=int, default=120)
    g.add_argument("--seed", type=int, default=1)
    g.add_argument("--roughness", type=int, default=3)
    g.add_argument("--veg-shift", type=float, default=0.0)
    g.add_argument("--out", required=True)

    r = sub.add_parser("run", help="run model on layers JSON, print burned count")
    r.add_argument("--layers", required=True)
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--wind-speed", type=float, default=0.0)
    r.add_argument("--wind-dir", type=float, default=0.0)
    r.add_argument("--steps", type=int, default=40)
    r.add_argument("--residence-time", type=int, default=3)
    r.add_argument("--spotting", action="store_true")
    r.add_argument("--json", action="store_true", help="emit JSON stats")

    a = ap.parse_args()

    if a.cmd == "gen":
        lc, ndvi, slope = gen_synthetic_layers(a.size, a.seed, a.roughness, a.veg_shift)
        with open(a.out, "w") as f:
            json.dump({
                "size": a.size,
                "landcover": lc.flatten().astype(int).tolist(),
                "ndvi": np.round(ndvi, 4).flatten().tolist(),
                "slope": np.round(slope, 3).flatten().tolist(),
            }, f)
        print(f"wrote {a.out} ({a.size}x{a.size})")

    elif a.cmd == "run":
        with open(a.layers) as f:
            d = json.load(f)
        n = d["size"]
        lc = np.array(d["landcover"], dtype=np.int64).reshape(n, n)
        ndvi = np.array(d["ndvi"], dtype=np.float64).reshape(n, n)
        slope = np.array(d["slope"], dtype=np.float64).reshape(n, n)
        m = FireModel(lc, ndvi, slope, seed=a.seed,
                      residence_time=a.residence_time, spotting=a.spotting)
        m.ignite(n // 2, n // 2)
        for _ in range(a.steps):
            m.tick(a.wind_speed, a.wind_dir)
        s = m.stats()
        s["total_affected"] = s["burning"] + s["burned"]
        if a.json:
            print(json.dumps(s))
        else:
            print(f"seed={a.seed} wind={a.wind_speed}@{a.wind_dir} "
                  f"burning={s['burning']} burned={s['burned']} "
                  f"total={s['total_affected']}")
