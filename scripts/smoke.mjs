#!/usr/bin/env node
/**
 * Production smoke test for the Faza API.
 *
 * The API and the frontend are deployed independently, so a route can be
 * missing on the live service while the code in the repository is correct.
 * That drift is invisible in unit tests and only shows up as a 404 in the
 * browser, which is exactly how it was found last time: the admin console
 * silently lost the tables endpoint and the visitor lost the session orders
 * endpoint.
 *
 * This script checks the live service the way a browser would:
 *
 *   - every critical route must answer. A `404` carrying "Route not found"
 *     means the deployed build predates the route and fails the check, while
 *     an authenticated `401` or a domain `404` proves the route exists.
 *   - `/health` reports the build identity (`buildSha`), so a deploy can be
 *     tied to the commit that was pushed.
 *
 * Usage:
 *   node scripts/smoke.mjs --url https://menuscanapis.onrender.com
 *   node scripts/smoke.mjs --url https://api.example.com --sha abc123 --wait 600
 *
 * Flags:
 *   --url <origin>     API origin to test (default: https://menuscanapis.onrender.com)
 *   --sha <sha>        commit the live build must report
 *   --wait <seconds>   poll until the new build answers (default: 0 = check once)
 *   --timeout <ms>     per-request timeout (default: 20000)
 */

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const baseUrl = (flag("url", "https://menuscanapis.onrender.com") || "").replace(/\/+$/, "");
const expectedSha = flag("sha", "");
const waitSeconds = Number(flag("wait", "0")) || 0;
const timeoutMs = Number(flag("timeout", "20000")) || 20000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}

/** A missing route is a 404 whose message says so; a domain 404 is not. */
function isRouteMissing(result) {
  const message = result.body?.message;
  return result.status === 404 && typeof message === "string" && message.startsWith("Route not found");
}

/**
 * The routes that must exist for the product to work. The two session/table
 * routes are the ones that drifted: the admin console lost the tables route
 * and the visitor lost the session orders route.
 */
async function checkRoutes() {
  const results = [];

  const orders = await request(`/api/v1/orders?sessionToken=${"0".repeat(32)}`);
  results.push({
    name: "GET /api/v1/orders exists (visitor session orders)",
    ok: !isRouteMissing(orders),
    detail: isRouteMissing(orders) ? "route is missing from the deployed build" : `status=${orders.status}`,
  });

  const tables = await request("/api/v1/admin/my-coffee/tables");
  results.push({
    name: "GET /api/v1/admin/my-coffee/tables exists (admin tables)",
    ok: !isRouteMissing(tables),
    detail: isRouteMissing(tables) ? "route is missing from the deployed build" : `status=${tables.status}`,
  });

  const shift = await request("/api/v1/admin/my-coffee/service-shifts/current");
  results.push({
    name: "GET /api/v1/admin/my-coffee/service-shifts/current exists (admin shift)",
    ok: !isRouteMissing(shift),
    detail: isRouteMissing(shift) ? "route is missing from the deployed build" : `status=${shift.status}`,
  });

  const sessions = await request("/api/v1/admin/my-coffee/table-sessions");
  results.push({
    name: "GET /api/v1/admin/my-coffee/table-sessions exists (admin sessions)",
    ok: !isRouteMissing(sessions),
    detail: isRouteMissing(sessions) ? "route is missing from the deployed build" : `status=${sessions.status}`,
  });

  const menu = await request("/api/v1/coffees/does-not-exist");
  results.push({
    name: "GET /api/v1/coffees/:slug reaches the data layer",
    ok: !isRouteMissing(menu),
    detail: isRouteMissing(menu) ? "route is missing from the deployed build" : `status=${menu.status}`,
  });

  return results;
}

async function checkHealth() {
  const results = [];

  const health = await request("/health");
  results.push({
    name: "/health answers",
    ok: health.status === 200 && health.body?.status === "ok",
    detail: `status=${health.status}`,
  });

  const buildSha = health.body?.buildSha;
  if (expectedSha) {
    // A specific commit was requested: the live build must report it. The
    // identity is baked into the artifact by `scripts/write-build-info.mjs`,
    // so a build that cannot report it is a misconfigured host, not a
    // tolerable condition.
    results.push({
      name: "the live build reports the expected commit",
      ok: typeof buildSha === "string" && buildSha !== "unknown" && buildSha.startsWith(expectedSha.slice(0, 7)),
      detail: `buildSha=${buildSha ?? "n/a"} expected=${expectedSha.slice(0, 7)}`,
    });
  } else {
    results.push({
      name: "the live build reports its commit (informational)",
      ok: true,
      detail: `buildSha=${buildSha ?? "n/a"}`,
    });
  }

  const ready = await request("/health/ready");
  results.push({
    name: "/health/ready reports the database up",
    ok: ready.status === 200 && ready.body?.database === "up",
    detail: `status=${ready.status}`,
  });

  const root = await request("/");
  results.push({
    name: "API root is self-describing",
    ok: root.status === 200 && root.body?.data?.apiVersion === "v1",
    detail: `status=${root.status}`,
  });

  return { results, buildSha };
}

function shaMatches(buildSha) {
  if (!expectedSha) return true;
  if (!buildSha || buildSha === "unknown") return false;
  return buildSha.startsWith(expectedSha.slice(0, 7));
}

async function runOnce(label) {
  console.log(label);
  const health = await checkHealth();
  const routes = await checkRoutes();
  const all = [...health.results, ...routes];
  for (const check of all) {
    console.log(`${check.ok ? "  ok  " : "  FAIL"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  const shaOk = shaMatches(health.buildSha);
  const routesOk = routes.every((check) => check.ok);
  const healthOk = health.results.every((check) => check.ok);
  return { ok: routesOk && healthOk && shaOk, checks: all };
}

async function main() {
  console.log(`Faza API smoke test → ${baseUrl}`);

  if (waitSeconds > 0) {
    const deadline = Date.now() + waitSeconds * 1000;
    let outcome = { ok: false, checks: [] };
    while (Date.now() < deadline) {
      outcome = await runOnce("\nChecking the live API…");
      if (outcome.ok) break;
      console.log("  … not live yet, retrying in 10s");
      await sleep(10000);
    }
    if (!outcome.ok) {
      console.error("\nThe live API never satisfied the checks. The deploy did not go live.");
      process.exit(1);
    }
  } else {
    const outcome = await runOnce("\nChecking the live API…");
    if (!outcome.ok) {
      console.error(`\n${outcome.checks.filter((check) => !check.ok).length}/${outcome.checks.length} checks failed.`);
      process.exit(1);
    }
  }

  console.log("\nAll checks passed.");
}

main().catch((error) => {
  console.error("Smoke test could not run:", error instanceof Error ? error.message : error);
  process.exit(1);
});
