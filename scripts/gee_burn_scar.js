/*
 * gee_burn_scar.js  --  Google Earth Engine Code Editor script.
 *
 * Real Rabbit Fire (July 14, 2023) imagery from Sentinel-2 (10 m), over the
 * SAME study area as gee_export.js, for the California dashboard:
 *
 *     1. Pre-fire true color     median composite, Jun 27 - Jul 12, 2023
 *     2. During-fire true color  single pass, Jul 17, 2023
 *     3. dNBR (burn severity)    pre-fire NBR minus post-fire NBR
 *                                (post-fire composite: Jul 20 - Jul 31, 2023)
 *
 * The dNBR export is raw values. scripts/export_web_layers.py classifies it and
 * keeps severity only inside the CAL FIRE perimeter (outside = unburned), so
 * seasonal drying of crops and grass outside the fire isn't counted as burn.
 */

// ============================ CONFIG =======================================
// Rabbit Fire ignition point and study area (same as gee_export.js).
var IGNITION = ee.Geometry.Point([-117.02139, 33.89148]);  // [lon, lat]
var RADIUS_M = 8000;
var REGION = IGNITION.buffer(RADIUS_M).bounds();
var CRS = 'EPSG:4326';
var SCALE = 10;   // Sentinel-2 visible/NIR resolution (m)

// Short, close windows on both sides of the fire, so dNBR reflects the fire
// rather than seasonal drying. filterDate's end is exclusive.
var PRE_START = '2023-06-27', PRE_END = '2023-07-13';    // passes Jun 27 - Jul 12
var POST_START = '2023-07-20', POST_END = '2023-08-01';  // passes Jul 22 - Jul 29
var DURING_DATE = '2023-07-17';                          // mid-fire pass

// ======================== SENTINEL-2 IMAGERY ===============================
var BANDS = ['B2', 'B3', 'B4', 'B8', 'B12'];   // blue, green, red, NIR, SWIR2

// Surface reflectance, cloud-masked with the Scene Classification (SCL) band:
// drop cloud shadow (3), clouds (8, 9), cirrus (10), and snow (11).
function maskS2(img) {
  var scl = img.select('SCL');
  var clear = scl.neq(3).and(scl.neq(8)).and(scl.neq(9))
    .and(scl.neq(10)).and(scl.neq(11));
  return img.select(BANDS).divide(10000).updateMask(clear)
    .copyProperties(img, ['system:time_start']);
}

// Per-pixel median of all clear passes in a window (filters clouds and haze).
function composite(start, end) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(REGION).filterDate(start, end)
    .map(maskS2).median().clip(REGION);
}

// One day's pass, unmasked (the smoke is the point); mosaic joins the tiles.
function singlePass(date) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(REGION).filterDate(date, ee.Date(date).advance(1, 'day'))
    .select(BANDS).mosaic().divide(10000).clip(REGION);
}

var pre = composite(PRE_START, PRE_END);
var post = composite(POST_START, POST_END);
var during = singlePass(DURING_DATE);

// ===================== BURN SEVERITY (dNBR) ================================
// NBR = (NIR - SWIR2) / (NIR + SWIR2); burning drops NIR and raises SWIR2,
// so NBR falls. dNBR = pre - post (higher = more severe burn).
function nbr(img) { return img.normalizedDifference(['B8', 'B12']); }
var dnbr = nbr(pre).subtract(nbr(post)).rename('dNBR');

// Preview only (the dashboard classes are made in Python, inside the perimeter).
// USGS thresholds (Key & Benson 2006), moderate-low + moderate-high merged:
//   < 0.10 unburned, 0.10-0.27 low, 0.27-0.66 moderate, >= 0.66 high.
var severity = ee.Image(0)
  .where(dnbr.gte(0.10), 1).where(dnbr.gte(0.27), 2).where(dnbr.gte(0.66), 3)
  .clip(REGION);
var SEV_NAMES = ['Unburned', 'Low', 'Moderate', 'High'];
var SEV_COLORS = ['#1a9850', '#fee08b', '#f46d43', '#a50026'];

// ============================ VISUALS =====================================
var trueViz = {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3, gamma: 1.2};
var preTrue = pre.visualize(trueViz);
var duringTrue = during.visualize(trueViz);
var sevRgb = severity.visualize({min: 0, max: 3, palette: SEV_COLORS});

Map.centerObject(REGION, 12);
Map.addLayer(preTrue, {}, 'Pre-fire true color (Jun 27 - Jul 12)');
Map.addLayer(duringTrue, {}, 'During fire true color (Jul 17)');
Map.addLayer(post.visualize(trueViz), {}, 'Post-fire true color (Jul 20 - 31)', false);
Map.addLayer(sevRgb, {}, 'Burn severity preview (not yet clipped to perimeter)', false);
Map.addLayer(IGNITION, {color: 'red'}, 'Ignition point');

// Severity legend (bottom left of the map).
var legend = ui.Panel({style: {position: 'bottom-left', padding: '6px 10px'}});
legend.add(ui.Label('Burn severity (dNBR)', {fontWeight: 'bold'}));
SEV_NAMES.forEach(function (name, i) {
  legend.add(ui.Panel([
    ui.Label('', {backgroundColor: SEV_COLORS[i], padding: '8px', margin: '2px 6px 2px 0'}),
    ui.Label(name, {margin: '2px 0'})
  ], ui.Panel.Layout.Flow('horizontal')));
});
Map.add(legend);

// ========================= PNG DOWNLOAD LINKS ==============================
function pngLink(img, name) {
  print(name, img.getThumbURL({region: REGION, dimensions: 1600, format: 'png', crs: CRS}));
}
pngLink(preTrue, 'Pre-fire true color PNG:');
pngLink(duringTrue, 'During fire (Jul 17) true color PNG:');

// ============================== EXPORTS ====================================
// Same footprint and crs as gee_export.js, so layers line up with the model grid.
var FOLDER = 'ModelingWildfires';

Export.image.toDrive({
  image: preTrue, description: 'S2_prefire_truecolor', fileNamePrefix: 'S2_prefire_truecolor',
  folder: FOLDER, region: REGION, scale: SCALE, crs: CRS, maxPixels: 1e9
});

Export.image.toDrive({
  image: duringTrue, description: 'S2_during_20230717_truecolor', fileNamePrefix: 'S2_during_20230717_truecolor',
  folder: FOLDER, region: REGION, scale: SCALE, crs: CRS, maxPixels: 1e9
});

Export.image.toDrive({
  image: dnbr, description: 'dNBR', fileNamePrefix: 'dNBR',
  folder: FOLDER, region: REGION, scale: SCALE, crs: CRS, maxPixels: 1e9
});

print('Rabbit Fire imagery. Start the 3 exports in the Tasks tab ->');
