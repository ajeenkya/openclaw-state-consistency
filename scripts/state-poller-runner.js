#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const DEFAULT_ENTITY_ID = "user:primary";

const {
  pollSignals,
  promoteReviewQueue,
  renderHeartbeatProjection
} = require("./state-consistency");

function readCronConfig(rootDir) {
  const configPath = path.join(rootDir, "cron-config.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (_err) {
    return {};
  }
}

function main(argv) {
  try {
    const rootDir = path.resolve(argv[0] || process.cwd());
    const config = readCronConfig(rootDir);
    const account = process.env.STATE_GOG_ACCOUNT || config?.accounts?.gogAccount || "";
    const entityId = process.env.STATE_ENTITY_ID || DEFAULT_ENTITY_ID;

    const poll = pollSignals(rootDir, {
      entity_id: entityId,
      account,
      calendar_from: process.env.STATE_CALENDAR_FROM || "today",
      calendar_to: process.env.STATE_CALENDAR_TO || "tomorrow",
      calendar_max: Number(process.env.STATE_CALENDAR_MAX || 25),
      gmail_query: process.env.STATE_GMAIL_QUERY || "newer_than:2d",
      gmail_max: Number(process.env.STATE_GMAIL_MAX || 25)
    });

    const review = promoteReviewQueue(rootDir, {
      entity_id: entityId,
      min_confidence: Number(process.env.STATE_REVIEW_MIN_CONFIDENCE || 0.4),
      limit: Number(process.env.STATE_REVIEW_LIMIT || 5),
      max_pending: Number(process.env.STATE_REVIEW_MAX_PENDING || 10)
    });

    const projection = renderHeartbeatProjection(rootDir, { entity_id: entityId });

    process.stdout.write(
      `${JSON.stringify({
        status: "ok",
        root: rootDir,
        entity_id: entityId,
        account: account || null,
        poll,
        review,
        projection
      }, null, 2)}\n`
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: "error",
        message: error.message
      }, null, 2)}\n`
    );
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main };
