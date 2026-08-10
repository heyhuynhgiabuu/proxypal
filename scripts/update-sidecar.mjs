#!/usr/bin/env node
// Cross-platform sidecar binary downloader for CLIProxyAPI
// Works on macOS, Linux, and Windows (Node 18+)

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  copyFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARIES_DIR = join(__dirname, "..", "src-tauri", "binaries");
const SIDECAR_VERSION_FILE = join(__dirname, "sidecar-version");

function readPinnedSidecarVersion() {
  if (process.env.CLIPROXYAPI_VERSION) {
    return process.env.CLIPROXYAPI_VERSION.replace(/^v/, "");
  }
  if (existsSync(SIDECAR_VERSION_FILE)) {
    const pinned = readFileSync(SIDECAR_VERSION_FILE, "utf8").trim().replace(/^v/, "");
    if (pinned) return pinned;
  }
  return null;
}

async function resolveRelease(channelConfig, headers) {
  const pinnedVersion = readPinnedSidecarVersion();
  if (!pinnedVersion) {
    throw new Error(
      "No pinned CLIProxyAPI version found. Set CLIPROXYAPI_VERSION or restore scripts/sidecar-version.",
    );
  }
  const apiUrl = `https://api.github.com/repos/${channelConfig.repo}/releases/tags/v${pinnedVersion}`;

  const apiRes = await fetch(apiUrl, { headers });
  if (!apiRes.ok) {
    const hint = channelConfig.repo.includes("CLIProxyAPIPlus")
      ? "\nCLIProxyAPIPlus may be private, renamed, or unavailable. To use mainline instead, run: CLIPROXYAPI_CHANNEL=mainline pnpm update-sidecar"
      : pinnedVersion
        ? `\nPinned sidecar version v${pinnedVersion} was not found. Update scripts/sidecar-version or set CLIPROXYAPI_VERSION.`
        : "";
    throw new Error(
      `GitHub API error (${apiRes.status}): ${apiRes.statusText} for ${apiUrl}${hint}`,
    );
  }

  return apiRes.json();
}

const CHANNELS = {
  plus: {
    repo: "router-for-me/CLIProxyAPIPlus",
    assetPrefix: "CLIProxyAPIPlus",
    label: "CLIProxyAPIPlus",
  },
  mainline: {
    repo: "router-for-me/CLIProxyAPI",
    assetPrefix: "CLIProxyAPI",
    label: "CLIProxyAPI",
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  let channel = process.env.CLIPROXYAPI_CHANNEL || "mainline";
  let force = false;
  let requestedTarget = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--channel") {
      const value = args[i + 1];
      if (!value) throw new Error("Missing value for --channel");
      channel = value;
      i += 1;
    } else if (arg.startsWith("--channel=")) {
      channel = arg.slice("--channel=".length);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!requestedTarget) {
      requestedTarget = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!CHANNELS[channel]) {
    throw new Error(
      `Unknown sidecar channel: ${channel}. Expected one of: ${Object.keys(CHANNELS).join(", ")}`,
    );
  }

  return { channel, force, requestedTarget };
}

function getChannelConfig(channel) {
  const defaults = CHANNELS[channel];
  return {
    ...defaults,
    repo: process.env.CLIPROXYAPI_REPO || defaults.repo,
    assetPrefix: process.env.CLIPROXYAPI_ASSET_PREFIX || defaults.assetPrefix,
  };
}

/**
 * Validate that a file is a real executable, not a gzip archive or other invalid format.
 * Checks magic bytes: gzip (1f 8b), Mach-O (cf fa ed fe), ELF (7f 45 4c 46), PE (4d 5a)
 */
function validateBinary(filePath) {
  const buf = readFileSync(filePath);
  if (buf.length < 4) {
    throw new Error(`Binary too small (${buf.length} bytes): ${filePath}`);
  }
  // Reject gzip archives
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    rmSync(filePath, { force: true });
    throw new Error(
      `Installed file is a gzip archive, not an executable: ${filePath}\n` +
        `This usually means the archive was copied instead of extracted.`,
    );
  }
  // Verify it's a known executable format
  const isMachO = buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe;
  const isELF = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  const isPE = buf[0] === 0x4d && buf[1] === 0x5a;
  if (!isMachO && !isELF && !isPE) {
    console.warn(
      `Warning: Binary has unknown format (magic: ${buf.slice(0, 4).toString("hex")}): ${filePath}`,
    );
  }
}

/**
 * Fetch checksums.txt from the release and verify the downloaded archive's SHA-256.
 * Fails closed: missing entry or hash mismatch throw an error.
 * Returns the verified buffer on success.
 */
async function verifyChecksum(repo, version, assetName, buffer) {
  const checksumsUrl = `https://github.com/${repo}/releases/download/v${version}/checksums.txt`;

  console.log(`Fetching checksums from ${checksumsUrl}...`);

  const res = await fetch(checksumsUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `checksums.txt download failed (${res.status}) for ${checksumsUrl}. ` +
        `Cannot verify asset integrity without checksums.`,
    );
  }

  const checksumsText = await res.text();
  const checksums = parseChecksums(checksumsText);

  const expectedHash = checksums.get(assetName);
  if (!expectedHash) {
    throw new Error(
      `No checksum entry found for "${assetName}" in checksums.txt. ` +
        `Available entries: ${[...checksums.keys()].join(", ")}`,
    );
  }

  const actualHash = createHash("sha256").update(buffer).digest("hex");

  if (actualHash !== expectedHash) {
    // Normalize: both lowercase
    const a = actualHash.toLowerCase();
    const e = expectedHash.toLowerCase();
    if (a !== e) {
      throw new Error(
        `SHA-256 mismatch for "${assetName}".\n` + `  Expected: ${e}\n` + `  Actual:   ${a}`,
      );
    }
  }

  console.log(`Checksum verified for ${assetName}`);
}

/**
 * Parse a checksums.txt file content into a Map of filename → sha256 hex string.
 * Supports both:
 *   <hash>  <filename>    (standard shasum -a256 output, two spaces)
 *   <hash> *<filename>    (binary mode, starred)
 */
export function parseChecksums(content) {
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Match: <64-char-hex>  <optional-mode><filename>
    const m = trimmed.match(/^([a-fA-F0-9]{64})\s+[ *]?(.+)$/);
    if (m) {
      map.set(m[2].trim(), m[1].toLowerCase());
    }
  }
  return map;
}

function getCurrentTarget() {
  const { platform, arch } = process;
  const targets = {
    "darwin-arm64": "cli-proxy-api-aarch64-apple-darwin",
    "darwin-x64": "cli-proxy-api-x86_64-apple-darwin",
    "linux-x64": "cli-proxy-api-x86_64-unknown-linux-gnu",
    "linux-arm64": "cli-proxy-api-aarch64-unknown-linux-gnu",
    "win32-x64": "cli-proxy-api-x86_64-pc-windows-msvc.exe",
    "win32-arm64": "cli-proxy-api-aarch64-pc-windows-msvc.exe",
  };
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error(`Unsupported platform: ${platform}-${arch}`);
  return target;
}

function getAssetInfo(target, version, assetPrefix) {
  const map = {
    "cli-proxy-api-aarch64-apple-darwin": [
      [
        `${assetPrefix}_${version}_darwin_aarch64.tar.gz`,
        `${assetPrefix}_${version}_darwin_arm64.tar.gz`,
      ],
      "tar",
    ],
    "cli-proxy-api-x86_64-apple-darwin": [[`${assetPrefix}_${version}_darwin_amd64.tar.gz`], "tar"],
    "cli-proxy-api-x86_64-unknown-linux-gnu": [
      [`${assetPrefix}_${version}_linux_amd64.tar.gz`],
      "tar",
    ],
    "cli-proxy-api-aarch64-unknown-linux-gnu": [
      [
        `${assetPrefix}_${version}_linux_aarch64.tar.gz`,
        `${assetPrefix}_${version}_linux_arm64.tar.gz`,
      ],
      "tar",
    ],
    "cli-proxy-api-x86_64-pc-windows-msvc.exe": [
      [`${assetPrefix}_${version}_windows_amd64.zip`],
      "zip",
    ],
    "cli-proxy-api-aarch64-pc-windows-msvc.exe": [
      [
        `${assetPrefix}_${version}_windows_aarch64.zip`,
        `${assetPrefix}_${version}_windows_arm64.zip`,
      ],
      "zip",
    ],
  };
  return map[target] || null;
}

function findBinary(dir, { includeExe = false } = {}) {
  const names = ["cli-proxy-api-plus", "CLIProxyAPIPlus", "CLIProxyAPI", "cli-proxy-api"];
  // Add .exe variants when on Windows OR when cross-downloading Windows targets
  if (process.platform === "win32" || includeExe) {
    names.push(...names.map((n) => n + ".exe"));
  }

  // Skip archive extensions — we want the executable, not the archive
  const archiveExts = [".tar.gz", ".tar", ".gz", ".zip", ".tgz"];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(fullPath, { includeExe });
      if (found) return found;
    }
    // Skip archive files
    if (archiveExts.some((ext) => entry.name.endsWith(ext))) continue;
    if (names.some((n) => entry.name === n)) {
      return fullPath;
    }
  }
  return null;
}

async function downloadTarget(target, version, channelConfig, releaseAssets = null) {
  const assetInfo = getAssetInfo(target, version, channelConfig.assetPrefix);
  if (!assetInfo) throw new Error(`Unknown target: ${target}`);

  const [assetNames, archiveType] = assetInfo;
  const assetName = assetNames.find((name) => !releaseAssets || releaseAssets.has(name)) || null;
  if (!assetName) {
    throw new Error(`No matching asset found for ${target}. Tried: ${assetNames.join(", ")}`);
  }
  const url = `https://github.com/${channelConfig.repo}/releases/download/v${version}/${assetName}`;

  console.log(`Downloading ${assetName}...`);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  // Verify archive integrity against checksums.txt before any filesystem writes
  await verifyChecksum(channelConfig.repo, version, assetName, buffer);

  const tempDir = join(BINARIES_DIR, ".tmp-download");
  mkdirSync(tempDir, { recursive: true });

  const archivePath = join(tempDir, assetName);
  writeFileSync(archivePath, buffer);

  try {
    // Extract archive
    if (archiveType === "zip") {
      if (process.platform === "win32") {
        execSync(`powershell -Command "Expand-Archive -Force '${archivePath}' '${tempDir}'"`, {
          stdio: "inherit",
        });
      } else {
        execSync(`unzip -o -q "${archivePath}" -d "${tempDir}"`, {
          stdio: "inherit",
        });
      }
    } else {
      execSync(`tar -xzf "${archivePath}" -C "${tempDir}"`, {
        stdio: "inherit",
      });
    }

    // Find and copy binary (pass includeExe for Windows targets cross-downloaded from other OS)
    const isWindowsTarget = target.endsWith(".exe");
    const binaryPath = findBinary(tempDir, { includeExe: isWindowsTarget });
    if (!binaryPath) throw new Error("Binary not found in archive");

    const destPath = join(BINARIES_DIR, target);
    copyFileSync(binaryPath, destPath);
    if (process.platform !== "win32") {
      chmodSync(destPath, 0o755);
    }

    console.log(`Installed: ${destPath}`);

    // Validate the installed binary is a real executable, not a gzip/archive
    validateBinary(destPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const { channel, force, requestedTarget } = parseArgs();
  const channelConfig = getChannelConfig(channel);

  const headers = { "User-Agent": "proxypal-sidecar-updater" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const release = await resolveRelease(channelConfig, headers);
  const version = release.tag_name.replace(/^v/, "");
  const pinnedVersion = readPinnedSidecarVersion();
  const releaseAssets = new Set((release.assets || []).map((asset) => asset.name));
  console.log(`${channelConfig.label} channel: ${channel}`);
  console.log(`${channelConfig.label} repo: ${channelConfig.repo}`);
  console.log(
    `${channelConfig.label} version: ${version}${pinnedVersion ? " (pinned)" : " (latest)"}`,
  );

  mkdirSync(BINARIES_DIR, { recursive: true });

  if (requestedTarget) {
    // Download specific target
    await downloadTarget(requestedTarget, version, channelConfig, releaseAssets);
  } else {
    // Download for current platform only
    const target = getCurrentTarget();
    const destPath = join(BINARIES_DIR, target);
    if (existsSync(destPath) && !force) {
      console.log(`Binary exists: ${destPath} (use --force to re-download)`);
      return;
    }
    await downloadTarget(target, version, channelConfig, releaseAssets);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
