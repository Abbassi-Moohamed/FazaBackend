import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function loadProductionConfig(appAdminPin: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", "await import('./src/config/env.ts')"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        ADMIN_SECRET: "production-secret-with-sufficient-length",
        APP_ADMIN_PIN: appAdminPin,
      },
    },
  );
}

describe("production environment configuration", () => {
  it("rejects the documented development app-admin PIN", () => {
    const result = loadProductionConfig("3219");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("APP_ADMIN_PIN must be overridden in production");
  });

  it("accepts a configured production app-admin PIN", () => {
    const result = loadProductionConfig("8462");

    expect(result.status).toBe(0);
  });
});
