#!/usr/bin/env node

"use strict";

const path = require("path");
const { migrateToCanonical } = require("./state-consistency");
const DEFAULT_ENTITY_ID = "user:primary";

function parseArgs(argv) {
  const args = { _: [] };
  let key = null;
  for (const token of argv) {
    if (token.startsWith("--")) {
      key = token.slice(2);
      args[key] = true;
      continue;
    }
    if (key) {
      args[key] = token;
      key = null;
      continue;
    }
    args._.push(token);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const rootDir = path.resolve(args.root || process.cwd());
  const summary = migrateToCanonical(rootDir, {
    entity_id: args["entity-id"] || DEFAULT_ENTITY_ID,
    force_commit: Boolean(args["force-commit"])
  });
  process.stdout.write(
    `${JSON.stringify({ status: "ok", root: rootDir, summary }, null, 2)}\n`
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main };
