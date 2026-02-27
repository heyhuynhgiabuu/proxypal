#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function run(command, args) {
  return spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

const availability = spawnSync("pnpm", ["exec", "tsgo", "--version"], {
  stdio: "pipe",
  shell: process.platform === "win32",
});

if (availability.status === 0) {
  const tsgo = run("pnpm", ["exec", "tsgo", "--noEmit"]);
  process.exit(tsgo.status ?? 1);
}

console.warn("tsgo not found; falling back to tsc --noEmit");
const tsc = run("pnpm", ["tsc", "--noEmit"]);
process.exit(tsc.status ?? 1);
