"""Bundle the Earth Engine GeoTIFFs into one JSON for the California dashboard.

Reads landuse.tif / NDVI.tif / SlopeExport.tif / DEM.tif (exported aligned by
scripts/gee_export.js), resamples them onto a common size x size grid, derives
hillshade from the DEM, applies the course notebook's NDVI nodata masking, and
writes webapp/data/layers.json for the California dashboard: grid size, bounds,
per-cell arrays, model coefficients, land-cover classes, the ignition point, and
the observed burn perimeter as grid cells (for validation).

If the Sentinel-2 exports from scripts/gee_burn_scar.js are present, it also adds
real-fire layers: burn severity per cell (dNBR classes inside the perimeter,
unburned outside) plus web images of burn severity and the pre- and post-fire
(Jul 17) imagery, written next to layers.json.

Usage:
    python scripts/export_web_layers.py --in data --out webapp/data/layers.json --size 160

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
    from PIL import Image
    from rasterio.enums import Resampling
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds
    from rasterio.warp import transform_bounds
except ImportError:
    sys.exit("rasterio + Pillow are required: pip install -r requirements.txt")

# Single source of truth for fuel factors + coefficients.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from firemodel import FUEL_TO_FACTOR, DEFAULT_COEFFS  # noqa: E402

# Land-cover names + map colors (keep in sync with LC in webapp/index.html).
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

# Burn severity from dNBR: USGS thresholds (Key & Benson 2006), with the
# moderate-low and moderate-high classes merged. Keep in sync with webapp/index.html.
SEVERITY_BREAKS = (0.10, 0.27, 0.66)
SEVERITY_META = {
    0: ("Unburned", [26, 152, 80]),
    1: ("Low",      [254, 224, 139]),
    2: ("Moderate", [244, 109, 67]),
    3: ("High",     [165, 0, 38]),
}

# Sentinel-2 true-color exports -> web images (layer key, tif, output file).
IMAGERY = [
    ("prefire", "S2_prefire_truecolor.tif", "prefire.jpg"),
    ("postfire", "S2_during_20230717_truecolor.tif", "postfire_20230717.jpg"),
]
# Images keep the exports' full resolution (10 m), the sharpest the data allows.

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


def bounds_dict(b):
    return {"west": b[0], "south": b[1], "east": b[2], "north": b[3]}


def perimeter_mask(shapes, bounds, width, height):
    """Perimeter polygons -> 0/1 grid of the given size over the given bounds."""
    return rasterize(shapes, out_shape=(height, width), transform=from_bounds(*bounds, width, height),
                     fill=0, dtype="uint8")


def classify_severity(dnbr, inside):
    """dNBR -> severity class 0-3, kept only inside the perimeter (outside = unburned)."""
    classes = np.digitize(np.nan_to_num(dnbr, nan=0.0), SEVERITY_BREAKS)
    return np.where(inside == 1, classes, 0).astype("uint8")


def write_severity_image(dnbr_path, shapes, out_path):
    """Full-detail burn severity map (inside the perimeter) as a PNG; returns its bounds."""
    with rasterio.open(dnbr_path) as src:
        dnbr = src.read(1)
        b = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
    sev = classify_severity(dnbr, perimeter_mask(shapes, b, dnbr.shape[1], dnbr.shape[0]))
    palette = np.array([SEVERITY_META[k][1] for k in sorted(SEVERITY_META)], dtype="uint8")
    Image.fromarray(palette[sev]).save(out_path, optimize=True)
    return b


def write_true_color_image(tif_path, out_path):
    """3-band true-color GeoTIFF -> JPEG for the web; returns its bounds."""
    with rasterio.open(tif_path) as src:
        rgb = src.read([1, 2, 3])
        b = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
    Image.fromarray(np.transpose(rgb, (1, 2, 0)).astype("uint8")).save(out_path, quality=85, optimize=True)
    return b


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

    # Invalid NDVI (outside [-1, 1] or NaN) -> -999, as in the course notebook.
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
        "bounds": bounds_dict(bounds),
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
        observed = perimeter_mask(shapes, bounds, n, n)
        payload["observed"] = observed.flatten().tolist()
    else:
        shapes = None
        print("note: Rabbit_fire_perimeter.geojson not found -- validation layer omitted")

    # Real-fire layers from the Sentinel-2 exports (scripts/gee_burn_scar.js), optional.
    outdir = os.path.dirname(a.out) or "."
    os.makedirs(outdir, exist_ok=True)
    imagery = {}
    if shapes and os.path.exists(p("dNBR.tif")):
        dnbr, _, _ = read_resampled(p("dNBR.tif"), n, Resampling.average)
        payload["severity"] = classify_severity(dnbr, observed).flatten().tolist()
        payload["severity_classes"] = {str(k): {"name": nm, "color": col} for k, (nm, col) in SEVERITY_META.items()}
        b = write_severity_image(p("dNBR.tif"), shapes, os.path.join(outdir, "severity.png"))
        imagery["severity"] = {"url": "data/severity.png", "bounds": bounds_dict(b)}
    else:
        print("note: dNBR.tif (or the perimeter) not found -- burn severity omitted")
    for key, tif, out_name in IMAGERY:
        if os.path.exists(p(tif)):
            b = write_true_color_image(p(tif), os.path.join(outdir, out_name))
            imagery[key] = {"url": "data/" + out_name, "bounds": bounds_dict(b)}
        else:
            print(f"note: {tif} not found -- {key} imagery omitted")
    if imagery:
        payload["imagery"] = imagery

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
    if "severity" in payload:
        sev = np.array(payload["severity"])
        print("burn severity (cells inside the perimeter): " + ", ".join(
            f"{SEVERITY_META[k][0]} {np.count_nonzero((sev == k) & (observed.flatten() == 1))}" for k in SEVERITY_META))
    for key, v in imagery.items():
        kb_img = os.path.getsize(os.path.join(outdir, os.path.basename(v["url"]))) / 1024.0
        print(f"image {v['url']}  ({kb_img:.0f} KB)")


if __name__ == "__main__":
    main()
