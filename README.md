# Modeling Wildfire Spread from Satellite Imagery and Environmental Data

**Study area:** Riverside County, California  
**Validation events:** Rabbit Fire (2023)

Built for a Modeling & Simulation course at Georgia Tech, Spring 2025.

Later independently expanded into a geospatial web app with interactive dashboards.

## Overview

This project simulates where a wildfire is likely to burn across a real landscape using open geospatial data. Riverside county was assembled into a multi-layer raster stack from Landsat 9 imagery, 10 m land cover, elevation, and hourly weather data, all reprojected and resampled onto a common grid. That stack drives two linked components: a model of where fires are likely to start, and a cellular automata model of how they spread.

**Ignition model:** A weighted overlay of eight normalized environmental layers (vegetation density, drought index, surface temperature, slope, land cover, road proximity, lightning density, and fire history). Each layer carries a literature-derived weight. The weighted layers are summed and rescaled to a 0–1 ignition probability using a logistic function, ranking every cell by likelihood of ignition.

**Spread model:** Fire propagates outward from a seeded ignition point at discrete timesteps. At each step, a burning cell can ignite any of the eight cells that touch it: the four sharing an edge plus the four sharing a corner. This is the Moore neighborhood, the standard 3×3 window used in cellular automata. Whether a given neighbor ignites depends on its vegetation density and fuel type, the local slope, and how closely the direction of spread aligns with prevailing wind. Following Alexandridis et al. (2008):
 
```
P = P0 · (1 + P_veg) · (1 + P_den) · exp(C1·V) · exp(C2·V·(cos θ − 1)) · exp(A·slope)
```

`P0 = 0.58`, `C1 = 0.045`, `C2 = 0.131`, `A = 0.078`, where `V` is wind speed and `θ` the angle between wind and spread direction. `P_veg` is NDVI (vegetation greenness), and `P_den` is the flammability factor for its land cover class.

Simulated burn extents were compared against observed fire perimeter polygons using intersection over union (IoU), the ratio of overlapping area to total combined area. 

## Data

All layers were reprojected and resampled to a common grid and coordinate system.

| Layer | Source |
|---|---|
| NDVI, NDDI, land surface temperature | Landsat 9 Level-2, via Google Earth Engine |
| Land cover (fuel classes) | Google Dynamic World 10 m, via Google Earth Engine |
| Elevation → slope | Google Elevation API, slope computed from elevation gradients |
| Road proximity | U.S. Census TIGER, Euclidean distance |
| Wind speed and direction | Open-Meteo API |
| Fire perimeters | Public fire incident records (GeoJSON) |
| Lightning density, fire history | Randomly generated placeholders, see limitations |

Large rasters are not committed. `landuse.tif`, `NDVI.tif`, and `SlopeExport.tif` are Earth Engine exports, regenerable via `notebooks/gee-imagery-explore.ipynb`. `config.json` holds API keys and is gitignored.

## Tools and workflow

**Python:** `numpy` grid state and propagation; `rasterio` raster I/O and alignment; `pandas`/`geopandas`/`shapely` wind time series, perimeter geometry, and IoU; `scikit-image` resampling rasters onto the simulation grid; `requests` elevation and Open-Meteo API calls; `matplotlib`/`folium` visualization and web maps. 

1. **Acquire:** pull imagery and terrain from GEE, wind from Open-Meteo (`gee-imagery-explore.ipynb`, `wind-factor.ipynb`)
2. **Align:** reproject and resample all layers to a shared grid (`Rastertransform.py`)
3. **Derive inputs:** slope from elevation, vegetation density from NDVI, fuel factors from land cover (`VegetationType.ipynb`, `Vegetation_Density_Simulation.ipynb`)
4. **Estimate ignition probability:** (`ignition-model.ipynb`)
5. **Simulate:** `baseline-model.ipynb` for the simplified case, `ActualCA.ipynb` for full runs, `Experimentation.ipynb` for parameter sweeps
6. **Validate:** IoU for burn extent vs. observed perimeters (`validation.ipynb`, `Experimentation_validation.ipynb`)

## Results

| Fire (2023) | IoU vs. observed perimeter |
|---|---|
| Rabbit Fire | 0.529 |

Land cover controlled spread more than any other input: built-up areas, crops, and bare ground acted as firebreaks, water as an absolute barrier, and fire moved fastest through tree cover. Wind direction determined which way the fire advanced. 

The moderate IoU reflects factors the model cannot capture: suppression activity, local microclimate, and terrain-channeled wind, none of which a spatially uniform wind field can represent.

Full figures and derivations are in `Team4_FinalReport.pdf`.

## Limitations

The automaton is empirical rather than physics-based. Physics-based operational models such as FARSITE and FlamMap resolve mechanisms this approach cannot (crown fire transition, spotting, fire-atmosphere feedback), and suppression is absent entirely, so simulated perimeters represent unmitigated spread. Wind is applied as a spatially uniform field and vegetation is a single snapshot rather than seasonally curing fuel.

Lightning density and fire history were not obtained as observed data. Both are randomly generated rasters: lightning is drawn per cell from an exponential distribution, and fire history is a random binary field. Their values vary across the grid but bear no relationship to actual terrain, land cover, or fire records. Together they carry 30% of the weight in the ignition model, so the ignition probability surface should be read as a demonstration of the method rather than a calibrated risk product. 

**Next steps**

- Replace placeholder inputs with observed data: NLDN lightning stroke density, historical fire perimeters from MTBS or CAL FIRE
- Introduce spatially varying wind from gridded reanalysis
- Run ensembles to produce burn probability surfaces rather than single deterministic perimeters
- Add an interactive web map with animated fire-front playback and scenario controls
- Validate against additional fire events

## Attribution

**Team:** Katherine Losada, Thanawit Suwannikom, Gabriel Appiah, Kshitij Sawant

**My contributions:** Built the raster data pipeline for the fire spread model: acquired and preprocessed satellite imagery in Google Earth Engine, derived NDVI from Landsat 9, and reclassified Google Dynamic World land cover classes into vegetation fuel types. Aligned all layers to a common grid, resolution, and coordinate system in Python so they could drive the simulation.

**Reference:** Alexandridis, A., et al. (2008). A cellular automata model for forest fire spread prediction. *Applied Mathematics and Computation*, 204(1), 191–201.

## Interactive geospatial dashboard

An independent continuation of this project, built after the course to refine the model and develop it into an interactive geospatial platform. This extension is my own work.

The dashboard runs the wildfire spread model live in the browser as two linked interactive simulations. The first uses the same California study area and data from the course project, animating fire propagation over an interactive map so the calibrated model can be explored step by step. The second is a sandbox that lets users explore how wildfires spread across a randomly generated landscape, showing how burn behavior depends on land cover, terrain, vegetation, and wind. Every parameter can be customized, so users can experiment with how each environmental driver shapes fire spread in real time.

The California map is driven by the observed wind from the Rabbit Fire day (Jul 14, 2023), pulled from Open-Meteo's historical archive, a refinement over the course project's generic wind field.

**Built with:** Mapbox GL JS (interactive WebGL mapping), Google Earth Engine (remote-sensing data export), and Python (rasterio, NumPy) for the geospatial data pipeline.
