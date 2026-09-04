const fs = require("node:fs");
const path = require("node:path");

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn("Could not read " + filePath + "; using defaults:", error.message);
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

module.exports = { ensureParentDirectory, readJson, writeJson };
