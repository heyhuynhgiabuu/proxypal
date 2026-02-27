#!/usr/bin/env node

import { spawn } from "node:child_process";

const jobs = [
  { name: "check:ts", command: "pnpm", args: ["check:ts"] },
  { name: "lint", command: "pnpm", args: ["lint"] },
  { name: "format:check", command: "pnpm", args: ["format:check"] },
];

const running = new Map();
let failed = false;

function runJob(job) {
  const child = spawn(job.command, job.args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  running.set(job.name, child);

  child.on("close", (code, signal) => {
    running.delete(job.name);

    if (output.trim()) {
      process.stdout.write(`\n=== ${job.name} ===\n${output}`);
    }

    if (!failed && code !== 0 && signal !== "SIGTERM") {
      failed = true;
      for (const processRef of running.values()) {
        processRef.kill("SIGTERM");
      }
      process.exit(code ?? 1);
    }

    if (running.size === 0 && !failed) {
      process.exit(0);
    }
  });
}

for (const job of jobs) {
  runJob(job);
}
