// The registered preview command runs `pnpm run export:web` and serves mobile/dist.
// This enhancement must serve the Vue site, so replace that export with the Nuxt generate output.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.resolve(mobileRoot, "../frontend");
const generated = path.join(frontend, ".output", "public");
const dist = path.join(mobileRoot, "dist");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("pnpm", ["install", "--frozen-lockfile"], frontend);
run("pnpm", ["run", "build"], frontend);

const index = path.join(generated, "index.html");
if (!existsSync(index)) {
  console.error(`Vue generate did not write ${index}`);
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
cpSync(generated, dist, { recursive: true });
console.log(`served Vue website at ${dist}`);
