# Modeling Wildfire Spread from Satellite Imagery and Environmental Data

**Study area:** Riverside County, California  
**Validation events:** Rabbit Fire (2023)

Built for a Modeling & Simulation course at Georgia Tech, Spring 2025.

Later independently expanded into a geospatial web app with interactive dashboards.

## Overview

This project simulates where a wildfire is likely to burn across a real landscape using open geospatial data. A study area around the 2023 Rabbit Fire in Riverside County was assembled into an aligned raster stack of vegetation greenness, land cover, and slope, with fire-day wind applied uniformly across the grid. That stack drives two linked components: a model of where fires are likely to start, and a cellular automata model of how they spread.

## Data and tools

| Layer | Source |
|---|---|
| Vegetation greenness (NDVI) | Sentinel-2 surface reflectance, cloud-masked median composite, Jun 27 – Jul 12, 2023 (pre-fire) |
| Land cover (fuel classes) | Google Dynamic World (built from Sentinel-2), most frequent class over the same window |
| Elevation → slope, hillshade | SRTM 30 m elevation; slope from Earth Engine, hillshade derived in Python |
| Wind speed and direction | Open-Meteo historical weather, Rabbit Fire day (Jul 14, 2023) |
| Observed burn perimeter | CAL FIRE 2023 fire perimeter (GeoJSON) |
| Burn severity (dNBR) | Sentinel-2, pre-fire (Jun 27 – Jul 12) vs post-fire (Jul 20 – 31) composites, classified inside the perimeter |
| Fire imagery | Sentinel-2 true color: pre-fire composite (Jun 27 – Jul 12) and a single post-fire pass on Jul 17, 2023 |

All raster layers are exported from Google Earth Engine with the same footprint, resolution, and coordinate system, so they line up cell for cell.

**Tools:**
- **Google Earth Engine** (JavaScript): satellite and terrain data export
- **Python** (NumPy, rasterio, Pillow): resampling, hillshade, perimeter rasterization, burn severity, web images, and the reference model
- **HTML, CSS, and JavaScript + Mapbox GL JS**: the dashboards, in-browser model, and interactive satellite map
- **Node.js**: automated tests of the browser model

## Interactive geospatial web app

An independent continuation of this project, built after the course to refine the model and develop it into an interactive geospatial platform. This extension is my own work.

The web app runs the wildfire spread model live in the browser as two interactive dashboards:

- **California study area:** reconstructs the Rabbit Fire on an interactive Mapbox map. The fire animates step by step from the recorded ignition point, driven by the fire-day wind. The basemap switches between pre- and post-fire Sentinel-2 imagery, land cover, NDVI, and slope, and hovering any cell shows its data. A validation panel scores the run live against the observed burn perimeter and shows a burn difference map and real burn severity.
- **Test It Yourself (sandbox):** a randomly generated landscape where every input can be adjusted (land cover, terrain, vegetation, and wind) to see how each environmental driver shapes fire spread in real time.

Both dashboards can switch between the original and corrected spread models.

**Data pipeline:** Earth Engine exports the aligned rasters (`scripts/gee_export.js`). A Python script resamples them onto the simulation grid, derives hillshade, rasterizes the observed perimeter, and bundles everything into one JSON file for the browser (`scripts/export_web_layers.py`). The model is ported line for line from Python to JavaScript so it runs in the browser, and automated tests check the port (`scripts/verify_port.mjs`).

## Model

### Spread model

Fire propagates outward from a seeded ignition point at discrete timesteps. At each step, a burning cell can ignite any of the eight cells that touch it: the four sharing an edge plus the four sharing a corner. This is the Moore neighborhood, the standard 3×3 window used in cellular automata. Whether a given neighbor ignites depends on its vegetation density and fuel type, the local slope, and how closely the direction of spread aligns with prevailing wind. Following Alexandridis et al. (2008):

```
P = P0 · (1 + P_veg) · (1 + P_den) · exp(C1·V) · exp(C2·V·(cos θ − 1)) · exp(A·slope)
```

`P0 = 0.58`, `C1 = 0.045`, `C2 = 0.131`, `A = 0.078`, where `V` is wind speed and `θ` the angle between wind and spread direction. `P_veg` is NDVI (vegetation greenness), and `P_den` is the flammability factor for its land cover class.

### Corrected spread model

In an 8-neighbor grid, fire reaches diagonal cells as fast as side cells even though they are √2 (≈1.41×) farther away, so burns grow in square shapes. Following the distance-based spread timing used in PROPAGATOR (Trucchia et al., 2020), where the time to reach a cell is distance divided by spread speed, the corrected model delays spread to diagonal cells by one step. Because the model advances in whole steps, this makes diagonal spread take 1.5× as long rather than exactly 1.41×. On uniform terrain, burns become close to round, and the Rabbit Fire IoU rises from 0.73 to 0.75.

### Ignition model

A weighted overlay of three normalized environmental layers: vegetation density (NDVI, weight 0.25), slope (0.15), and land cover (0.15), using the literature-derived weights from the course project's model. The weighted layers are summed and rescaled to a 0–1 ignition probability using a logistic function, ranking every cell by likelihood of ignition. The sandbox starts its fire at the highest-risk cell; the California dashboard uses the Rabbit Fire's recorded ignition point.

## Validation and results

Simulated burn extents are compared against the observed Rabbit Fire perimeter using intersection over union (IoU): cells burned in both the model and the real fire, divided by cells burned in either (1 = perfect match). The model has no firefighting, so fire would keep spreading until it ran out of fuel. Each run therefore stops once it has burned to the real fire's extent (8,355 acres), so IoU measures where the fire burned rather than how long it ran. A Burn Difference map shows matched, over-predicted, and missed cells. Real burn severity comes from the change in Normalized Burn Ratio (dNBR) between pre- and post-fire Sentinel-2 composites, classified with USGS thresholds (Key & Benson, 2006) into unburned, low, moderate, and high, and kept only inside the fire perimeter so seasonal drying of crops and grass outside it isn't counted as burn.

| Version | Rabbit Fire IoU |
|---|---|
| Course project (2025) | 0.53 |
| Current model | 0.73 |
| Corrected model | 0.75 |

Current and corrected values are averages over 10 random seeds. The current pipeline uses fire-day wind from Open-Meteo instead of a generic wind field, pre-fire satellite composites on one aligned grid, a new 160 × 160 simulation grid, and runs stopped at the observed burn area. These changes were not tested one at a time, so the improvement can't be attributed to any single one.

Land cover controlled spread more than any other input: built-up areas, crops, and bare ground acted as firebreaks, water as an absolute barrier, and fire moved fastest through tree cover. Wind direction determined which way the fire advanced.

The remaining mismatch reflects factors the model cannot capture: where crews contained the fire, local microclimate, and terrain-channeled wind, none of which a spatially uniform wind field can represent.

## Project structure

```
ModelingWildfires/
├── webapp/                  Interactive web app
│   ├── index.html           Dashboards: California study area + sandbox
│   ├── js/model.js          Fire spread model (browser copy of firemodel.py)
│   └── data/                Study-area layers (layers.json) + real-fire images
├── scripts/                 Model, data pipeline, and tests
│   ├── firemodel.py         Fire spread model (original + corrected), IoU validation
│   ├── export_web_layers.py Earth Engine rasters → webapp/data/layers.json
│   ├── gee_export.js        Earth Engine export of land cover, NDVI, slope, elevation
│   ├── gee_burn_scar.js     Earth Engine export of fire imagery and burn severity (dNBR)
│   └── verify_port.mjs      Tests the browser model
├── data/                    Rabbit Fire perimeter (raster exports are gitignored)
└── archive/course-project/  Original Spring 2025 course notebooks, results, and report
```

## Run locally

```
cp webapp/js/config.example.js webapp/js/config.js   # then add your Mapbox public token
cd webapp && python3 -m http.server 8000             # open http://localhost:8000
```

To regenerate the study-area data: run `scripts/gee_export.js` and `scripts/gee_burn_scar.js` in the Earth Engine Code Editor and download the GeoTIFFs into `data/`, then:

```
pip install -r requirements.txt
python scripts/export_web_layers.py --in data --out webapp/data/layers.json --size 160
```

Run the model tests with `node scripts/verify_port.mjs`.

## Limitations

- **Empirical, not physics-based:** Physics-based models such as Rothermel's (1972) calculate fire spread rate in real units (m/min) from measured fuel properties and fuel moisture. This model uses land cover and vegetation greenness as fuel proxies in empirically fitted spread probabilities, so it has no fuel moisture and its timesteps are not tied to real time.
- **No firefighting:** Simulated perimeters represent unmitigated spread. Stopping runs at the observed burn area makes the comparison fair but does not model containment.
- **Uniform wind:** A single speed and direction applies to the whole grid for the whole fire.
- **Static vegetation:** Vegetation is one pre-fire snapshot rather than seasonally curing fuel.
- **Whole-step diagonal correction:** Diagonal spread takes 1.5× as long rather than exactly √2×.
- **One validation fire:** The model has been validated against the Rabbit Fire only.

## Next steps

- Introduce spatially and temporally varying wind from gridded reanalysis
- Run ensembles to produce burn probability maps rather than single perimeters
- Validate against additional fire events

## Background and attribution

This project began as a team project for a Modeling & Simulation course at Georgia Tech (Spring 2025). The original notebooks, results, and final report are preserved as submitted in `archive/course-project/`. The course version used an eight-layer ignition model that also included drought index, surface temperature, road proximity, and randomly generated placeholder rasters for lightning density and fire history; the web app keeps only the three observed layers.

**Team:** Katherine Losada, Thanawit Suwannikom, Gabriel Appiah, Kshitij Sawant

**My contributions to the course project:** Built the raster data pipeline for the fire spread model: acquired and preprocessed satellite imagery in Google Earth Engine, derived NDVI from Landsat 9, and reclassified Google Dynamic World land cover classes into vegetation fuel types. Aligned all layers to a common grid, resolution, and coordinate system in Python so they could drive the simulation.

The web app, data pipeline, model port, validation tools, and diagonal correction are my own independent work.

## References

- Alexandridis, A., Vakalis, D., Siettos, C. I., & Bafas, G. V. (2008). A cellular automata model for forest fire spread prediction: The case of the wildfire that swept through Spetses Island in 1990. *Applied Mathematics and Computation*, 204(1), 191–201.
- Key, C. H., & Benson, N. C. (2006). *Landscape assessment (LA): Sampling and analysis methods* (Gen. Tech. Rep. RMRS-GTR-164-CD). USDA Forest Service, Rocky Mountain Research Station.
- Rothermel, R. C. (1972). *A mathematical model for predicting fire spread in wildland fuels* (Research Paper INT-115). USDA Forest Service, Intermountain Forest and Range Experiment Station.
- Trucchia, A., D'Andrea, M., Baghino, F., Fiorucci, P., Ferraris, L., Negro, D., Gollini, A., & Severino, M. (2020). PROPAGATOR: An Operational Cellular-Automata Based Wildfire Simulator. *Fire*, 3(3), 26. https://doi.org/10.3390/fire3030026
