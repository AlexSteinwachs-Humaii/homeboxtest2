import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(mobileRoot, "..");

test("the Expo web shell is not the Nuxt app and does not open the inventory database", async () => {
  const shell = await readFile(path.join(mobileRoot, "public/index.html"), "utf8");
  assert.match(shell, /name="homebox-client" content="expo-web"/);
  assert.match(shell, /id="expo-reset"/);
  assert.match(shell, /id="root"/);
  assert.equal(shell.includes("__NUXT__"), false);
  assert.equal(shell.toLowerCase().includes("nuxt"), false);
  assert.equal(shell.includes("homebox.db"), false);

  const pkg = JSON.parse(await readFile(path.join(mobileRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.match(pkg.scripts?.["export:web"] ?? "", /expo export --platform web/);

  const appFiles = await walk(path.join(mobileRoot, "app"));
  assert.equal(
    appFiles.some((file) => file.includes(`${path.sep}api${path.sep}`) || path.basename(file).includes("+api.")),
    false,
    "inventory mutations must not go through an Expo API route",
  );
});

test("the website login asks only for email and password", async () => {
  const signIn = await readFile(path.join(mobileRoot, "src/screens/SignInScreen.tsx"), "utf8");
  assert.match(signIn, /const showServerAddress = Platform\.OS !== "web"/);
  assert.match(signIn, /label="Email"/);
  assert.match(signIn, /label="Password"/);
  const webBranch = signIn.slice(signIn.indexOf('if (Platform.OS === "web")'));
  assert.equal(webBranch.includes("Server address"), false);
  assert.match(signIn, /label="Server address"/, "the phone sign-in still names a remote server");
});

test("the browser chrome follows the original HomeBox website, not the phone list", async () => {
  const shell = await readFile(path.join(mobileRoot, "src/screens/WebShell.tsx"), "utf8");
  const theme = await readFile(path.join(mobileRoot, "src/theme.ts"), "utf8");
  assert.match(shell, /Welcome,/);
  assert.match(shell, /label: "Home"/);
  assert.match(shell, /label: "Locations"/);
  assert.match(shell, /label: "Search"/);
  assert.match(shell, /label: "Maintenance"/);
  assert.match(shell, /label: "Profile"/);
  assert.match(shell, /Sign out/);
  assert.match(shell, /accessibilityLabel="New item"/);
  assert.match(theme, /canvas: "#cfcfcf"/);
  assert.match(theme, /primary: "#5c7f67"/);
  assert.match(theme, /header: "#2a2f28"/);
  assert.match(theme, /sidebar: "#e6e6e6"/);
  assert.equal(shell.includes("frontend/"), false);
  assert.equal(shell.includes(".vue"), false);

  const list = await readFile(path.join(mobileRoot, "src/screens/InventoryScreen.tsx"), "utf8");
  assert.match(list, /Platform.OS === "web"/);
  assert.doesNotMatch(list, /Pulled from the server[\s\S]*Platform\.OS === "web"/);
});

test("production images serve the Expo web export from Bun and omit the Nuxt output", async () => {
  for (const name of ["Dockerfile", "Dockerfile.rootless", "Dockerfile.hardened"]) {
    const text = await readFile(path.join(repoRoot, name), "utf8");
    assert.match(text, /pnpm run export:web/);
    assert.match(text, /HBOX_STATIC_DIR=\/app\/web/);
    assert.match(text, /EXPOSE 7745/);
    assert.match(text, /VOLUME \[ "\/data" \]/);
    assert.equal(text.includes("frontend"), false, `${name} must not copy the Nuxt app`);
    assert.equal(text.includes(".output"), false, `${name} must not copy frontend/.output`);
    assert.equal(text.toLowerCase().includes("golang"), false);
    assert.equal(text.includes("go build"), false);
  }
  const ignore = await readFile(path.join(repoRoot, ".dockerignore"), "utf8");
  assert.match(ignore, /^frontend$/m);
});

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}
