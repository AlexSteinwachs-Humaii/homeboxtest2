const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

// The native project is generated into ios/ and android/, which the source
// scan skips. Refuse an inventory database or Go sources landing in that tree
// before Gradle or Xcode ever compile it.

const SKIP = new Set(["node_modules", ".expo", "dist", "build", ".gradle"]);

function forbiddenName() {
  return ["homebox", "db"].join(".");
}

function walk(dir, found) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
      continue;
    }
    if (entry.name === forbiddenName() || entry.name.endsWith(".go")) {
      found.push(full);
    }
  }
}

function assertNativeTree(root, platform) {
  const found = [];
  walk(path.join(root, platform), found);
  if (found.length > 0) {
    throw new Error(`Native ${platform} project must not contain inventory data or Go: ${found.join(", ")}`);
  }
}

function forbidLocalInventory(config) {
  let next = config;
  for (const platform of ["android", "ios"]) {
    next = withDangerousMod(next, [
      platform,
      async (mod) => {
        assertNativeTree(mod.modRequest.projectRoot, platform);
        return mod;
      },
    ]);
  }
  return next;
}

module.exports = forbidLocalInventory;
