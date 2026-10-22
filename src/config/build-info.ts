import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  /** Commit the running artifact was built from ("unknown" outside a build). */
  commit: string;
  /** ISO timestamp of the build. */
  builtAt: string;
}

/**
 * Reads `dist/build-info.json`, written by `scripts/write-build-info.mjs`
 * right after the TypeScript build.
 *
 * The file lives next to the compiled output (`dist/build-info.json`), one
 * level above the `config/` folder of the compiled module. Outside a build
 * (tests, `tsx src/server.ts`) the file does not exist and the identity stays
 * "unknown".
 */
function loadBuildInfo(): BuildInfo {
  const fallback: BuildInfo = { commit: "unknown", builtAt: "unknown" };
  try {
    const path = fileURLToPath(new URL("../build-info.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BuildInfo>;
    return {
      commit: typeof parsed.commit === "string" && parsed.commit ? parsed.commit : fallback.commit,
      builtAt: typeof parsed.builtAt === "string" && parsed.builtAt ? parsed.builtAt : fallback.builtAt,
    };
  } catch {
    return fallback;
  }
}

export const buildInfo: BuildInfo = loadBuildInfo();
