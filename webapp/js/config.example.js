/*
 * Copy this file to  webapp/js/config.js  and paste your Mapbox public token.
 * config.js is gitignored so your token never gets committed.
 *
 * Get a token at https://account.mapbox.com/access-tokens/ (starts with "pk.").
 * IMPORTANT: restrict the public token to your portfolio domain in the Mapbox
 * account (URL restrictions) so it can't be reused elsewhere. On Vercel, config.js
 * is written at build time from the MAPBOX_TOKEN environment variable (vercel.json).
 *
 * The California map needs this. The sandbox works without it.
 */
window.WILDFIRE_CONFIG = {
  MAPBOX_TOKEN: "pk.your_public_token_here",
};
