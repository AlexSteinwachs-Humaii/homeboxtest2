import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertNativeBuildConfig, type NativeBuildConfig } from "./binary";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the Expo project can produce a sideloadable native binary without an inventory database", async () => {
  const app = JSON.parse(await readFile(path.join(mobileRoot, "app.json"), "utf8")).expo;
  const eas = JSON.parse(await readFile(path.join(mobileRoot, "eas.json"), "utf8"));
  const pkg = JSON.parse(await readFile(path.join(mobileRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const config: NativeBuildConfig = {
    app,
    eas,
    scripts: pkg.scripts,
    dependencies: { ...pkg.dependencies, ...pkg.devDependencies },
  };
  assert.deepEqual(assertNativeBuildConfig(config), []);
});

test("a JavaScript-only update is not enabled until an Expo project is linked", async () => {
  const configSource = await readFile(path.join(mobileRoot, "app.config.ts"), "utf8");
  assert.match(configSource, /EAS_PROJECT_ID/);
  assert.match(configSource, /enabled: false/);
  assert.match(configSource, /u\.expo\.dev/);
  assert.doesNotMatch(configSource, /homebox\.db/);
});
