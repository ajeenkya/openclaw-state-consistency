#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TARGET_DIRS = ["scripts", "test", "plugins"];

function listJsFiles(dirPath) {
  const out = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".js")) {
      out.push(fullPath);
    }
  }
  return out;
}

function main() {
  const files = [];
  for (const relDir of TARGET_DIRS) {
    const fullDir = path.join(ROOT, relDir);
    if (!fs.existsSync(fullDir)) {
      continue;
    }
    files.push(...listJsFiles(fullDir));
  }

  let failed = 0;
  for (const filePath of files.sort()) {
    const res = spawnSync(process.execPath, ["--check", filePath], {
      cwd: ROOT,
      encoding: "utf8"
    });
    if (res.status !== 0) {
      failed += 1;
      process.stderr.write(`Syntax check failed: ${path.relative(ROOT, filePath)}\n`);
      if (res.stderr) {
        process.stderr.write(`${res.stderr}\n`);
      }
    }
  }

  if (failed > 0) {
    process.stderr.write(`lint failed: ${failed} file(s) contain syntax errors\n`);
    return 1;
  }

  process.stdout.write(`lint ok: ${files.length} JavaScript files checked\n`);
  return 0;
}

process.exitCode = main();
