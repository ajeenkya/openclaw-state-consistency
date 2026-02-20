"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_ENTITY_ID = "user:primary";
const DEFAULT_INJECT_MAX_FIELDS = 32;

function nowIso() {
  return new Date().toISOString();
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
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
  } catch (_error) {
    return raw;
  }
}

function summarizeValue(value, maxLen = 180) {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch (_error) {
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

function buildPromptMessage(pending) {
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

function getStateTrackerPath(rootDir) {
  return path.join(rootDir, "memory", "state-tracker.json");
}

function getReviewStatePath(rootDir) {
  return path.join(rootDir, "memory", "state-telegram-review-state.json");
}

function readReviewState(rootDir) {
  return readJsonIfExists(getReviewStatePath(rootDir), {});
}

function updateReviewState(rootDir, nextPromptId) {
  const filePath = getReviewStatePath(rootDir);
  const current = readJsonIfExists(filePath, {});
  const next = {
    ...current,
    active_prompt_id: nextPromptId || "",
    last_dispatched_at: nowIso()
  };
  writeJson(filePath, next);
}

function toStableStateEntries(state) {
  const entries = [];
  const entities = state?.entities || {};
  for (const entityId of Object.keys(entities).sort()) {
    const entityState = entities[entityId]?.state || {};
    for (const domain of Object.keys(entityState).sort()) {
      const domainState = entityState[domain] || {};
      for (const field of Object.keys(domainState).sort()) {
        entries.push({
          entity_id: entityId,
          domain,
          field,
          record: domainState[field]
        });
      }
    }
  }
  return entries;
}

function sortPending(pendingConfirmations) {
  return Object.values(pendingConfirmations || {})
    .filter(Boolean)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function resolvePromptId(pendingConfirmations, promptRef, activePromptId) {
  const keys = Object.keys(pendingConfirmations || {});
  if (keys.length === 0) {
    return { error: "No pending confirmations." };
  }
  if (promptRef) {
    if (pendingConfirmations[promptRef]) {
      return { promptId: promptRef };
    }
    const lower = String(promptRef).toLowerCase();
    const prefixed = keys.filter((id) => id.toLowerCase().startsWith(lower));
    if (prefixed.length === 1) {
      return { promptId: prefixed[0] };
    }
    if (prefixed.length > 1) {
      return {
        error: `Prompt reference is ambiguous (${prefixed.slice(0, 3).map((id) => id.slice(0, 8)).join(", ")}). Use more characters.`
      };
    }
    return { error: `Prompt not found: ${promptRef}` };
  }
  if (activePromptId && pendingConfirmations[activePromptId]) {
    return { promptId: activePromptId };
  }
  const sorted = sortPending(pendingConfirmations);
  if (sorted.length > 0) {
    return { promptId: sorted[0].prompt_id };
  }
  return { error: "No pending confirmations." };
}

function normalizeActionToken(raw) {
  const token = String(raw || "").trim().toLowerCase();
  if (!token) {
    return "";
  }
  if (token === "yes" || token === "confirm") {
    return "confirm";
  }
  if (token === "no" || token === "reject") {
    return "reject";
  }
  if (token === "edit") {
    return "edit";
  }
  return "";
}

function parseControlArgs(args) {
  const raw = String(args || "").trim();
  if (!raw) {
    return { action: "show", promptRef: "" };
  }

  const promptOnly = raw.match(/^([0-9a-f-]{8,36})$/i);
  if (promptOnly) {
    return { action: "show", promptRef: promptOnly[1].toLowerCase() };
  }

  const promptDecision = raw.match(/^([0-9a-f-]{8,36})\s+(yes|no|confirm|reject)$/i);
  if (promptDecision) {
    return {
      action: normalizeActionToken(promptDecision[2]),
      promptRef: promptDecision[1].toLowerCase()
    };
  }

  const decisionPrompt = raw.match(/^(yes|no|confirm|reject)\s+([0-9a-f-]{8,36})$/i);
  if (decisionPrompt) {
    return {
      action: normalizeActionToken(decisionPrompt[1]),
      promptRef: decisionPrompt[2].toLowerCase()
    };
  }

  const promptEdit = raw.match(/^([0-9a-f-]{8,36})\s+edit\s+([\s\S]+)$/i);
  if (promptEdit) {
    return {
      action: "edit",
      promptRef: promptEdit[1].toLowerCase(),
      editedValue: parseMaybeJsonValue(promptEdit[2])
    };
  }

  const editPrompt = raw.match(/^edit\s+([0-9a-f-]{8,36})\s+([\s\S]+)$/i);
  if (editPrompt) {
    return {
      action: "edit",
      promptRef: editPrompt[1].toLowerCase(),
      editedValue: parseMaybeJsonValue(editPrompt[2])
    };
  }

  const decisionOnly = raw.match(/^(yes|no|confirm|reject)$/i);
  if (decisionOnly) {
    return {
      action: normalizeActionToken(decisionOnly[1]),
      promptRef: ""
    };
  }

  if (/^edit$/i.test(raw)) {
    return {
      action: "invalid",
      error: "Edit requires a prompt id and value. Example: /state-confirm e6fe33d0 edit Tahoe, Northstar"
    };
  }

  return {
    action: "invalid",
    error: "Usage: /state-confirm [<promptId>] yes|no OR /state-confirm <promptId> edit <new value>"
  };
}

function safeResolvePath(api, input) {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }
  if (typeof api.resolvePath === "function") {
    return api.resolvePath(value);
  }
  return path.resolve(value);
}

function resolveRootDir(api, workspaceDirFromHook) {
  const cfg = api.pluginConfig || {};
  const fromCfg = safeResolvePath(api, cfg.rootDir);
  if (fromCfg) {
    return fromCfg;
  }

  const fromEnv = safeResolvePath(api, process.env.STATE_ROOT_DIR || "");
  if (fromEnv) {
    return fromEnv;
  }

  if (workspaceDirFromHook && String(workspaceDirFromHook).trim()) {
    return String(workspaceDirFromHook).trim();
  }

  const cfgWorkspace = safeResolvePath(api, api.config?.workspace?.dir || "");
  if (cfgWorkspace) {
    return cfgWorkspace;
  }

  return process.cwd();
}

function resolveStateScriptPath(api, rootDir) {
  const cfg = api.pluginConfig || {};
  const explicit = safeResolvePath(api, cfg.stateScriptPath || process.env.STATE_CONSISTENCY_SCRIPT || "");
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const inRoot = path.join(rootDir, "scripts", "state-consistency.js");
  if (fs.existsSync(inRoot)) {
    return inRoot;
  }

  const localRepo = path.resolve(__dirname, "..", "..", "scripts", "state-consistency.js");
  if (fs.existsSync(localRepo)) {
    return localRepo;
  }

  return "";
}

function loadStateApi(stateScriptPath) {
  if (!stateScriptPath || !fs.existsSync(stateScriptPath)) {
    throw new Error("state-consistency.js not found");
  }
  const api = require(stateScriptPath);
  if (typeof api.loadState !== "function" || typeof api.applyUserConfirmation !== "function") {
    throw new Error("state-consistency.js does not expose required functions");
  }
  return api;
}

function buildCanonicalPrependContext(state, options = {}) {
  const includePending = options.includePending !== false;
  const maxFields = Math.max(1, Number(options.maxFields || DEFAULT_INJECT_MAX_FIELDS));
  const reviewState = options.reviewState || {};
  const activePromptId = String(reviewState.active_prompt_id || "");

  const entries = toStableStateEntries(state);
  const lines = [];
  lines.push("Canonical state snapshot (machine-managed, latest known truth):");

  if (entries.length === 0) {
    lines.push("- No committed state fields yet.");
  } else {
    const visible = entries.slice(0, maxFields);
    for (const entry of visible) {
      const record = entry.record || {};
      lines.push(
        `- [${entry.entity_id}] ${entry.domain}.${entry.field} = ${summarizeValue(record.value)} (confidence=${record.confidence ?? "n/a"}, source=${record.source || "unknown"})`
      );
    }
    if (entries.length > visible.length) {
      lines.push(`- ... ${entries.length - visible.length} additional committed fields omitted`);
    }
  }

  if (includePending) {
    const pending = sortPending(state.pending_confirmations || {});
    lines.push("");
    lines.push(`Pending confirmations: ${pending.length}`);
    if (pending.length > 0) {
      const active = pending.find((item) => item.prompt_id === activePromptId) || pending[0];
      lines.push(
        `Active pending check: ${active.prompt_id.slice(0, 8)} ${active.observation_event?.field || active.proposed_change || "state change"} = ${summarizeValue(active.observation_event?.candidate_value)}`
      );
    }
  }

  lines.push("");
  lines.push("If chat context conflicts with this snapshot, prefer this snapshot.");
  return lines.join("\n");
}

function buildAckText(action, pending) {
  if (action === "confirm") {
    return `Confirmed. I saved ${pending.observation_event?.field || pending.proposed_change}.`;
  }
  if (action === "reject") {
    return "Understood. I dropped that suggestion and kept state unchanged.";
  }
  return "Done. I saved your edited value.";
}

function buildPromptReply(pending) {
  return {
    text: buildPromptMessage(pending),
    channelData: {
      telegram: {
        buttons: buildPromptButtons(pending.prompt_id)
      }
    }
  };
}

function pickNextPendingForEntity(pendingMap, entityId) {
  const pending = sortPending(pendingMap || {});
  if (!entityId) {
    return pending[0] || null;
  }
  return pending.find((item) => item.entity_id === entityId) || pending[0] || null;
}

function runConfirmFlow(params) {
  const { stateApi, rootDir, parsed, promptId, pending } = params;
  const action = parsed.action;
  const confirmation = {
    prompt_id: promptId,
    entity_id: pending.entity_id || DEFAULT_ENTITY_ID,
    domain: pending.domain || "general",
    proposed_change: pending.proposed_change || `${pending.observation_event?.field || "state"} -> ${summarizeValue(pending.observation_event?.candidate_value)}`,
    confidence: Number(pending.confidence || 0),
    reason_summary: Array.isArray(pending.reason_summary) ? pending.reason_summary : [],
    action,
    ts: nowIso()
  };
  if (action === "edit") {
    confirmation.edited_value = parsed.editedValue;
  }

  const result = stateApi.applyUserConfirmation(rootDir, confirmation);
  if (typeof stateApi.renderHeartbeatProjection === "function") {
    try {
      stateApi.renderHeartbeatProjection(rootDir, { entity_id: pending.entity_id || "" });
    } catch (_error) {
      // Projection failures should not block the confirmation flow.
    }
  }

  if (result.status !== "committed" && result.status !== "rejected") {
    return {
      reply: {
        text: `Could not apply confirmation (${result.status}).`
      }
    };
  }

  const updated = stateApi.loadState(rootDir);
  const next = pickNextPendingForEntity(updated.pending_confirmations || {}, pending.entity_id || DEFAULT_ENTITY_ID);
  updateReviewState(rootDir, next?.prompt_id || "");

  if (next) {
    return {
      reply: {
        text: `${buildAckText(action, pending)}\n\n${buildPromptMessage(next)}`,
        channelData: {
          telegram: {
            buttons: buildPromptButtons(next.prompt_id)
          }
        }
      }
    };
  }

  return {
    reply: {
      text: `${buildAckText(action, pending)}\n\nYou're all set. No other confirmations are pending.`
    }
  };
}

function resolvePrompt(rootDir, state, promptRef) {
  const pendingMap = state.pending_confirmations || {};
  const reviewState = readReviewState(rootDir);
  const resolved = resolvePromptId(pendingMap, promptRef, reviewState.active_prompt_id || "");
  if (resolved.error) {
    return { error: resolved.error };
  }
  const pending = pendingMap[resolved.promptId];
  if (!pending) {
    return { error: "No pending confirmations." };
  }
  return {
    promptId: resolved.promptId,
    pending
  };
}

function showPendingPrompt(rootDir, state, promptRef) {
  const resolved = resolvePrompt(rootDir, state, promptRef);
  if (resolved.error) {
    return {
      text: resolved.error
    };
  }
  updateReviewState(rootDir, resolved.promptId);
  return buildPromptReply(resolved.pending);
}

function registerStateConsistencyBridge(api) {
  api.on("before_agent_start", async (_event, ctx) => {
    const cfg = api.pluginConfig || {};
    if (cfg.injectContext === false) {
      return;
    }
    const rootDir = resolveRootDir(api, ctx.workspaceDir || "");
    const state = readJsonIfExists(getStateTrackerPath(rootDir), null);
    if (!state || typeof state !== "object") {
      return;
    }
    const reviewState = readReviewState(rootDir);
    const prependContext = buildCanonicalPrependContext(state, {
      maxFields: Number(cfg.injectMaxFields || DEFAULT_INJECT_MAX_FIELDS),
      includePending: cfg.includePending !== false,
      reviewState
    });
    if (!prependContext) {
      return;
    }
    return { prependContext };
  });

  api.registerCommand({
    name: "state-confirm",
    description: "Apply state confirmation from Telegram Yes/No buttons.",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const parsed = parseControlArgs(ctx.args || "");
      if (parsed.action === "invalid") {
        return { text: parsed.error };
      }

      const rootDir = resolveRootDir(api, "");
      const stateScriptPath = resolveStateScriptPath(api, rootDir);
      if (!stateScriptPath) {
        return {
          text: `State consistency script not found. Expected ${path.join(rootDir, "scripts", "state-consistency.js")}`
        };
      }

      let stateApi;
      try {
        stateApi = loadStateApi(stateScriptPath);
      } catch (error) {
        return { text: `Failed to load state runtime: ${String(error.message || error)}` };
      }

      try {
        if (typeof stateApi.ensureStateFiles === "function") {
          stateApi.ensureStateFiles(rootDir);
        }
      } catch (_error) {
        // Ignore bootstrap failures here; loadState will surface issues.
      }

      const state = stateApi.loadState(rootDir);
      if (parsed.action === "show") {
        return showPendingPrompt(rootDir, state, parsed.promptRef || "");
      }

      const resolved = resolvePrompt(rootDir, state, parsed.promptRef || "");
      if (resolved.error) {
        return { text: resolved.error };
      }

      return runConfirmFlow({
        stateApi,
        rootDir,
        parsed,
        promptId: resolved.promptId,
        pending: resolved.pending
      }).reply;
    }
  });
}

module.exports = registerStateConsistencyBridge;
module.exports._internal = {
  buildCanonicalPrependContext,
  buildPromptButtons,
  buildPromptMessage,
  parseControlArgs,
  resolvePromptId,
  summarizeValue,
  toConfirmationPhrase
};
