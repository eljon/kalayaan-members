/**
 * App version. Bump this integer on every release.
 *
 * The number is shown in the UI (baked into each front-end via the
 * <meta name="app-version"> tag) so you can tell whether you are running
 * the latest. The server also reports it at /api/state, and the UI flags
 * when the page you are viewing is older than the server.
 *
 * Every release also snapshots the front-end into public/_versions/<n>/,
 * which the server serves at /v<n> so you can revert to an earlier one.
 */
module.exports = { version: 34 };
