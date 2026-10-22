#!/usr/bin/env node
/**
 * Triggers a Render deploy for the Faza API.
 *
 * Two mechanisms are supported, in order of preference:
 *
 *   1. Render API (recommended): `RENDER_API_KEY` + `RENDER_SERVICE_ID`.
 *      The deploy is created for a specific commit and its status is polled,
 *      so the CI/CD job fails when the build fails instead of silently
 *      "succeeding" while the old instance keeps serving traffic.
 *   2. Render deploy hook: `RENDER_DEPLOY_HOOK_URL` only. One secret, no
 *      polling — the readiness check in `scripts/smoke.mjs` then confirms that
 *      the new build is live.
 *
 * Usage:
 *   node scripts/deploy-render.mjs --sha <commit>
 *   node scripts/deploy-render.mjs --sha <commit> --dry-run
 *
 * Environment:
 *   RENDER_API_KEY       workspace API key (Render dashboard → Account Settings → API Keys)
 *   RENDER_SERVICE_ID    the service id of the API service (the service URL ends with /svc/<id>)
 *   RENDER_DEPLOY_HOOK_URL  deploy hook URL, used when the API key is absent
 */

const args = process.argv.slice(2);

function flag(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const apiKey = process.env.RENDER_API_KEY ?? "";
const serviceId = process.env.RENDER_SERVICE_ID ?? "";
const hookUrl = process.env.RENDER_DEPLOY_HOOK_URL ?? "";
const commitId = flag("sha", process.env.GITHUB_SHA ?? "");
const dryRun = args.includes("--dry-run");
const apiBase = "https://api.render.com/v1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IN_PROGRESS = new Set(["queued", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"]);
const FAILED = new Set(["build_failed", "pre_deploy_failed", "update_failed", "canceled", "deactivated"]);

async function render(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}
async function latestDeploy() {
  const result = await render(`/services/${serviceId}/deploys?limit=1`);
  if (result.status >= 400) {
    throw new Error(`Render API ${result.status}: ${result.text}`);
  }
  const list = Array.isArray(result.body) ? result.body : (result.body?.data ?? []);
  return list[0] ?? null;
}

async function createDeploy() {
  const result = await render(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify({ commitId, clearCache: "do_not_clear" }),
  });
  if (result.status >= 400) {
    const message = result.body?.message ?? result.text;
    throw new Error(`Render refused the deploy (${result.status}): ${message}`);
  }
  return result.body;
}

async function deployWithApi() {
  console.log(`Render API deploy → service ${serviceId} @ ${commitId.slice(0, 7)}`);
  const deploy = await createDeploy();
  const deployId = deploy?.id;
  console.log(`Deploy created: ${deployId}`);

  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = await render(`/services/${serviceId}/deploys/${deployId}`);
    const status = current.body?.status ?? "unknown";
    console.log(`  status: ${status}`);
    if (status === "live") return;
    if (FAILED.has(status)) {
      throw new Error(`Render deploy ${deployId} failed with status "${status}"`);
    }
    await sleep(15000);
  }
  throw new Error(`Render deploy ${deployId} did not finish within 20 minutes`);
}

async function deployWithHook() {
  console.log(`Render deploy hook → ${hookUrl.slice(0, 24)}… @ ${commitId.slice(0, 7)}`);
  const response = await fetch(hookUrl, { method: "POST" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Render deploy hook failed (${response.status}): ${text}`);
  }
  console.log(`Deploy triggered: ${text || response.status}`);
}

async function main() {
  if (!commitId) throw new Error("No commit to deploy: pass --sha <commit>.");
  if (dryRun) {
    console.log(`dry run: would deploy commit ${commitId.slice(0, 7)}`);
    console.log(`  api key: ${apiKey ? "present" : "missing"}`);
    console.log(`  service id: ${serviceId || "missing"}`);
    console.log(`  deploy hook: ${hookUrl ? "present" : "missing"}`);
    return;
  }

  if (apiKey && serviceId) {
    const running = await latestDeploy();
    if (running && IN_PROGRESS.has(running.status)) {
      console.log(`A deploy is already running (${running.id}, status ${running.status}); waiting for it.`);
      const deadline = Date.now() + 20 * 60 * 1000;
      while (Date.now() < deadline) {
        const current = await render(`/services/${serviceId}/deploys/${running.id}`);
        const status = current.body?.status ?? "unknown";
        console.log(`  status: ${status}`);
        if (status === "live") return;
        if (FAILED.has(status)) throw new Error(`The running deploy failed with status "${status}"`);
        await sleep(15000);
      }
      throw new Error("The running deploy did not finish within 20 minutes");
    }
    await deployWithApi();
    return;
  }

  if (hookUrl) {
    await deployWithHook();
    return;
  }

  throw new Error(
    "No Render credentials. Set RENDER_API_KEY and RENDER_SERVICE_ID (preferred) or RENDER_DEPLOY_HOOK_URL in the repository secrets.",
  );
}

main().catch((error) => {
  console.error("Deploy failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
