#!/usr/bin/env node
// Sidecar smoke test: starts the CLIProxyAPI binary with a temporary loopback
// config and management key, then verifies authenticated /v0/management/config
// endpoint behavior. Uses only Node.js built-ins -- no external dependencies.
//
// Usage:
//   node scripts/sidecar-smoke.mjs --binary <path> [--port <port>]
//
// On success exits 0. On failure prints diagnostics and exits non-zero.
// A temporary directory is created and cleaned up on exit.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Parse CLI ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let binaryPath = null;
let port = 49000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--binary" && i + 1 < args.length) {
    binaryPath = args[++i];
  } else if (args[i] === "--port" && i + 1 < args.length) {
    port = parseInt(args[++i], 10);
  }
}

if (!binaryPath) {
  console.error("Usage: node sidecar-smoke.mjs --binary <path> [--port <port>]");
  process.exit(1);
}

if (!existsSync(binaryPath)) {
  console.error(`Binary not found: ${binaryPath}`);
  process.exit(1);
}

// Ensure the binary is executable (no-op on Windows where permissions differ)
if (process.platform !== "win32") {
  try {
    chmodSync(binaryPath, 0o755);
  } catch {
    // Ignore permission changes on platforms that don't support it
  }
}

// ── Temp workspace ──────────────────────────────────────────────────────────
const tmpRoot = join(tmpdir(), `sidecar-smoke-${process.pid}`);
const authDir = join(tmpRoot, "auth");
mkdirSync(authDir, { recursive: true });

const managementKey = "smoke-test-mgmt-key-2025";
const proxyApiKey = "smoke-test-api-key-2025";

// Build config matching the structure produced by proxy.rs build_proxy_config_yaml
const configYaml = [
  `host: "127.0.0.1"`,
  `port: ${port}`,
  `auth-dir: "${authDir.replace(/\\/g, "\\\\")}"`,
  `api-keys:`,
  `  - "${proxyApiKey}"`,
  `debug: false`,
  `usage-statistics-enabled: true`,
  `logging-to-file: true`,
  `logs-max-total-size-mb: 1`,
  `request-retry: 3`,
  `max-retry-interval: 60`,
  `quota-exceeded:`,
  `  switch-project: true`,
  `  switch-preview-model: true`,
  `remote-management:`,
  `  allow-remote: false`,
  `  secret-key: "${managementKey}"`,
  `  disable-control-panel: true`,
  `request-log: true`,
  `commercial-mode: false`,
  `ws-auth: true`,
].join("\n");

const configPath = join(tmpRoot, "cli-proxy-api-config.yaml");
writeFileSync(configPath, configYaml, "utf-8");

// ── Start sidecar ──────────────────────────────────────────────────────────
const sidecar = spawn(binaryPath, ["--config", configPath], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, WRITABLE_PATH: tmpRoot },
  windowsHide: true,
});

let sidecarStdout = "";
let sidecarStderr = "";

sidecar.stdout.on("data", (chunk) => {
  sidecarStdout += chunk.toString();
});

sidecar.stderr.on("data", (chunk) => {
  sidecarStderr += chunk.toString();
});

let cleanupPromise = null;

function sidecarExited() {
  return sidecar.exitCode !== null || sidecar.signalCode !== null;
}

function waitForSidecarExit(timeoutMs) {
  if (sidecarExited()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (exitCode, signalCode) => {
      clearTimeout(timer);
      resolve(exitCode !== null || signalCode !== null);
    };
    const timer = setTimeout(() => {
      sidecar.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    sidecar.once("exit", onExit);
  });
}

async function terminateSidecar(signal, timeoutMs) {
  try {
    sidecar.kill(signal);
    await waitForSidecarExit(timeoutMs);
    return sidecarExited();
  } catch {
    // Process may already be dead.
    return sidecarExited();
  }
}

async function stopSidecar() {
  if (sidecarExited()) return true;
  const terminated = await terminateSidecar("SIGTERM", 5000);
  return terminated || (await terminateSidecar("SIGKILL", 5000));
}

async function removeTempRoot() {
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
      return true;
    } catch (err) {
      if (attempt === 40) {
        console.error(`[smoke] Failed to remove temporary workspace: ${err.message}`);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const sidecarStopped = await stopSidecar();
    const tempRootRemoved = await removeTempRoot();
    return sidecarStopped && tempRootRemoved;
  })();
  return cleanupPromise;
}

async function handleFatalError(reason) {
  console.error("[smoke] Fatal error:", reason);
  await cleanup();
  process.exit(1);
}

process.on("uncaughtException", handleFatalError);
process.on("unhandledRejection", handleFatalError);
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

// ── HTTP helpers ────────────────────────────────────────────────────────────
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

// ── Wait for binary to be ready ─────────────────────────────────────────────
const BASE_URL = `http://127.0.0.1:${port}`;
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1000;

let ready = false;
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    const resp = await fetchUrl(`${BASE_URL}/v0/management/config.yaml`, {
      method: "GET",
      headers: { "X-Management-Key": managementKey },
    });
    if (resp.status === 200) {
      ready = true;
      console.log(`[smoke] Sidecar ready on port ${port} (attempt ${attempt})`);
      break;
    }
    console.log(`[smoke] Unexpected status ${resp.status} (attempt ${attempt}/${MAX_RETRIES})`);
  } catch {
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

if (!ready) {
  console.error("[smoke] FAIL: Sidecar did not become ready within timeout");
  console.error("[smoke] stderr:", sidecarStderr.slice(0, 2000));
  console.error("[smoke] stdout:", sidecarStdout.slice(0, 1000));
  await cleanup();
  process.exit(1);
}

// ── Test 1: Authenticated /v0/management/config.yaml returns 200 ────────────
let test1Ok = false;
try {
  const resp = await fetchUrl(`${BASE_URL}/v0/management/config.yaml`, {
    method: "GET",
    headers: { "X-Management-Key": managementKey },
  });
  if (resp.status === 200) {
    console.log("[smoke] PASS: GET /v0/management/config.yaml (authenticated) -> 200");
    test1Ok = true;
  } else {
    console.error(
      `[smoke] FAIL: GET /v0/management/config.yaml returned ${resp.status} (expected 200)`,
    );
    console.error("[smoke] Body:", resp.body.slice(0, 500));
  }
} catch (err) {
  console.error("[smoke] FAIL: GET /v0/management/config.yaml threw:", err.message);
}

// ── Test 2: Unauthenticated /v0/management/config.yaml returns 401/403 ──────
let test2Ok = false;
try {
  const resp = await fetchUrl(`${BASE_URL}/v0/management/config.yaml`, {
    method: "GET",
    // No X-Management-Key header
  });
  if (resp.status === 401 || resp.status === 403) {
    console.log(`[smoke] PASS: GET /v0/management/config.yaml (unauthenticated) -> ${resp.status}`);
    test2Ok = true;
  } else {
    console.error(
      `[smoke] FAIL: GET /v0/management/config.yaml returned ${resp.status} (expected 401/403)`,
    );
    console.error("[smoke] Body:", resp.body.slice(0, 500));
  }
} catch (err) {
  console.error(
    "[smoke] FAIL: GET /v0/management/config.yaml (unauthenticated) threw:",
    err.message,
  );
}

// ── Test 3: Authenticated usage queue returns an array ─────────────────────
let test3Ok = false;
try {
  const resp = await fetchUrl(`${BASE_URL}/v0/management/usage-queue?count=1`, {
    method: "GET",
    headers: { "X-Management-Key": managementKey },
  });
  if (resp.status === 200 && Array.isArray(JSON.parse(resp.body))) {
    console.log("[smoke] PASS: GET /v0/management/usage-queue (authenticated) -> array");
    test3Ok = true;
  } else {
    console.error(
      `[smoke] FAIL: GET /v0/management/usage-queue returned ${resp.status} (expected 200 array)`,
    );
  }
} catch (err) {
  console.error("[smoke] FAIL: GET /v0/management/usage-queue threw:", err.message);
}

// ── Test 4: Stable management contracts used by ProxyPal ───────────────────
async function checkManagementContract({ expectedStatus = 200, method = "GET", path, validate }) {
  try {
    const resp = await fetchUrl(`${BASE_URL}/v0/management/${path}`, {
      method,
      headers: { "X-Management-Key": managementKey },
    });
    const body = JSON.parse(resp.body);
    if (resp.status !== expectedStatus) {
      console.error(
        `[smoke] FAIL: ${method} /v0/management/${path} returned ${resp.status} (expected ${expectedStatus})`,
      );
      console.error("[smoke] Body:", resp.body.slice(0, 500));
      return false;
    }
    if (!validate(body)) {
      console.error(`[smoke] FAIL: ${method} /v0/management/${path} returned an unexpected body`);
      console.error("[smoke] Body:", resp.body.slice(0, 500));
      return false;
    }
    console.log(`[smoke] PASS: ${method} /v0/management/${path} -> ${expectedStatus}`);
    return true;
  } catch (err) {
    console.error(`[smoke] FAIL: ${method} /v0/management/${path} threw:`, err.message);
  }
  return false;
}

const managementContracts = [
  {
    path: "max-retry-interval",
    validate: (body) => body["max-retry-interval"] === 60,
  },
  { path: "ws-auth", validate: (body) => body["ws-auth"] === true },
  { path: "request-log", validate: (body) => body["request-log"] === true },
  {
    path: "logs-max-total-size-mb",
    validate: (body) => body["logs-max-total-size-mb"] === 1,
  },
  {
    path: "error-logs-max-files",
    validate: (body) => Number.isInteger(body["error-logs-max-files"]),
  },
  { path: "logs?lines=5", validate: (body) => Array.isArray(body.lines) },
  { method: "DELETE", path: "logs", validate: (body) => body.success === true },
  { path: "auth-files?all=true", validate: (body) => Array.isArray(body.files) },
  {
    expectedStatus: 400,
    path: "oauth-callback",
    validate: (body) => body.status === "error" && typeof body.error === "string",
  },
  {
    expectedStatus: 400,
    method: "PATCH",
    path: "auth-files/status",
    validate: (body) => typeof body.error === "string",
  },
];

const managementContractResults = [];
for (const contract of managementContracts) {
  managementContractResults.push(await checkManagementContract(contract));
}
const managementContractsOk = managementContractResults.every(Boolean);

// ── Test 5: Process is still alive after API calls ──────────────────────────
const alive = !sidecarExited();
if (alive) {
  console.log("[smoke] PASS: Sidecar process is still running after API calls");
}

// ── Summary ─────────────────────────────────────────────────────────────────
const allPassed = test1Ok && test2Ok && test3Ok && managementContractsOk && alive;

if (allPassed) {
  console.log("\n[smoke] All sidecar smoke tests PASSED");
} else {
  console.error("\n[smoke] Some sidecar smoke tests FAILED:");
  console.error(`  Authenticated config endpoint:  ${test1Ok ? "PASS" : "FAIL"}`);
  console.error(`  Unauthenticated rejected:       ${test2Ok ? "PASS" : "FAIL"}`);
  console.error(`  Usage queue is available:       ${test3Ok ? "PASS" : "FAIL"}`);
  console.error(`  Management API contracts:       ${managementContractsOk ? "PASS" : "FAIL"}`);
  console.error(`  Process alive after tests:      ${alive ? "PASS" : "FAIL"}`);
  console.error("[smoke] stderr:", sidecarStderr.slice(0, 2000));
}

const cleanupOk = await cleanup();
if (!cleanupOk) {
  console.error("[smoke] Cleanup did not complete successfully");
}

if (!allPassed || !cleanupOk) {
  process.exitCode = 1;
}
