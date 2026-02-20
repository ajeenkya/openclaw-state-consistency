"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ensureStateFiles,
  getStatus,
  getDoctorReport,
  ingestObservation,
  loadState,
  applyUserConfirmation,
  renderHeartbeatProjection,
  ingestSignalEvent,
  migrateToCanonical,
  promoteReviewQueue,
  retryDlqEntries
} = require("../scripts/state-consistency");

function mkWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-consistency-"));
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, "schemas"), { recursive: true });

  const root = path.resolve(__dirname, "..");
  for (const file of [
    "state_observation.schema.json",
    "user_confirmation.schema.json",
    "signal_event.schema.json"
  ]) {
    fs.copyFileSync(
      path.join(root, "schemas", file),
      path.join(dir, "schemas", file)
    );
  }

  fs.writeFileSync(
    path.join(dir, "HEARTBEAT.md"),
    [
      "# HEARTBEAT.md",
      "",
      "## 🔔 Active Reminders",
      "- [ ] **Sunday**: Leave for Tahoe",
      "- [ ] **Monday**: Veda class at Northstar",
      ""
    ].join("\n"),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "MEMORY.md"),
    [
      "# MEMORY.md",
      "",
      "- **Current**: On ski break week in Tahoe",
      "- **NEW PRIORITY**: Improve state consistency",
      ""
    ].join("\n"),
    "utf8"
  );

  return dir;
}

function writeExecutable(dir, name) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", "utf8");
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

test("init creates state files and status baseline", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);
  const status = getStatus(rootDir);
  assert.equal(status.entities, 0);
  assert.equal(status.committed_fields, 0);
  assert.equal(status.pending_confirmations, 0);
  assert.ok(fs.existsSync(path.join(rootDir, "memory", "state-tracker.json")));
  assert.ok(fs.existsSync(path.join(rootDir, "memory", "state-changes.md")));
  assert.ok(fs.existsSync(path.join(rootDir, "memory", "state-dlq.jsonl")));
});

test("ingestion commits high-confidence events and enforces idempotency", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const event = {
    event_id: "cf9856be-61d9-4899-ad2e-2fa6f188f61a",
    event_ts: new Date().toISOString(),
    domain: "travel",
    entity_id: "user:primary",
    field: "travel.location",
    candidate_value: "Tahoe",
    intent: "assertive",
    source: {
      type: "conversation_assertive",
      ref: "thread:1:msg:1"
    },
    corroborators: []
  };

  const first = ingestObservation(rootDir, event);
  assert.equal(first.status, "committed");

  const second = ingestObservation(rootDir, event);
  assert.equal(second.status, "duplicate");

  const state = loadState(rootDir);
  assert.equal(
    state.entities["user:primary"].state.travel.location.value,
    "Tahoe"
  );
});

test("review-band events create pending prompt and can be edited/committed", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const event = {
    event_id: "ee59c545-f9f5-430a-a290-7ceb0af94761",
    event_ts: new Date().toISOString(),
    domain: "travel",
    entity_id: "user:primary",
    field: "travel.alert",
    candidate_value: "Leave for Tahoe Friday",
    intent: "assertive",
    source: {
      type: "static_markdown",
      ref: "MEMORY.md:20"
    },
    corroborators: [
      { type: "calendar", ref: "event:1" },
      { type: "email", ref: "thread:2" }
    ]
  };

  const ingested = ingestObservation(rootDir, event);
  assert.equal(ingested.status, "pending_confirmation");
  assert.ok(ingested.prompt.prompt_id);

  const confirmation = {
    prompt_id: ingested.prompt.prompt_id,
    entity_id: "user:primary",
    domain: "travel",
    proposed_change: ingested.prompt.proposed_change,
    confidence: ingested.prompt.confidence,
    reason_summary: ingested.prompt.reason_summary,
    action: "edit",
    edited_value: "Leave for Tahoe Saturday",
    ts: new Date().toISOString()
  };

  const confirmed = applyUserConfirmation(rootDir, confirmation);
  assert.equal(confirmed.status, "committed");

  const state = loadState(rootDir);
  assert.equal(
    state.entities["user:primary"].state.travel.alert.value,
    "Leave for Tahoe Saturday"
  );
});

test("review queue promotes tentative observations into pending confirmations", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const event = {
    event_id: "80db6473-cfba-4899-9ab2-fe6759c82b0c",
    event_ts: new Date().toISOString(),
    domain: "travel",
    entity_id: "user:primary",
    field: "travel.possible_plan",
    candidate_value: "Potential Tahoe stop on Monday",
    intent: "historical",
    source: {
      type: "static_markdown",
      ref: "HEARTBEAT.md:8"
    },
    corroborators: []
  };

  const ingested = ingestObservation(rootDir, event);
  assert.equal(ingested.status, "tentative");

  const promoted = promoteReviewQueue(rootDir, {
    entity_id: "user:primary",
    domain: "travel",
    min_confidence: 0.4,
    limit: 3
  });
  assert.equal(promoted.status, "ok");
  assert.equal(promoted.promoted_count, 1);
  assert.equal(promoted.promoted.length, 1);

  const state = loadState(rootDir);
  assert.equal(Object.keys(state.pending_confirmations).length, 1);
  assert.ok(state.tentative_observations[0].promoted_at);
});

test("review queue honors max_pending cap", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const pendingCandidate = {
    event_id: "f2a7a457-5705-42a9-89eb-879495ecf874",
    event_ts: new Date().toISOString(),
    domain: "travel",
    entity_id: "user:primary",
    field: "travel.needs_confirmation",
    candidate_value: "Check lodging details",
    intent: "assertive",
    source: {
      type: "static_markdown",
      ref: "MEMORY.md:25"
    },
    corroborators: [{ type: "calendar", ref: "event:42" }, { type: "email", ref: "thread:42" }]
  };
  const tentativeCandidate = {
    event_id: "dc5c0386-cc95-4748-9e5f-44e5dd5d4fba",
    event_ts: new Date().toISOString(),
    domain: "travel",
    entity_id: "user:primary",
    field: "travel.low_confidence_note",
    candidate_value: "Possible return on Tuesday",
    intent: "historical",
    source: {
      type: "static_markdown",
      ref: "HEARTBEAT.md:12"
    },
    corroborators: []
  };

  const first = ingestObservation(rootDir, pendingCandidate);
  const second = ingestObservation(rootDir, tentativeCandidate);
  assert.equal(first.status, "pending_confirmation");
  assert.equal(second.status, "tentative");

  const promoted = promoteReviewQueue(rootDir, {
    entity_id: "user:primary",
    max_pending: 1,
    limit: 5,
    min_confidence: 0.4
  });

  assert.equal(promoted.promoted_count, 0);
  assert.equal(promoted.reason, "pending_limit_reached");
  assert.equal(promoted.pending_count, 1);
});

test("signal ingestion hook processes calendar/email payloads", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const signal = {
    signal_id: "3e8f7925-ef3e-4f80-accf-9144cb2dc6f6",
    event_ts: new Date().toISOString(),
    source: {
      kind: "calendar",
      mode: "poll",
      ref: "gcal:next-24h"
    },
    entity_id: "user:primary",
    items: [
      {
        domain: "travel",
        field: "travel.departure_time",
        value: "2026-02-22T07:00:00-08:00",
        intent: "assertive"
      }
    ]
  };

  const result = ingestSignalEvent(rootDir, signal);
  assert.equal(result.status, "ok");
  assert.equal(result.total_items, 1);
  assert.ok(result.pending_confirmation + result.committed >= 1);
});

test("signal item ref keeps poll ingestion idempotent across runs", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const baseSignal = {
    event_ts: new Date().toISOString(),
    source: {
      kind: "email",
      mode: "poll",
      ref: "gog:gmail:newer_than:2d"
    },
    entity_id: "user:primary",
    items: [
      {
        domain: "financial",
        field: "financial.email_thread_t1",
        ref: "gmail_thread:t1",
        value: {
          thread_id: "t1",
          subject: "Statement ready"
        },
        intent: "historical"
      }
    ]
  };

  const first = ingestSignalEvent(rootDir, {
    ...baseSignal,
    signal_id: "69ef6519-a585-44c5-af94-57a758ca31f7"
  });
  const second = ingestSignalEvent(rootDir, {
    ...baseSignal,
    signal_id: "5e5df641-081c-44c2-b685-65de1327add7"
  });

  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  assert.equal(second.duplicate, 1);
});

test("migration ingests HEARTBEAT/MEMORY into canonical state", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);
  const summary = migrateToCanonical(rootDir, {
    entity_id: "user:primary",
    force_commit: true
  });
  assert.ok(summary.total > 0);
  assert.ok(summary.committed > 0);
});

test("projection writes machine-managed sections", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const event = {
    event_id: "d26b61d6-f93e-4f22-a1e1-32bfe8606b26",
    event_ts: new Date().toISOString(),
    domain: "travel",
    entity_id: "user:primary",
    field: "travel.status",
    candidate_value: "in_progress",
    intent: "assertive",
    source: {
      type: "conversation_assertive",
      ref: "thread:abc"
    },
    corroborators: []
  };
  ingestObservation(rootDir, event);

  const projection = renderHeartbeatProjection(rootDir, { entity_id: "user:primary" });
  assert.equal(projection.status, "ok");

  const heartbeat = fs.readFileSync(path.join(rootDir, "HEARTBEAT.md"), "utf8");
  assert.ok(heartbeat.includes("## Canonical State (Machine Managed)"));
  assert.ok(heartbeat.includes("## State Change Log (Machine Managed)"));
});

test("status exposes pending/tentative/dlq and poll/review timestamps", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const invalidObservation = {
    event_id: "bad-observation-for-dlq",
    event_ts: new Date().toISOString()
  };
  const validationResult = ingestObservation(rootDir, invalidObservation);
  assert.equal(validationResult.status, "validation_failed");

  const pollTs = "2026-02-20T10:00:00.000Z";
  const reviewTs = "2026-02-20T10:05:00.000Z";
  const statePath = path.join(rootDir, "memory", "state-tracker.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.runtime.last_poll_at = pollTs;
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(rootDir, "memory", "state-telegram-review-state.json"),
    `${JSON.stringify({ last_dispatched_at: reviewTs }, null, 2)}\n`,
    "utf8"
  );

  const status = getStatus(rootDir);
  assert.equal(status.pending, 0);
  assert.equal(status.tentative, 0);
  assert.equal(status.last_poll, pollTs);
  assert.equal(status.last_review, reviewTs);
  assert.equal(status.dlq.total, 1);
  assert.equal(status.dlq.pending_retry, 1);
});

test("retry-dlq replays due observation entries and marks them resolved", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const now = new Date().toISOString();
  const dlqEntry = {
    dlq_id: "dlq-retry-observation-1",
    schema_name: "observation",
    payload: {
      event_id: "dlq-observation-commit-1",
      event_id: "6af5c3f8-d628-4f95-a8df-99f7b22f18fd",
      event_ts: now,
      domain: "travel",
      entity_id: "user:primary",
      field: "travel.dlq_retry_check",
      candidate_value: "Tahoe",
      intent: "assertive",
      source: {
        type: "conversation_assertive",
        ref: "dlq:test"
      },
      corroborators: []
    },
    validation_errors: [{ message: "seeded for retry test" }],
    first_seen_ts: now,
    retry_count: 0,
    next_retry_ts: now,
    status: "pending_retry"
  };
  fs.appendFileSync(
    path.join(rootDir, "memory", "state-dlq.jsonl"),
    `${JSON.stringify(dlqEntry)}\n`,
    "utf8"
  );

  const retried = retryDlqEntries(rootDir, { include_not_due: true, limit: 5 });
  assert.equal(retried.status, "ok");
  assert.equal(retried.selected, 1);
  assert.equal(retried.resolved, 1);
  assert.equal(retried.pending_retry, 0);

  const state = loadState(rootDir);
  assert.equal(
    state.entities["user:primary"].state.travel.dlq_retry_check.value,
    "Tahoe"
  );

  const status = getStatus(rootDir);
  assert.equal(status.dlq.total, 1);
  assert.equal(status.dlq.resolved, 1);
});

test("doctor flags missing runtime config with actionable fixes", () => {
  const rootDir = mkWorkspace();
  const report = getDoctorReport(rootDir, {
    env: {
      PATH: ""
    }
  });

  assert.equal(report.status, "degraded");
  assert.equal(report.checks.schemas.status, "ok");
  assert.equal(report.checks.canonical_files.status, "warn");
  assert.equal(report.checks.binaries.status, "warn");
  assert.equal(report.checks.poll_account.status, "warn");
  assert.equal(report.checks.telegram_target.status, "warn");
  assert.ok(report.fixes.some((fix) => fix.includes("STATE_GOG_ACCOUNT")));
  assert.ok(report.fixes.some((fix) => fix.includes("STATE_TELEGRAM_TARGET")));
  assert.ok(report.fixes.some((fix) => fix.includes("state:init")));
});

test("doctor resolves healthy runtime from cron config and PATH binaries", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const binDir = path.join(rootDir, "fake-bin");
  fs.mkdirSync(binDir, { recursive: true });
  writeExecutable(binDir, "openclaw");
  writeExecutable(binDir, "gog");

  fs.writeFileSync(
    path.join(rootDir, "cron-config.json"),
    `${JSON.stringify({
      accounts: { gogAccount: "aj@example.com" },
      telegram: { ajId: "7986763678" }
    }, null, 2)}\n`,
    "utf8"
  );

  const report = getDoctorReport(rootDir, {
    env: {
      PATH: binDir
    }
  });

  assert.equal(report.status, "ok");
  assert.equal(report.checks.schemas.status, "ok");
  assert.equal(report.checks.canonical_files.status, "ok");
  assert.equal(report.checks.binaries.status, "ok");
  assert.equal(report.checks.poll_account.status, "ok");
  assert.equal(report.checks.poll_account.source, "cron-config.json accounts.gogAccount");
  assert.equal(report.checks.telegram_target.status, "ok");
  assert.equal(report.checks.telegram_target.source, "cron-config.json telegram.ajId");
  assert.equal(report.fixes.length, 0);
});
