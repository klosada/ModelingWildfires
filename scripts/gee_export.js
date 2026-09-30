/*
 * gee_export.js  --  Google Earth Engine Code Editor script.
 *
 * Exports four PIXEL-ALIGNED GeoTIFFs for the Rabbit Fire study area to Google
 * Drive, for the California dashboard:
 *
 *     1. landuse.tif      Dynamic World land cover (label band, mode composite)
 *     2. NDVI.tif         Sentinel-2 NDVI (cloud-masked, median composite)
 *     3. SlopeExport.tif  Slope in degrees (from SRTM)
 *     4. DEM.tif          Raw SRTM elevation (the web bundler derives hillshade)
 *
 * All four share the SAME region, scale (30 m), and crs (EPSG:4326) so they
 * come out on the same grid.
 */

// ============================ CONFIG =======================================
// Rabbit Fire ignition point.
var IGNITION = ee.Geometry.Point([-117.02139, 33.89148]);  // [lon, lat]

// Study-area radius around the ignition point, in metres. The Rabbit Fire
// (July 2023) burned ~8,000 acres (~6 km across); ~8 km gives surrounding
// context.
var RADIUS_M = 8000;

// Export grid resolution (metres). Keep at 30 for all layers -> aligned grid.
var SCALE = 30;
var CRS = 'EPSG:4326';

// Pre-fire window for land cover and NDVI: the two weeks BEFORE the fire, so
// they reflect conditions at ignition (7 Sentinel-2 passes, Jun 27 - Jul 12).
// Same window as the pre-fire imagery in gee_burn_scar.js. Rabbit Fire started
// 2023-07-14; filterDate's end is exclusive.
var DATE_START = '2023-06-27';
var DATE_END   = '2023-07-13';

// Region: a square bounding box around the ignition point. bounds() gives an
// axis-aligned rectangle so every export uses an identical footprint.
var REGION = IGNITION.buffer(RADIUS_M).bounds();

// ==================== 1. LAND COVER (Dynamic World) ========================
// GOOGLE/DYNAMICWORLD/V1 'label' band = per-pixel argmax class:
//   0 water          1 trees            2 grass
//   3 flooded veg    4 crops            5 shrub & scrub
//   6 built          7 bare             8 snow & ice
// mode() over the window = most frequent class per pixel (a stable composite).
var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(REGION)
  .filterDate(DATE_START, DATE_END)
  .select('label');
var landcover = dw.reduce(ee.Reducer.mode()).rename('label').clip(REGION);

// ==================== 2. NDVI (Sentinel-2 SR) ==============================
// Cloud-mask with the Scene Classification (SCL) band: drop cloud shadow (3),
// clouds (8, 9), cirrus (10), and snow (11). Same satellite as Dynamic World
// and the fire imagery. NDVI = (NIR - Red)/(NIR + Red) from B8 (NIR), B4 (Red).
function maskS2(img) {
  var scl = img.select('SCL');
  var clear = scl.neq(3).and(scl.neq(8)).and(scl.neq(9))
    .and(scl.neq(10)).and(scl.neq(11));
  return img.select(['B4', 'B8']).updateMask(clear);
}
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(REGION)
  .filterDate(DATE_START, DATE_END)
  .map(maskS2);
var ndvi = s2.median()
  .normalizedDifference(['B8', 'B4'])  // (NIR - Red)/(NIR + Red)
  .rename('NDVI')
  .clip(REGION);
print('Sentinel-2 images in window:', s2.size());

// ==================== 3. SLOPE + 4. DEM (SRTM) =============================
var dem = ee.Image('USGS/SRTMGL1_003').select('elevation').clip(REGION);
var slope = ee.Terrain.slope(dem).rename('slope').clip(REGION);  // degrees

// =============================== PREVIEWS ===================================
Map.centerObject(REGION, 12);
Map.addLayer(REGION, {color: 'white'}, 'Study area', false);
var dwViz = {
  min: 0, max: 8,
  palette: ['#419bdf', '#397d49', '#88b053', '#7a87c6', '#e49635',
            '#dfc35a', '#c4281b', '#a59b8f', '#b39fe1']
};
Map.addLayer(landcover, dwViz, 'Land cover (DW)');
Map.addLayer(ndvi, {min: -0.1, max: 0.85,
  palette: ['#a52a2a', '#ffff00', '#006400']}, 'NDVI');
Map.addLayer(slope, {min: 0, max: 40,
  palette: ['#ffffff', '#41b6c4', '#225ea8']}, 'Slope (deg)');
Map.addLayer(dem, {min: 200, max: 1800,
  palette: ['#2c7bb6', '#ffffbf', '#d7191c']}, 'DEM (m)', false);
Map.addLayer(IGNITION, {color: 'red'}, 'Ignition point');

// =============================== EXPORTS ===================================
// Every task uses the SAME region, scale, and crs -> aligned output grids.
var FOLDER = 'ModelingWildfires';

Export.image.toDrive({
  image: landcover, description: 'landuse', fileNamePrefix: 'landuse',
  folder: FOLDER, region: REGION, scale: SCALE, crs: CRS, maxPixels: 1e9
});

Export.image.toDrive({
  image: ndvi, description: 'NDVI', fileNamePrefix: 'NDVI',
  folder: FOLDER, region: REGION, scale: SCALE, crs: CRS, maxPixels: 1e9
});

Export.image.toDrive({
  image: slope, description: 'SlopeExport', fileNamePrefix: 'SlopeExport',
  folder: FOLDER, region: REGION, scale: SCALE, crs: CRS, maxPixels: 1e9
});

Export.image.toDrive({
  image: dem, description: 'DEM', fileNamePrefix: 'DEM',
  folder: FOLDER, region: REGION, scale: SCALE, crs: CRS, maxPixels: 1e9
});

print('Study area bounds:', REGION);
print('Configured for Rabbit Fire. Start the 4 tasks in the Tasks tab ->');
