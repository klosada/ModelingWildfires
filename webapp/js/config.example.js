/*
 * Copy this file to  webapp/js/config.js  and paste your Mapbox public token.
 * config.js is gitignored so your token never gets committed.
 *
 * Get a token at https://account.mapbox.com/access-tokens/ (starts with "pk.").
 * IMPORTANT: restrict the public token to your portfolio + GitHub Pages domains
 * in the Mapbox account (URL restrictions) so it can't be reused elsewhere.
 *
 * The California map needs this. The sandbox works without it.
 */
window.WILDFIRE_CONFIG = {
  MAPBOX_TOKEN: "pk.your_public_token_here",
};
