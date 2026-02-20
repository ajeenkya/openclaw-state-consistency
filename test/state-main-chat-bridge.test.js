"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const plugin = require("../plugins/state-consistency-bridge");
const { ensureStateFiles, ingestObservation, loadState } = require("../scripts/state-consistency");

const {
  buildInboundObservation,
  buildCanonicalPrependContext,
  buildPromptButtons,
  parseNaturalConfirmationAction,
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

function makeFakeApi(rootDir) {
  const registered = {
    command: null
  };
  const hooks = {};
  const api = {
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
    on(name, handler) {
      hooks[name] = handler;
    },
    registerCommand(command) {
      registered.command = command;
    },
    logger: {
      info() {},
      warn() {},
      debug() {}
    }
  };
  return { api, hooks, registered };
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

test("parseNaturalConfirmationAction maps plain yes/no words", () => {
  assert.equal(parseNaturalConfirmationAction("yes"), "confirm");
  assert.equal(parseNaturalConfirmationAction("No."), "reject");
  assert.equal(parseNaturalConfirmationAction("yeah"), "confirm");
  assert.equal(parseNaturalConfirmationAction("tell me more"), "");
});

test("buildInboundObservation creates deterministic event ids and source refs", () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);
  const stateApi = require("../scripts/state-consistency");

  const event = {
    from: "7986763678",
    content: "We are in Tahoe now.",
    timestamp: 1_708_800_000,
    metadata: { messageId: "tg-1" }
  };
  const ctx = {
    channelId: "telegram",
    conversationId: "7986763678"
  };

  const a = buildInboundObservation({
    event,
    ctx,
    stateApi,
    entityId: "user:primary",
    sourceType: "conversation_planning"
  });
  const b = buildInboundObservation({
    event,
    ctx,
    stateApi,
    entityId: "user:primary",
    sourceType: "conversation_planning"
  });

  assert.equal(a.event_id, b.event_id);
  assert.equal(a.domain, "travel");
  assert.equal(a.field, "travel.current_assertion");
  assert.equal(a.source.type, "conversation_planning");
  assert.ok(a.source.ref.includes("message:telegram:7986763678:tg-1"));
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

  const { api, registered } = makeFakeApi(rootDir);
  plugin(api);
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

test("message_received hook ingests assertions and natural yes commits active pending", async () => {
  const rootDir = mkWorkspace();
  ensureStateFiles(rootDir);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const { api, hooks } = makeFakeApi(rootDir);
  plugin(api);
  assert.equal(typeof hooks.message_received, "function");

  await hooks.message_received(
    {
      from: "7986763678",
      content: "We are in Tahoe now.",
      timestamp: nowSeconds,
      metadata: { messageId: "tg-assertion-1" }
    },
    {
      channelId: "telegram",
      conversationId: "7986763678"
    }
  );

  let state = loadState(rootDir);
  const pendingIds = Object.keys(state.pending_confirmations);
  assert.equal(pendingIds.length, 1);
  const prompt = state.pending_confirmations[pendingIds[0]];
  assert.equal(prompt.domain, "travel");
  assert.equal(prompt.observation_event.field, "travel.current_assertion");

  await hooks.message_received(
    {
      from: "7986763678",
      content: "yes",
      timestamp: nowSeconds + 1,
      metadata: { messageId: "tg-confirm-1" }
    },
    {
      channelId: "telegram",
      conversationId: "7986763678"
    }
  );

  state = loadState(rootDir);
  assert.equal(Object.keys(state.pending_confirmations).length, 0);
  assert.equal(
    state.entities?.["user:primary"]?.state?.travel?.current_assertion?.value,
    "We are in Tahoe now."
  );
});
