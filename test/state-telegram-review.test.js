"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  stripConversationEnvelope,
  parseDecisionFromText,
  buildPromptMessage
} = require("../scripts/state-telegram-review");

test("stripConversationEnvelope removes metadata wrappers", () => {
  const input = [
    "Conversation info (untrusted metadata):",
    "```json",
    "{\"conversation_label\":\"User id:1234567890\"}",
    "```",
    "",
    "confirm"
  ].join("\n");
  const cleaned = stripConversationEnvelope(input);
  assert.equal(cleaned, "confirm");
});

test("parseDecisionFromText supports confirm/reject/edit commands", () => {
  assert.equal(parseDecisionFromText("confirm").action, "confirm");
  assert.equal(parseDecisionFromText("reject").action, "reject");
  const edited = parseDecisionFromText("edit: \"Tahoe Saturday\"");
  assert.equal(edited.action, "edit");
  assert.equal(edited.editedValue, "Tahoe Saturday");
});

test("parseDecisionFromText supports prompt-id prefixed commands", () => {
  const id = "2013aa48-c103-403c-aa55-cbd3cf226e71";
  const parsed = parseDecisionFromText(`${id} edit: {"status":"done"}`);
  assert.equal(parsed.action, "edit");
  assert.equal(parsed.promptId, id);
  assert.deepEqual(parsed.editedValue, { status: "done" });
});

test("buildPromptMessage renders concise conversational prompt", () => {
  const msg = buildPromptMessage({
    prompt_id: "2013aa48-c103-403c-aa55-cbd3cf226e71",
    domain: "travel",
    confidence: 0.83,
    observation_event: {
      field: "travel.location",
      candidate_value: "Tahoe"
    }
  }, 1, 16);

  assert.match(msg, /State confirmation 1\/16/);
  assert.match(msg, /Prompt ID:/);
  assert.match(msg, /Reply with one:/);
  assert.match(msg, /confirm/);
});
