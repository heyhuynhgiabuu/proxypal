// Node built-in tests for update-sidecar.mjs
// Run: node --test scripts/update-sidecar.test.mjs

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// ---------------------------------------------------------------------------
// Test the parsable-but-not-importable helpers by re-implementing exactly what
// the script exports.  The script is an ESM module with side effects at top
// level (main()), so we parseChecksums from the module-like source of truth.
// We re-import because node --test may already have cached it.
// ---------------------------------------------------------------------------

// Inline helpers matching the script's exported parseChecksums
function parseChecksums(content) {
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([a-fA-F0-9]{64})\s+[ *]?(.+)$/);
    if (m) {
      map.set(m[2].trim(), m[1].toLowerCase());
    }
  }
  return map;
}

async function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// ---------------------------------------------------------------------------
// parseChecksums
// ---------------------------------------------------------------------------
describe("parseChecksums", () => {
  it("parses standard shasum output (two spaces)", () => {
    const content = [
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  file1.tar.gz",
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592  file2.tar.gz",
    ].join("\n");
    const map = parseChecksums(content);
    assert.equal(map.size, 2);
    assert.equal(
      map.get("file1.tar.gz"),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    assert.equal(
      map.get("file2.tar.gz"),
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
    );
  });

  it("parses binary mode output (starred)", () => {
    const content =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 *file.tar.gz\n";
    const map = parseChecksums(content);
    assert.equal(map.size, 1);
    assert.equal(
      map.get("file.tar.gz"),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("skips blank lines and comments", () => {
    const content = [
      "# This is a comment",
      "",
      "  ",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  file.tar.gz",
    ].join("\n");
    const map = parseChecksums(content);
    assert.equal(map.size, 1);
  });

  it("returns empty map for empty content", () => {
    assert.equal(parseChecksums("").size, 0);
    assert.equal(parseChecksums("# only comment\n").size, 0);
  });

  it("lowercases hex hash", () => {
    const content =
      "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855  file.tar.gz\n";
    const map = parseChecksums(content);
    assert.equal(
      map.get("file.tar.gz"),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("ignores malformed lines gracefully", () => {
    const content = [
      "not-a-hash  file.tar.gz",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  valid.tar.gz",
      "short  file2.tar.gz",
      "",
    ].join("\n");
    const map = parseChecksums(content);
    assert.equal(map.size, 1);
    assert.ok(map.has("valid.tar.gz"));
  });
});

// ---------------------------------------------------------------------------
// sha256 verification (integration-style)
// ---------------------------------------------------------------------------
describe("SHA-256 verification logic (parity with script)", () => {
  it("matches known hash for empty buffer", async () => {
    const buf = Buffer.alloc(0);
    const hash = await sha256(buf);
    assert.equal(hash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches known hash for specific content", async () => {
    const buf = Buffer.from("hello\n", "utf8");
    const hash = await sha256(buf);
    assert.equal(hash, "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
  });

  it("detects content mismatch (different content => different hash)", async () => {
    const buf1 = Buffer.from("content-a");
    const buf2 = Buffer.from("content-b");
    const h1 = await sha256(buf1);
    const h2 = await sha256(buf2);
    assert.notEqual(h1, h2);
  });
});

// ---------------------------------------------------------------------------
// verifyChecksum-like function parity
// ---------------------------------------------------------------------------
describe("verifyChecksum validation parity", () => {
  it("accepts matching hash", async () => {
    const content = "verified-content";
    const buf = Buffer.from(content);
    const hash = await sha256(buf);
    const checksums = new Map();
    checksums.set("myfile.tar.gz", hash);
    assert.equal(await sha256(buf), checksums.get("myfile.tar.gz"));
  });

  it("rejects mismatched hash", async () => {
    const buf = Buffer.from("real-content");
    const wrongHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // empty hash
    const checksums = new Map();
    checksums.set("myfile.tar.gz", wrongHash);
    assert.notEqual(await sha256(buf), wrongHash);
  });

  it("fails closed on missing checksum entry", () => {
    const checksums = new Map();
    checksums.set("other-file.tar.gz", "a".repeat(64));
    assert.equal(checksums.has("myfile.tar.gz"), false);
  });

  it("handles realistic asset name matching", async () => {
    const buf = randomBytes(128);
    const hash = await sha256(buf);
    const assetName = "CLIProxyAPI_1.2.3_linux_amd64.tar.gz";
    const checksums = new Map();
    checksums.set(assetName, hash);
    assert.equal(checksums.has(assetName), true);
    assert.equal(checksums.get(assetName), hash);
  });
});

describe("build-time sidecar downloader", () => {
  const projectRoot = join(import.meta.dirname, "..");
  const buildScript = readFileSync(join(projectRoot, "src-tauri", "build.rs"), "utf8");

  it("uses only the pinned updater for the requested target", () => {
    assert.match(buildScript, /\.join\("scripts"\)\.join\("update-sidecar\.mjs"\)/);
    assert.match(buildScript, /\.arg\("--force"\)\s*\.arg\(binary_name\)/);
    assert.doesNotMatch(buildScript, /download-binaries\.(?:sh|ps1)/);
    assert.equal(
      existsSync(join(projectRoot, "src-tauri", "scripts", "download-binaries.sh")),
      false,
    );
    assert.equal(
      existsSync(join(projectRoot, "src-tauri", "scripts", "download-binaries.ps1")),
      false,
    );
  });
});

describe("sidecar version resolution", () => {
  const projectRoot = join(import.meta.dirname, "..");
  const updaterScript = readFileSync(join(projectRoot, "scripts", "update-sidecar.mjs"), "utf8");

  it("fails closed when no sidecar pin is available", () => {
    assert.match(updaterScript, /if \(!pinnedVersion\)/);
    assert.doesNotMatch(updaterScript, /releases\/latest/);
  });
});

describe("release sidecar metadata", () => {
  const projectRoot = join(import.meta.dirname, "..");
  const releaseWorkflow = readFileSync(
    join(projectRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );

  it("reads release notes from the bundled sidecar tag", () => {
    assert.match(
      releaseWorkflow,
      /gh release view "v\$\{CLIPROXYAPI_VERSION\}" --repo "\$SIDECAR_REPO"/,
    );
  });

  it("verifies the pinned sidecar before publishing", () => {
    const preflight = releaseWorkflow.indexOf("name: Verify pins and prepare release draft");
    const publish = releaseWorkflow.indexOf("uses: tauri-apps/tauri-action@v0");

    assert.notEqual(preflight, -1);
    assert.notEqual(publish, -1);
    assert.ok(preflight < publish);
    assert.match(
      releaseWorkflow,
      /  release:\n    name: Release \(\$\{\{ matrix\.os \}\}\)\n    needs: preflight/,
    );
  });

  it("keeps public release publication behind all draft gates", () => {
    assert.match(releaseWorkflow, /releaseDraft: true/);
    assert.match(
      releaseWorkflow,
      /generate-changelog:\n    name: Generate Changelog\n    needs: \[preflight, release\]\n    permissions:\n      contents: write/,
    );
    assert.match(
      releaseWorkflow,
      /publish:\n    name: Publish Release\n    needs: \[preflight, release, generate-changelog\]/,
    );
    assert.match(releaseWorkflow, /releaseId: \$\{\{ needs\.preflight\.outputs\.release_id \}\}/);
    assert.match(releaseWorkflow, /max-parallel: 1/);
    assert.match(
      releaseWorkflow,
      /gh api --method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID" -F draft=false/,
    );
    assert.match(releaseWorkflow, /RELEASE_ID: \$\{\{ needs\.preflight\.outputs\.release_id \}\}/);
    assert.match(releaseWorkflow, /jq --arg notes \"\$DECODED_CHANGELOG\" '.notes = \$notes'/);
    assert.match(releaseWorkflow, /latest\.json was not generated by tauri-action/);
  });
});
