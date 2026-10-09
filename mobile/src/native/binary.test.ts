import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
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

test("the release Android manifest allows HTTP self-hosted LAN servers", () => {
  const require = createRequire(import.meta.url);
  const { allowLanHttp } = require("../../plugins/lan-http.cjs");
  const manifest = { manifest: { application: [{ $: { "android:name": ".MainApplication" } }] } };
  allowLanHttp(manifest);
  assert.equal((manifest.manifest.application[0].$ as Record<string, string>)["android:usesCleartextTraffic"], "true");
  assert.equal(manifest.manifest.application[0].$["android:name"], ".MainApplication");
});

test("EAS builds do not use the ignored local sideload keystore", () => {
  const require = createRequire(import.meta.url);
  const plugin = require("../../plugins/sideload-signing.cjs");
  const previous = process.env.HOMEBOX_LOCAL_SIDELOAD;
  try {
    delete process.env.HOMEBOX_LOCAL_SIDELOAD;
    const config = { name: "HomeBox", slug: "homebox-mobile" };
    assert.equal(plugin(config), config);
    assert.equal("mods" in config, false);
    process.env.HOMEBOX_LOCAL_SIDELOAD = "1";
    const local = plugin({ ...config });
    assert.equal(typeof local.mods.android.appBuildGradle, "function");
  } finally {
    if (previous === undefined) delete process.env.HOMEBOX_LOCAL_SIDELOAD;
    else process.env.HOMEBOX_LOCAL_SIDELOAD = previous;
  }
});

test("a JavaScript-only update is not enabled until an Expo project is linked", async () => {
  const configSource = await readFile(path.join(mobileRoot, "app.config.ts"), "utf8");
  assert.match(configSource, /EAS_PROJECT_ID/);
  assert.match(configSource, /enabled: false/);
  assert.match(configSource, /u\.expo\.dev/);
  assert.doesNotMatch(configSource, /homebox\.db/);
});
