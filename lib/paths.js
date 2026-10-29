/**
 * Where the app keeps its state.
 *
 * On a computer that is the project folder, as it always was: reports and
 * prefs in output/, the LCR sign-in in lcr-session.json. In the cloud the
 * container's own disk is wiped on every deploy, so DATA_DIR points all of
 * it at the persistent volume instead (Dockerfile sets DATA_DIR=/data).
 */
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;

module.exports = {
  ROOT,
  OUTPUT_DIR: DATA_DIR ? path.join(DATA_DIR, "output") : path.join(ROOT, "output"),
  SESSION_PATH: path.join(DATA_DIR || ROOT, "lcr-session.json"),
  ACTION_ID_PATH: path.join(DATA_DIR || ROOT, "lcr-action.json"),
};
