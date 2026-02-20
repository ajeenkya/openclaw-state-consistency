"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const plugin = require("../plugins/state-consistency-bridge");
const { ensureStateFiles, ingestObservation, loadState } = require("../scripts/state-consistency");

const {
  buildCanonicalPrependContext,
  buildPromptButtons,
  parseControlArgs,
  resolvePromptId
} = require("../plugins/state-consistency-bridge")._internal;

function mkWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-main-chat-bridge-"));
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

  fs.writeFileSync(path.join(dir, "HEARTBEAT.md"), "# HEARTBEAT.md\n", "utf8");
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# MEMORY.md\n", "utf8");
  return dir;
}

test("parseControlArgs supports prompt + yes/no and edit", () => {
  const yes = parseControlArgs("e6fe33d0 yes");
  assert.equal(yes.action, "confirm");
  assert.equal(yes.promptRef, "e6fe33d0");

  const no = parseControlArgs("no e6fe33d0");
  assert.equal(no.action, "reject");
  assert.equal(no.promptRef, "e6fe33d0");

  const edit = parseControlArgs("e6fe33d0 edit \"Tahoe, Northstar\"");
  assert.equal(edit.action, "edit");
  assert.equal(edit.promptRef, "e6fe33d0");
  assert.equal(edit.editedValue, "Tahoe, Northstar");
});

test("parseControlArgs supports action-only and show", () => {
  const show = parseControlArgs("");
  assert.equal(show.action, "show");

  const confirmOnly = parseControlArgs("yes");
  assert.equal(confirmOnly.action, "confirm");
  assert.equal(confirmOnly.promptRef, "");
});

test("resolvePromptId supports short refs and active fallback", () => {
  const pending = {
    "e6fe33d0-e259-4d3a-a426-44ea49f46505": { prompt_id: "e6fe33d0-e259-4d3a-a426-44ea49f46505" },
    "b7af99a0-2385-4333-90aa-0089137426bd": { prompt_id: "b7af99a0-2385-4333-90aa-0089137426bd" }
  };

  const shortRef = resolvePromptId(pending, "e6fe33d0", "");
  assert.equal(shortRef.promptId, "e6fe33d0-e259-4d3a-a426-44ea49f46505");

  const active = resolvePromptId(pending, "", "b7af99a0-2385-4333-90aa-0089137426bd");
  assert.equal(active.promptId, "b7af99a0-2385-4333-90aa-0089137426bd");
});

test("buildPromptButtons uses /state-confirm callback command", () => {
  const id = "e6fe33d0-e259-4d3a-a426-44ea49f46505";
  const buttons = buildPromptButtons(id);
  assert.equal(buttons[0][0].callback_data, `/state-confirm ${id} yes`);
  assert.equal(buttons[0][1].callback_data, `/state-confirm ${id} no`);
});

test("buildCanonicalPrependContext renders deterministic canonical snapshot", () => {
  const state = {
    entities: {
      "user:primary": {
        state: {
          travel: {
            location: {
              value: "Tahoe",
              confidence: 0.91,
              source: "conversation_assertive"
            }
          }
        }
      }
    },
    pending_confirmations: {
      "e6fe33d0-e259-4d3a-a426-44ea49f46505": {
        prompt_id: "e6fe33d0-e259-4d3a-a426-44ea49f46505",
        created_at: "2026-02-20T20:00:00Z",
        observation_event: {
          field: "travel.telegram_test",
          candidate_value: "We are in Tahoe now."
        }
      }
    }
  };

  const out = buildCanonicalPrependContext(state, {
    maxFields: 10,
    includePending: true,
    reviewState: { active_prompt_id: "e6fe33d0-e259-4d3a-a426-44ea49f46505" }
  });

  assert.ok(out.includes("[user:primary] travel.location = Tahoe"));
  assert.ok(out.includes("Pending confirmations: 1"));
  assert.ok(out.includes("Active pending check: e6fe33d0"));
});

test("plugin /state-confirm command commits pending confirmation", async () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);

  const event = {
    event_id: "9e9169e4-aedf-470c-b979-3d06a2dedec7",
    event_ts: new Date().toISOString(),
    domain: "travel",
    entity_id: "user:primary",
    field: "travel.telegram_bridge_test",
    candidate_value: "We are in Tahoe now.",
    intent: "assertive",
    source: {
      type: "conversation_planning",
      ref: "test:bridge"
    },
    corroborators: []
  };

  const ingested = ingestObservation(rootDir, event, { forceCommit: false });
  assert.equal(ingested.status, "pending_confirmation");

  const registered = {
    command: null
  };
  const fakeApi = {
    pluginConfig: {
      rootDir,
      stateScriptPath: path.join(path.resolve(__dirname, ".."), "scripts", "state-consistency.js")
    },
    config: {
      workspace: {
        dir: rootDir
      }
    },
    resolvePath(input) {
      return path.resolve(String(input));
    },
    on() {},
    registerCommand(command) {
      registered.command = command;
    },
    logger: {}
  };

  plugin(fakeApi);
  assert.ok(registered.command);

  const reply = await registered.command.handler({
    channel: "telegram",
    isAuthorizedSender: true,
    args: "yes"
  });
  assert.ok(typeof reply.text === "string");
  assert.ok(reply.text.toLowerCase().includes("confirmed"));

  const state = loadState(rootDir);
  const record = state.entities?.["user:primary"]?.state?.travel?.telegram_bridge_test;
  assert.equal(record?.value, "We are in Tahoe now.");
});
