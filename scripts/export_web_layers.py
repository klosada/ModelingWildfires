"""Bundle the Earth Engine GeoTIFFs into one JSON for the California dashboard.

Reads landuse.tif / NDVI.tif / SlopeExport.tif / DEM.tif (exported aligned by
scripts/gee_export.js), resamples them onto a common size x size grid, derives
hillshade from the DEM, applies the notebook's NDVI nodata masking, and writes
web/data/layers.json for the California dashboard: grid size, bounds, per-cell
arrays, model coefficients, land-cover classes, the ignition point, and the
observed burn perimeter as grid cells (for validation).

Usage:
    python scripts/export_web_layers.py --in data --out web/data/layers.json --size 160

Requires rasterio + numpy (see requirements.txt).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

try:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds
    from rasterio.warp import transform_bounds
except ImportError:
    sys.exit("rasterio is required: pip install rasterio  (see requirements.txt)")

# Single source of truth for fuel factors + coefficients.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from firemodel import FUEL_TO_FACTOR, DEFAULT_COEFFS  # noqa: E402

# Land-cover names + map colors (keep in sync with LC in web/index.html).
LC_META = {
    0: ("Water",     [58, 86, 120]),
    1: ("Trees",     [64, 96, 72]),
    2: ("Grass",     [140, 150, 96]),
    3: ("Flooded",   [80, 118, 118]),
    4: ("Crops",     [168, 154, 92]),
    5: ("Shrub",     [150, 132, 100]),
    6: ("Built",     [130, 130, 134]),
    7: ("Bare",      [170, 158, 138]),
    8: ("Snow/Ice",  [220, 224, 232]),
}

# Ignition point (lat, lon).
IGNITION_POINTS = [
    {"name": "Rabbit Fire", "lat": 33.89148, "lon": -117.02139},
]


def read_resampled(path, size, method):
    """Read band 1 resampled to size x size using the given resampling method."""
    with rasterio.open(path) as src:
        arr = src.read(1, out_shape=(size, size), resampling=method).astype("float64")
        # Bounds as lat/lon (EPSG:4326) for the map.
        west, south, east, north = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
        nodata = src.nodata
    return arr, (west, south, east, north), nodata


def hillshade(dem, bounds, azimuth=315.0, altitude=45.0):
    """Horn hillshade, normalized 0..1. Cell size derived from geographic bounds."""
    west, south, east, north = bounds
    n = dem.shape[0]
    lat = np.radians((south + north) / 2.0)
    cellx = (east - west) / n * 111320.0 * np.cos(lat)   # metres per pixel (E-W)
    celly = (north - south) / n * 111320.0               # metres per pixel (N-S)
    dzdy, dzdx = np.gradient(dem, celly, cellx)          # note: rows=y, cols=x
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)
    az = np.radians(360.0 - azimuth + 90.0)
    zen = np.radians(90.0 - altitude)
    hs = (np.cos(zen) * np.cos(slope) +
          np.sin(zen) * np.sin(slope) * np.cos(az - aspect))
    return np.clip(hs, 0.0, 1.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", default="data", help="folder with the tifs")
    ap.add_argument("--out", default="webapp/data/layers.json")
    ap.add_argument("--size", type=int, default=160, help="output grid size (square)")
    a = ap.parse_args()

    p = lambda name: os.path.join(a.indir, name)
    for f in ("landuse.tif", "NDVI.tif", "SlopeExport.tif"):
        if not os.path.exists(p(f)):
            sys.exit(f"missing {p(f)} -- run scripts/gee_export.js and download the tifs first")

    n = a.size
    # Nearest for classes (no blending), bilinear for continuous values.
    lc, bounds, lc_nodata = read_resampled(p("landuse.tif"), n, Resampling.nearest)
    ndvi, _, _ = read_resampled(p("NDVI.tif"), n, Resampling.bilinear)
    slope, _, _ = read_resampled(p("SlopeExport.tif"), n, Resampling.bilinear)

    # Land cover -> int classes; GeoTIFF nodata (or NaN) becomes -999.
    lc_int = np.where(np.isnan(lc), -999, np.rint(lc)).astype(int)
    if lc_nodata is not None:
        lc_int = np.where(lc == lc_nodata, -999, lc_int)

    # Invalid NDVI (outside [-1, 1] or NaN) -> -999, as in the notebook.
    ndvi = np.where(np.isnan(ndvi) | (ndvi < -1) | (ndvi > 1), -999.0, ndvi)
    slope = np.where(np.isnan(slope), 0.0, slope)

    # Hillshade + elevation from the DEM if present (optional).
    if os.path.exists(p("DEM.tif")):
        dem, _, _ = read_resampled(p("DEM.tif"), n, Resampling.bilinear)
        dem = np.where(np.isnan(dem), np.nanmedian(dem[~np.isnan(dem)]) if np.any(~np.isnan(dem)) else 0.0, dem)
        hs = hillshade(dem, bounds)
        elev = dem
    else:
        print("note: DEM.tif not found -- hillshade set flat, elevation omitted")
        hs = np.ones((n, n), dtype="float64") * 0.5
        elev = None

    # Rounding to keep the file small.
    ndvi_r = np.where(ndvi <= -999, -999, np.round(ndvi, 3))
    payload = {
        "size": n,
        "bounds": {"west": bounds[0], "south": bounds[1], "east": bounds[2], "north": bounds[3]},
        "landcover": lc_int.flatten().tolist(),
        "ndvi": ndvi_r.flatten().tolist(),
        "slope": np.round(slope, 2).flatten().tolist(),
        "hillshade": np.round(hs, 3).flatten().tolist(),
        "coeffs": DEFAULT_COEFFS,
        "classes": {str(i): {"name": nm, "fuel": FUEL_TO_FACTOR.get(i, 0.0), "color": col}
                    for i, (nm, col) in LC_META.items()},
        "ignition_points": IGNITION_POINTS,
    }
    if elev is not None:
        payload["elev"] = np.round(elev, 1).flatten().tolist()

    # Observed burn perimeter -> grid cells (1 = burned), for validation.
    perim_path = p("Rabbit_fire_perimeter.geojson")
    if os.path.exists(perim_path):
        with open(perim_path) as f:
            perim = json.load(f)
        shapes = [(feat["geometry"], 1) for feat in perim["features"]]
        observed = rasterize(shapes, out_shape=(n, n), transform=from_bounds(*bounds, n, n),
                             fill=0, dtype="uint8")
        payload["observed"] = observed.flatten().tolist()
    else:
        print("note: Rabbit_fire_perimeter.geojson not found -- validation layer omitted")

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    # --- report ---------------------------------------------------------
    kb = os.path.getsize(a.out) / 1024.0
    print(f"wrote {a.out}  ({kb:.0f} KB, {n}x{n})")
    print(f"bounds EPSG:4326: W {bounds[0]:.5f}  S {bounds[1]:.5f}  E {bounds[2]:.5f}  N {bounds[3]:.5f}")
    ndvi_valid = ndvi[ndvi > -999]
    print(f"NDVI valid {ndvi_valid.size}/{n*n} cells ({100*ndvi_valid.size/(n*n):.1f}%), "
          f"nodata {n*n - ndvi_valid.size}")
    print("land cover histogram:")
    vals, counts = np.unique(lc_int, return_counts=True)
    for v, c in sorted(zip(vals, counts), key=lambda t: -t[1]):
        nm = "nodata" if v == -999 else LC_META.get(int(v), ("?", None))[0]
        print(f"  {int(v):>4}  {nm:<9} {c:>7}  {100*c/(n*n):5.1f}%")


if __name__ == "__main__":
    main()
