/*
 * gee_export.js  --  Google Earth Engine Code Editor script.
 *
 * Exports four PIXEL-ALIGNED GeoTIFFs for the Rabbit Fire study area to Google
 * Drive, for the California dashboard:
 *
 *     1. landuse.tif      Dynamic World land cover (label band, mode composite)
 *     2. NDVI.tif         Landsat 9 NDVI (cloud-masked, median composite)
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

// Pre-burn vegetation window: the weeks BEFORE the fire, so NDVI reflects
// fuel conditions at ignition rather than the burn scar. Rabbit Fire started
// 2023-07-14; filterDate's end is exclusive, so this covers May 1 - July 12.
var DATE_START = '2023-05-01';
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

// ==================== 2. NDVI (Landsat 9 Level-2 SR) =======================
// Cloud-mask using the QA_PIXEL bitmask, apply the L2 SR scale factors, then
// NDVI = (NIR - Red)/(NIR + Red) from SR_B5 (NIR) and SR_B4 (Red).
function maskL9sr(img) {
  var qa = img.select('QA_PIXEL');
  // Bit 1 = dilated cloud, 3 = cloud, 4 = cloud shadow.
  var mask = qa.bitwiseAnd(1 << 1).eq(0)
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0));
  // Official Collection-2 Level-2 optical scaling.
  var sr = img.select(['SR_B4', 'SR_B5'])
    .multiply(0.0000275).add(-0.2);
  return sr.updateMask(mask).copyProperties(img, ['system:time_start']);
}
var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
  .filterBounds(REGION)
  .filterDate(DATE_START, DATE_END)
  .map(maskL9sr);
var ndvi = l9.median()
  .normalizedDifference(['SR_B5', 'SR_B4'])  // (NIR - Red)/(NIR + Red)
  .rename('NDVI')
  .clip(REGION);

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
