"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  stripConversationEnvelope,
  parseDecisionFromText,
  buildPromptMessage,
  buildPromptButtons
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
  assert.equal(parseDecisionFromText("edit").action, "edit_help");
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

  assert.match(msg, /State update suggestion 1\/16/);
  assert.match(msg, /Domain: travel/);
  assert.match(msg, /Confidence: 83%/);
  assert.match(msg, /Choose one below/);
});

test("buildPromptButtons returns 3 inline actions", () => {
  const buttons = buildPromptButtons();
  assert.equal(Array.isArray(buttons), true);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].length, 2);
  assert.equal(buttons[1].length, 1);
  assert.equal(buttons[0][0].callback_data, "confirm");
  assert.equal(buttons[0][1].callback_data, "reject");
  assert.equal(buttons[1][0].callback_data, "edit");
});
