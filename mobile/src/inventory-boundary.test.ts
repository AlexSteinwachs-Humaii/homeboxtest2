import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN = [
  "homebox.db",
  "bun:sqlite",
  "expo-sqlite",
  "better-sqlite3",
  "sql.js",
  "react-native-sqlite-storage",
  "HBOX_DATABASE",
  "HBOX_STORAGE",
  "from \"backend",
  "from 'backend",
  "from \"server/",
  "from 'server/",
];

const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "ios", "android"]);

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await filesUnder(full)));
    } else {
      found.push(full);
    }
  }
  return found;
}

test("the Expo app does not embed an inventory database or read the server blob directory", async () => {
  const files = await filesUnder(mobileRoot);
  assert.ok(files.some((file) => file.endsWith(`${path.sep}app${path.sep}index.tsx`)), "expected an Expo Router screen, not an API route");
  assert.equal(
    files.some((file) => file.endsWith(".go")),
    false,
  );
  assert.equal(
    files.some((file) => path.basename(file) === "homebox.db" || file.endsWith(".db")),
    false,
  );
  assert.equal(
    files.some((file) => file.includes(`${path.sep}app${path.sep}api${path.sep}`) || path.basename(file).includes("+api.")),
    false,
  );

  const packageJson = JSON.parse(await readFile(path.join(mobileRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const name of ["expo-sqlite", "better-sqlite3", "sql.js", "react-native-sqlite-storage"]) {
    assert.equal(deps[name], undefined, `${name} must not be a dependency`);
  }
  assert.ok(deps.expo, "expected an Expo project");
  assert.ok(deps["expo-router"], "expected Expo Router for screens");
  assert.equal(deps["expo-sqlite"], undefined);

  const source = files.filter((file) => /\.(ts|tsx|js|cjs|mjs|json)$/.test(file) && !file.endsWith(".test.ts"));
  for (const file of source) {
    const info = await stat(file);
    assert.ok(info.size < 1_000_000, `${file} is unexpectedly large for this client`);
    const text = await readFile(file, "utf8");
    for (const needle of FORBIDDEN) {
      assert.equal(text.includes(needle), false, `${path.relative(mobileRoot, file)} contains ${needle}`);
    }
  }
});
