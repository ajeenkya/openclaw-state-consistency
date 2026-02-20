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

test("parseDecisionFromText supports callback-data style actions", () => {
  const id = "2013aa48-c103-403c-aa55-cbd3cf226e71";
  const confirm = parseDecisionFromText(`state_confirm:${id}`);
  assert.equal(confirm.action, "confirm");
  assert.equal(confirm.promptId, id);

  const reject = parseDecisionFromText(`state_reject:${id}`);
  assert.equal(reject.action, "reject");
  assert.equal(reject.promptId, id);

  const edit = parseDecisionFromText(`state_edit:${id}`);
  assert.equal(edit.action, "edit_help");
  assert.equal(edit.promptId, id);
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
      candidate_value: "We are in Tahoe now."
    }
  }, 1, 16);

  assert.equal(
    msg,
    "I detected a possible travel update. Could you confirm you are in Tahoe now?"
  );
});

test("buildPromptButtons returns only yes/no actions", () => {
  const id = "2013aa48-c103-403c-aa55-cbd3cf226e71";
  const buttons = buildPromptButtons(id);
  assert.equal(Array.isArray(buttons), true);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].length, 2);
  assert.equal(buttons[0][0].text, "Yes");
  assert.equal(buttons[0][1].text, "No");
  assert.equal(buttons[0][0].callback_data, `/state-confirm ${id} yes`);
  assert.equal(buttons[0][1].callback_data, `/state-confirm ${id} no`);
});
