#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { loadState } = require("./state-consistency");
const DEFAULT_ENTITY_ID = "user:primary";

function nowIso() {
  return new Date().toISOString();
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDirForFile(filePath);
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function parseArgs(argv) {
  const out = { _: [] };
  let key = null;
  for (const token of argv) {
    if (token.startsWith("--")) {
      key = token.slice(2);
      out[key] = true;
      continue;
    }
    if (key) {
      out[key] = token;
      key = null;
      continue;
    }
    out._.push(token);
  }
  return out;
}

function getPaths(rootDir) {
  const home = process.env.HOME || "";
  const agentsRoot = path.join(home, ".openclaw", "agents");
  const sessionStores = [];
  if (fs.existsSync(agentsRoot)) {
    for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const sessionsDir = path.join(agentsRoot, entry.name, "sessions");
      const sessionsIndex = path.join(sessionsDir, "sessions.json");
      if (!fs.existsSync(sessionsIndex)) {
        continue;
      }
      sessionStores.push({
        agent: entry.name,
        sessionsDir,
        sessionsIndex
      });
    }
  }
  if (sessionStores.length === 0) {
    sessionStores.push({
      agent: "main",
      sessionsDir: path.join(home, ".openclaw", "agents", "main", "sessions"),
      sessionsIndex: path.join(home, ".openclaw", "agents", "main", "sessions", "sessions.json")
    });
  }
  return {
    rootDir,
    cronConfig: path.join(rootDir, "cron-config.json"),
    reviewState: path.join(rootDir, "memory", "state-telegram-review-state.json"),
    sessionStores,
    stateConsistencyScript: path.join(rootDir, "scripts", "state-consistency.js")
  };
}

function resolveTelegramTarget(rootDir, explicitTarget) {
  if (explicitTarget) {
    return String(explicitTarget);
  }
  if (process.env.STATE_TELEGRAM_TARGET) {
    return process.env.STATE_TELEGRAM_TARGET;
  }
  const config = readJsonIfExists(path.join(rootDir, "cron-config.json"), {});
  if (config?.telegram?.ajId) {
    return String(config.telegram.ajId);
  }
  if (config?.telegram?.defaultTarget) {
    return String(config.telegram.defaultTarget);
  }
  return "";
}

function parseJsonFromMixedOutput(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return {};
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return {};
  }
  const jsonPart = text.slice(first, last + 1);
  try {
    return JSON.parse(jsonPart);
  } catch (_err) {
    return {};
  }
}

function sendTelegramMessage(target, message, threadId, buttons) {
  const args = ["message", "send", "--channel", "telegram", "--target", target, "--message", message, "--json"];
  if (threadId) {
    args.push("--thread-id", String(threadId));
  }
  if (Array.isArray(buttons) && buttons.length > 0) {
    args.push("--buttons", JSON.stringify(buttons));
  }
  const output = execFileSync("openclaw", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return parseJsonFromMixedOutput(output);
}

function readSessionSlice(sessionFile, startOffset) {
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return { text: "", nextOffset: 0 };
  }
  const stat = fs.statSync(sessionFile);
  const size = stat.size;
  if (!Number.isFinite(startOffset) || startOffset < 0) {
    startOffset = 0;
  }
  if (startOffset > size) {
    startOffset = 0;
  }
  if (startOffset === size) {
    return { text: "", nextOffset: size };
  }

  const fd = fs.openSync(sessionFile, "r");
  try {
    const length = size - startOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, startOffset);
    return { text: buffer.toString("utf8"), nextOffset: size };
  } finally {
    fs.closeSync(fd);
  }
}

function sessionTextFromMessageObject(message) {
  const content = message?.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function stripConversationEnvelope(text) {
  let out = String(text || "");
  out = out.replace(/Conversation info \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, "");
  out = out.replace(/^System:\s.*$/gim, "");
  out = out.replace(/^Current time:\s.*$/gim, "");
  return out.trim();
}

function parseMaybeJsonValue(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }
  const likelyJson = (
    raw.startsWith("{") ||
    raw.startsWith("[") ||
    raw === "null" ||
    raw === "true" ||
    raw === "false" ||
    /^-?\d+(\.\d+)?$/.test(raw) ||
    (raw.startsWith("\"") && raw.endsWith("\""))
  );
  if (!likelyJson) {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return raw;
  }
}

function parseDecisionFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { action: "none" };
  }
  const callbackAction = raw.match(/^state_(confirm|reject|edit):([0-9a-f-]{8,36})$/i);
  if (callbackAction) {
    const action = callbackAction[1].toLowerCase();
    const promptId = callbackAction[2].toLowerCase();
    if (action === "edit") {
      return { action: "edit_help", promptId };
    }
    return { action, promptId };
  }

  const shortRefAction = raw.match(/^(confirm|reject|edit)\s+([0-9a-f-]{8,36})\b[:\s-]*(.*)$/i);
  if (shortRefAction) {
    const action = shortRefAction[1].toLowerCase();
    const promptId = shortRefAction[2].toLowerCase();
    if (action === "edit") {
      const maybeValue = String(shortRefAction[3] || "").trim();
      if (!maybeValue) {
        return { action: "edit_help", promptId };
      }
      return { action: "edit", promptId, editedValue: parseMaybeJsonValue(maybeValue) };
    }
    return { action, promptId };
  }

  const idAction = raw.match(/([0-9a-f]{8}-[0-9a-f-]{27,})\s+(confirm|reject|edit)\b[:\s-]*(.*)$/i);
  if (idAction) {
    const action = idAction[2].toLowerCase();
    if (action === "edit") {
      const maybeValue = String(idAction[3] || "").trim();
      if (!maybeValue) {
        return {
          action: "edit_help",
          promptId: idAction[1].toLowerCase()
        };
      }
      return {
        action: "edit",
        promptId: idAction[1].toLowerCase(),
        editedValue: parseMaybeJsonValue(maybeValue)
      };
    }
    return {
      action,
      promptId: idAction[1].toLowerCase()
    };
  }

  const lower = raw.toLowerCase();
  if (/^(confirm|approved?|yes|y|ok|okay)\b/.test(lower)) {
    return { action: "confirm" };
  }
  if (/^(reject|decline|no|n)\b/.test(lower)) {
    return { action: "reject" };
  }
  if (/^(edit|change)\b$/.test(lower)) {
    return { action: "edit_help" };
  }

  const editMatch = raw.match(/^(?:edit|change|set)\s*[:\-]\s*([\s\S]+)$/i);
  if (editMatch) {
    return { action: "edit", editedValue: parseMaybeJsonValue(editMatch[1]) };
  }

  return { action: "none" };
}

function parseNewUserMessages(sessionFile, cursorOffset) {
  const { text, nextOffset } = readSessionSlice(sessionFile, cursorOffset);
  if (!text.trim()) {
    return { userMessages: [], nextOffset };
  }
  const userMessages = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const obj = JSON.parse(trimmed);
      if (obj?.type !== "message") {
        continue;
      }
      if (obj?.message?.role !== "user") {
        continue;
      }
      const sourceText = sessionTextFromMessageObject(obj.message);
      const cleanedText = stripConversationEnvelope(sourceText);
      if (!cleanedText) {
        continue;
      }
      userMessages.push({
        id: obj.id || "",
        timestamp: obj.timestamp || "",
        rawText: sourceText,
        text: cleanedText
      });
    } catch (_err) {
      continue;
    }
  }
  return { userMessages, nextOffset };
}

function resolveSessionInfo(paths, target) {
  const prefixedTarget = `telegram:${target}`;
  const candidates = [];

  for (const store of paths.sessionStores || []) {
    const sessions = readJsonIfExists(store.sessionsIndex, {});
    for (const [key, entry] of Object.entries(sessions)) {
      if (!entry || !entry.sessionId) {
        continue;
      }
      const from = entry?.origin?.from || "";
      const to = entry?.origin?.to || "";
      const lastTo = entry?.lastTo || "";
      const matches = (
        key.includes(prefixedTarget) ||
        from === prefixedTarget ||
        to === prefixedTarget ||
        lastTo === prefixedTarget
      );
      if (!matches) {
        continue;
      }
      const sessionFile = entry.sessionFile || path.join(store.sessionsDir, `${entry.sessionId}.jsonl`);
      candidates.push({
        agent: store.agent,
        key,
        sessionId: entry.sessionId,
        sessionFile,
        updatedAt: Number(entry.updatedAt || 0)
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    const aExists = fs.existsSync(a.sessionFile) ? 1 : 0;
    const bExists = fs.existsSync(b.sessionFile) ? 1 : 0;
    return bExists - aExists;
  });

  const best = candidates[0];
  return {
    agent: best.agent,
    key: best.key,
    sessionId: best.sessionId,
    sessionFile: best.sessionFile
  };
}

function getPendingConfirmations(rootDir, entityId) {
  const state = loadState(rootDir);
  const pending = Object.values(state.pending_confirmations || {});
  return pending
    .filter((item) => !entityId || item.entity_id === entityId)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function summarizeValue(value, maxLen = 260) {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch (_err) {
      text = String(value);
    }
  }
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, maxLen - 1)}…`;
}

function toConfirmationPhrase(candidateValue) {
  if (typeof candidateValue !== "string") {
    return "this update is correct";
  }
  let phrase = candidateValue.trim();
  if (!phrase) {
    return "this update is correct";
  }
  phrase = phrase.replace(/[.?!]+$/, "");
  phrase = phrase.replace(/^we are\b/i, "you are");
  phrase = phrase.replace(/^we're\b/i, "you are");
  phrase = phrase.replace(/^i am\b/i, "you are");
  phrase = phrase.replace(/^i'm\b/i, "you are");
  phrase = phrase.trim();
  if (!phrase) {
    return "this update is correct";
  }
  return phrase;
}

function buildPromptMessage(pending, index, total) {
  const domain = String(pending?.domain || "general").toLowerCase();
  const phrase = toConfirmationPhrase(pending?.observation_event?.candidate_value);
  return `I detected a possible ${domain} update. Could you confirm ${phrase}?`;
}

function buildPromptButtons(promptId) {
  const id = String(promptId || "");
  return [
    [
      { text: "Yes", callback_data: `/state-confirm ${id} yes` },
      { text: "No", callback_data: `/state-confirm ${id} no` }
    ]
  ];
}

function runConfirmCommand(paths, promptId, decision) {
  const args = [
    paths.stateConsistencyScript,
    "confirm",
    "--root", paths.rootDir,
    "--prompt-id", promptId,
    "--action", decision.action
  ];
  if (decision.action === "edit") {
    args.push("--edited-value", JSON.stringify(decision.editedValue));
  }
  const output = execFileSync("node", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return parseJsonFromMixedOutput(output);
}

function defaultReviewRuntimeState(target, entityId) {
  return {
    version: 1,
    target,
    entity_id: entityId,
    session_id: "",
    session_file: "",
    session_cursor: 0,
    active_prompt_id: "",
    active_message_id: "",
    last_dispatched_at: "",
    last_decision_at: ""
  };
}

function matchesPromptReference(activePromptId, decisionPromptId) {
  const active = String(activePromptId || "").toLowerCase();
  const ref = String(decisionPromptId || "").toLowerCase();
  if (!ref) {
    return true;
  }
  if (active === ref) {
    return true;
  }
  if (ref.length >= 8 && active.startsWith(ref)) {
    return true;
  }
  return false;
}

function summarizePendingChange(pending) {
  const field = pending?.observation_event?.field || pending?.proposed_change || "state update";
  const value = summarizeValue(pending?.observation_event?.candidate_value, 180);
  return `${field} = ${value}`;
}

function findPendingPrompt(rootDir, promptId) {
  const state = loadState(rootDir);
  return state?.pending_confirmations?.[promptId] || null;
}

function pickDecisionForActivePrompt(userMessages, activePromptId) {
  for (let i = userMessages.length - 1; i >= 0; i -= 1) {
    const msg = userMessages[i];
    const decision = parseDecisionFromText(msg.text);
    if (!decision || decision.action === "none") {
      continue;
    }
    if (!matchesPromptReference(activePromptId, decision.promptId)) {
      continue;
    }
    return {
      ...decision,
      fromMessageId: msg.id,
      fromTimestamp: msg.timestamp,
      rawText: msg.text
    };
  }
  return null;
}

function syncReviewOnce(rootDir, options = {}) {
  const paths = getPaths(rootDir);
  const target = resolveTelegramTarget(rootDir, options.target);
  if (!target) {
    throw new Error("Telegram target is required. Use --target, STATE_TELEGRAM_TARGET, or cron-config.json telegram.ajId/defaultTarget.");
  }
  const entityId = options.entity_id || process.env.STATE_ENTITY_ID || DEFAULT_ENTITY_ID;
  const threadId = options.thread_id || "";
  const dryRun = Boolean(options.dry_run);

  const runtime = {
    ...defaultReviewRuntimeState(target, entityId),
    ...readJsonIfExists(paths.reviewState, {})
  };
  runtime.target = target;
  runtime.entity_id = entityId;

  const sessionInfo = resolveSessionInfo(paths, target);
  if (sessionInfo) {
    runtime.session_id = sessionInfo.sessionId;
    runtime.session_file = sessionInfo.sessionFile;
  }

  const result = {
    status: "ok",
    target,
    session_id: runtime.session_id || null,
    session_agent: sessionInfo?.agent || null,
    active_prompt_id: runtime.active_prompt_id || null,
    decision_applied: null,
    dispatched_prompt_id: null
  };

  if (runtime.session_file) {
    const parsed = parseNewUserMessages(runtime.session_file, Number(runtime.session_cursor || 0));
    runtime.session_cursor = parsed.nextOffset;

    if (runtime.active_prompt_id) {
      const decision = pickDecisionForActivePrompt(parsed.userMessages, runtime.active_prompt_id);
      if (decision) {
        const pendingForContext = findPendingPrompt(rootDir, runtime.active_prompt_id);
        const shortId = String(runtime.active_prompt_id || "").slice(0, 8);
        if (decision.action === "edit_help") {
          if (!dryRun) {
            sendTelegramMessage(
              target,
              [
                "Got it. Send your override like this:",
                `edit ${shortId} <new value>`,
                "",
                `Example: edit ${shortId} \"Tahoe, Northstar\"`,
                pendingForContext ? `Current suggestion: ${summarizePendingChange(pendingForContext)}` : ""
              ].filter(Boolean).join("\n"),
              threadId
            );
          }
        } else {
          const confirmResult = dryRun
            ? { status: "dry_run", prompt_id: runtime.active_prompt_id, action: decision.action }
            : runConfirmCommand(paths, runtime.active_prompt_id, decision);

          result.decision_applied = {
            prompt_id: runtime.active_prompt_id,
            action: decision.action,
            from_message_id: decision.fromMessageId || "",
            confirm_status: confirmResult.status || "unknown"
          };

          if (!dryRun) {
            const ack = decision.action === "confirm"
              ? [
                  "Perfect, confirmed.",
                  pendingForContext ? `Saved: ${summarizePendingChange(pendingForContext)}.` : "State updated.",
                  "I’ll use this going forward."
                ].join("\n")
              : decision.action === "reject"
                ? "Understood. I dropped that suggestion and kept state unchanged."
                : "Done. I saved your edited value and updated state.";
            sendTelegramMessage(target, ack, threadId);
            sendTelegramMessage(target, "Context synced to canonical state.", threadId);
          }
          runtime.last_decision_at = nowIso();
          runtime.active_prompt_id = "";
          runtime.active_message_id = "";
        }
      }
    }
  }

  const pending = getPendingConfirmations(rootDir, entityId);
  const activeStillPending = runtime.active_prompt_id && pending.some((p) => p.prompt_id === runtime.active_prompt_id);
  if (!activeStillPending) {
    runtime.active_prompt_id = "";
  }

  if (!runtime.active_prompt_id && pending.length > 0) {
    const next = pending[0];
    const message = buildPromptMessage(next, 1, pending.length);
    const buttons = buildPromptButtons(next.prompt_id);
    const sendResult = dryRun ? { payload: { messageId: "dry-run" } } : sendTelegramMessage(target, message, threadId, buttons);
    runtime.active_prompt_id = next.prompt_id;
    runtime.active_message_id = String(sendResult?.payload?.messageId || "");
    runtime.last_dispatched_at = nowIso();
    result.dispatched_prompt_id = next.prompt_id;

    if (runtime.session_file && fs.existsSync(runtime.session_file)) {
      runtime.session_cursor = fs.statSync(runtime.session_file).size;
    }
  }

  if (!dryRun) {
    writeJson(paths.reviewState, runtime);
  }
  result.active_prompt_id = runtime.active_prompt_id || null;
  result.pending_count = pending.length;
  return result;
}

function usage() {
  process.stdout.write([
    "Usage: node scripts/state-telegram-review.js [options]",
    "",
    "Options:",
    "  --root <path>         Workspace root (default: cwd)",
    "  --target <chat-id>    Telegram chat target (default: cron-config.json telegram.ajId)",
    `  --entity-id <id>      Entity id filter (default: ${DEFAULT_ENTITY_ID})`,
    "  --thread-id <id>      Telegram thread id (optional)",
    "  --dry-run             Do not send/apply changes",
    "  --help                Show help"
  ].join("\n") + "\n");
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }
  const rootDir = path.resolve(args.root || process.cwd());
  try {
    const result = syncReviewOnce(rootDir, {
      target: args.target || "",
      entity_id: args["entity-id"] || process.env.STATE_ENTITY_ID || DEFAULT_ENTITY_ID,
      thread_id: args["thread-id"] || "",
      dry_run: Boolean(args["dry-run"])
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", message: error.message }, null, 2)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  stripConversationEnvelope,
  parseDecisionFromText,
  parseNewUserMessages,
  buildPromptMessage,
  buildPromptButtons,
  syncReviewOnce
};
