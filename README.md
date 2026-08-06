# Modeling Wildfire Spread from Satellite Imagery and Environmental Data

**A grid-based burn/wildfire simulation (cellular automata approach) driven by Landsat vegetation indices, 10 m land cover, terrain, and wind, validated against observed fire perimeters.** 

Built for a Modeling & Simulation course at Georgia Tech, Spring 2025.

**Study area:** Ten counties in the greater Los Angeles region  
**Validation events:** Rabbit Fire and Rinconada Fire (2023)

## Overview

This project simulates where a wildfire is likely to burn across a real landscape using only open geospatial data. Ten counties in the greater Los Angeles region were assembled into a multi-layer raster stack from Landsat 9 imagery, 10 m land cover, elevation, and hourly weather data, all reprojected and resampled onto a common grid. That stack drives two linked components: a model of where fires are likely to start, and a cellular automata model of how they spread.

**Ignition model.** 
A weighted overlay of eight normalized environmental layers (vegetation density, drought index, surface temperature, slope, land cover, road proximity, lightning density, and fire history). Each layer carries a literature-derived weight. The weighted layers are summed and rescaled to a 0–1 ignition probability using a logistic function, ranking every cell by likelihood of ignition.

**Spread model.** Fire propagates outward from a seeded ignition point at discrete timesteps. At each step, a burning cell can ignite any of the eight cells that touch it: the four sharing an edge plus the four sharing a corner. This is the Moore neighborhood, the standard 3×3 window used in cellular automata. Whether a given neighbor ignites depends on its vegetation density and fuel type, the local slope, and how closely the direction of spread aligns with prevailing wind. Following Alexandridis et al. (2008):
 
```
P = P0 · (1 + P_veg) · (1 + P_den) · exp(C1·V) · exp(C2·V·(cos θ − 1)) · exp(A·slope)
```

with `P0 = 0.58`, `C1 = 0.045`, `C2 = 0.131`, `A = 0.078`, where `V` is wind speed and `θ` the angle between wind and spread direction. `P_veg` is derived from NDVI-based vegetation density, `P_den` from land cover class flammability.

Simulated burn extents were compared against observed fire perimeter polygons using intersection over union (IoU), the ratio of overlapping area to total combined area. 

## Data

Retrieved via Google Earth Engine unless noted, then reprojected and resampled to a common grid.

| Layer | Source |
|---|---|
| NDVI, NDDI, land surface temperature | Landsat 9 Level-2 |
| Land cover (fuel classes) | Google Dynamic World, 10 m |
| Elevation → slope | Google Maps Elevation API / Open-Elevation |
| Road proximity | U.S. Census TIGER, Euclidean distance |
| Wind speed and direction | Open-Meteo API |
| Fire perimeters | Public fire incident records (GeoJSON) |
| Lightning density, fire history | Synthetic — see limitations |

Large rasters are not committed. `landuse.tif`, `NDVI.tif`, and `SlopeExport.tif` are Earth Engine exports, regenerable via `notebooks/gee-imagery-explore.ipynb`. `config.json` holds API keys and is gitignored.

## Tools and workflow

Python: `numpy` (grid propagation), `rasterio` (raster I/O and alignment), `geopandas`/`shapely` (perimeter geometry, IoU), `scikit-learn` (ROC/AUC), `matplotlib` and `folium` (visualization), Google Earth Engine Python API.

1. **Acquire** — pull imagery and terrain from GEE, wind from Open-Meteo (`gee-imagery-explore.ipynb`)
2. **Align** — reproject and resample all layers to a shared grid (`Rastertransform.py`)
3. **Derive inputs** — slope from elevation, vegetation density from NDVI, fuel factors from land cover (`VegetationType.ipynb`, `wind-factor.ipynb`)
4. **Estimate ignition probability** (`ignition-model.ipynb`)
5. **Simulate** — `baseline-model.ipynb` for the simplified case, `ActualCA.ipynb` for full runs, `Experimentation.ipynb` for parameter sweeps
6. **Validate** — AUC for the ignition surface, IoU for burn extent vs. observed perimeters (`validation.ipynb`, `Experimentation_validation.ipynb`)

## Results

| Fire (2023) | IoU vs. observed perimeter |
|---|---|
| Rabbit Fire | 0.529 |
| Rinconada Fire | 0.052 |

Land cover controlled spread more than any other input: built-up areas, crops, and bare ground acted as firebreaks, water as an absolute barrier, and fire moved fastest through tree cover. Wind direction determined which way the fire advanced. 

The gap between the two validation fires is the most informative result. It points to suppression activity, local microclimate, and terrain-channeled wind, none of which a spatially uniform wind field can represent.

Full figures and derivations are in `Team4_FinalReport.pdf`.

## Limitations

The automaton is empirical rather than physics-based. Physics-based operational models such as FARSITE and FlamMap resolve mechanisms this approach cannot (crown fire transition, spotting, fire-atmosphere feedback), and suppression is absent entirely, so simulated perimeters represent unmitigated spread. Wind is applied as a spatially uniform field, lightning density and fire history are synthetic, and vegetation is a single snapshot rather than seasonally curing fuel.

Next steps: add an interactive web map with animated fire-front playback and scenario controls, run ensembles to produce burn probability surfaces instead of single deterministic perimeters, introduce spatially varying wind from gridded reanalysis, and validate against additional fire events.

## Attribution

**Team:** Katherine Losada, Thanawit Suwannikom, Gabriel Appiah, Kshitij Sawant

**My contributions:** built the raster data pipeline for the fire spread model: acquired and preprocessed satellite imagery in Google Earth Engine using the GEE Python API, derived NDVI from Landsat 9, and reclassified Google Dynamic World land cover classes into vegetation fuel types; aligned all layers to a common grid, resolution, and coordinate system in Python so they could drive the simulation.

**Reference:** Alexandridis, A., et al. (2008). A cellular automata model for forest fire spread prediction. *Applied Mathematics and Computation*, 204(1), 191–201.
