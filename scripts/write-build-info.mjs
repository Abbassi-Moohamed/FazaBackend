#!/usr/bin/env node
/**
 * Writes the build identity into the compiled artifact.
 *
 * The deployed service must be able to answer "which commit is running?".
 * The host injects the commit while building (Render sets RENDER_GIT_COMMIT,
 * Cloudflare sets SOURCE_VERSION, the CI sets GIT_SHA), but those variables
 * are not guaranteed to be present at runtime, so the value is baked into
 * `dist/build-info.json` and read back by the health endpoint.
 *
 * Usage: node scripts/write-build-info.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(projectRoot, "dist", "build-info.json");

const commit = (
  process.env.RENDER_GIT_COMMIT ??
  process.env.GIT_SHA ??
  process.env.SOURCE_VERSION ??
  process.env.COMMIT_SHA ??
  ""
).trim();

const info = {
  commit: commit || "unknown",
  builtAt: new Date().toISOString(),
  node: process.version,
};

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(info, null, 2)}\n`, "utf8");

console.log(`build info written to ${target} (commit=${info.commit})`);
