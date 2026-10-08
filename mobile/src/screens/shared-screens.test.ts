import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(mobileRoot, "..");

const SHARED_MODULE = "../src/screens/inventory-ui";
const SCREEN_NAMES = ["Items", "ItemDetail", "ItemEdit", "Locations", "Search", "Maintenance", "PhotoAttach"] as const;

const IMPLEMENTATIONS: Record<(typeof SCREEN_NAMES)[number], string> = {
  Items: "src/screens/shared/Items.tsx",
  Locations: "src/screens/shared/Locations.tsx",
  Search: "src/screens/shared/Search.tsx",
  PhotoAttach: "src/screens/shared/PhotoAttach.tsx",
  ItemDetail: "src/screens/ItemDetailScreen.tsx",
  ItemEdit: "src/screens/ItemEditorScreen.tsx",
  Maintenance: "src/screens/MaintenanceScreen.tsx",
};

function exportedNames(source: string, specifier: string): string[] {
  const names: string[] = [];
  const pattern = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2] !== specifier) continue;
    for (const part of match[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const alias = trimmed.split(/\s+as\s+/);
      names.push((alias[1] ?? alias[0]).trim());
    }
  }
  return names;
}

test("the native entry and the web entry import the same inventory screen module", async () => {
  const native = await readFile(path.join(mobileRoot, "app/index.tsx"), "utf8");
  const web = await readFile(path.join(mobileRoot, "app/index.web.tsx"), "utf8");
  const nativeNames = exportedNames(native, SHARED_MODULE).sort();
  const webNames = exportedNames(web, SHARED_MODULE).sort();
  assert.deepEqual(nativeNames, [...SCREEN_NAMES].sort());
  assert.deepEqual(webNames, nativeNames);
  assert.match(native, /<SessionGate/);
  assert.match(web, /<SessionGate/);
  assert.doesNotMatch(web, /frontend\//);
  assert.doesNotMatch(web, /\.vue/);
});

test("shared screens are React Native primitives, not Vue wrappers", async () => {
  const barrel = await readFile(path.join(mobileRoot, "src/screens/inventory-ui.ts"), "utf8");
  for (const name of SCREEN_NAMES) {
    assert.match(barrel, new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`));
  }
  assert.doesNotMatch(barrel, /from ["']vue["']|from ["']nuxt|\.vue/);
  assert.equal(barrel.includes("frontend/"), false);

  for (const name of SCREEN_NAMES) {
    const relative = IMPLEMENTATIONS[name];
    const source = await readFile(path.join(mobileRoot, relative), "utf8");
    assert.match(source, /from ["']react-native["']/);
    assert.doesNotMatch(source, /from ["']vue["']|from ["']nuxt|\.vue|<template>/);
    assert.equal(source.includes("frontend/"), false, `${relative} must not wrap the Vue app`);
    const webFork = relative.replace(/\.tsx$/, ".web.tsx");
    const nativeFork = relative.replace(/\.tsx$/, ".native.tsx");
    await assert.rejects(readFile(path.join(mobileRoot, webFork), "utf8"));
    await assert.rejects(readFile(path.join(mobileRoot, nativeFork), "utf8"));
  }
});

test("a shared screen is not copied into the Vue frontend", async () => {
  const frontend = path.join(repoRoot, "frontend");
  const files = await walk(frontend);
  const copies = files.filter((file) => /inventory-ui|PhotoAttach|ItemDetailScreen|ItemEditorScreen/.test(path.basename(file)));
  assert.deepEqual(copies, []);
  const sources = files.filter((file) => /\.(vue|ts|tsx|js)$/.test(file));
  for (const file of sources) {
    const text = await readFile(file, "utf8");
    assert.equal(text.includes("screens/inventory-ui"), false, `${path.relative(repoRoot, file)} imports the shared screens`);
    assert.equal(text.includes("mobile/src/screens"), false, `${path.relative(repoRoot, file)} copies a phone screen`);
  }
});

test("only the scanner and secure storage are platform-specific", async () => {
  const screens = await readdir(path.join(mobileRoot, "src/screens"));
  const platformScreens = screens.filter((name) => /\.(web|native|ios|android)\.tsx$/.test(name));
  assert.deepEqual(platformScreens, ["ScanScreen.web.tsx"]);
  const session = await readdir(path.join(mobileRoot, "src/session"));
  assert.ok(session.includes("secure.ts"));
  assert.ok(session.includes("secure.web.ts"));
});

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".nuxt" || entry.name === ".output") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}
