#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const ROOT = path.resolve(__dirname, "..");
const SCHEMAS = [
  "schemas/state_observation.schema.json",
  "schemas/user_confirmation.schema.json",
  "schemas/signal_event.schema.json"
];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);

  const compiled = [];
  for (const relPath of SCHEMAS) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Missing schema: ${relPath}`);
    }
    const schema = loadJson(absPath);
    ajv.compile(schema);
    compiled.push(relPath);
  }

  process.stdout.write(`schema check ok: ${compiled.length} schema(s) compiled\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`schema check failed: ${error.message}\n`);
  process.exitCode = 1;
}
