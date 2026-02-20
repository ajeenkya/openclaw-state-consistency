"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_ENTITY_ID = "user:primary";
const DEFAULT_INJECT_MAX_FIELDS = 32;
const DEFAULT_INGEST_MIN_CHARS = 12;
const DEFAULT_INGEST_MAX_PENDING = 10;
const DEFAULT_INGEST_SOURCE_TYPE = "conversation_planning";

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
  if (
    typeof api.loadState !== "function" ||
    typeof api.applyUserConfirmation !== "function" ||
    typeof api.ingestObservation !== "function"
  ) {
    throw new Error("state-consistency.js does not expose required functions");
  }
  return api;
}

function deterministicUuidFromText(text) {
  const hash = crypto.createHash("md5").update(String(text || ""), "utf8").digest();
  const bytes = Buffer.from(hash);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeInboundText(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNaturalConfirmationAction(input) {
  const token = normalizeInboundText(input)
    .toLowerCase()
    .replace(/[.!]+$/, "");

  if (!token) {
    return "";
  }
  if (["yes", "y", "yep", "yeah", "confirm", "confirmed", "correct", "true"].includes(token)) {
    return "confirm";
  }
  if (["no", "n", "nope", "nah", "reject", "rejected", "incorrect", "false"].includes(token)) {
    return "reject";
  }
  return "";
}

function parseStringSet(value) {
  if (Array.isArray(value)) {
    return new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
  }
  const raw = String(value || "").trim();
  if (!raw) {
    return new Set();
  }
  return new Set(raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function resolveIngestChannels(cfg) {
  const fromCfg = cfg?.ingestChannels;
  if (Array.isArray(fromCfg) && fromCfg.length > 0) {
    return parseStringSet(fromCfg);
  }
  const envValue = process.env.STATE_INGEST_CHANNELS || "";
  if (String(envValue).trim()) {
    return parseStringSet(envValue);
  }
  return new Set(["telegram"]);
}

function isChannelEnabled(enabledChannels, channelId) {
  if (!(enabledChannels instanceof Set) || enabledChannels.size === 0) {
    return true;
  }
  if (enabledChannels.has("*")) {
    return true;
  }
  return enabledChannels.has(String(channelId || "").toLowerCase());
}

function looksLikeSelfMessage(metadata) {
  const meta = metadata || {};
  if (meta.fromSelf === true || meta.isSelf === true || meta.isBot === true || meta.senderIsBot === true) {
    return true;
  }
  return false;
}

function shouldSkipInboundAssertion(text, minChars) {
  if (!text) {
    return true;
  }
  if (text.startsWith("/")) {
    return true;
  }
  if (text.length < minChars) {
    return true;
  }
  if (!/[a-zA-Z]/.test(text)) {
    return true;
  }
  if (/\?$/.test(text)) {
    return true;
  }
  return false;
}

function inferDomainFromText(text) {
  const line = String(text || "");
  if (/\b(tahoe|trip|travel|flight|northstar|drive|airport|hotel|booking)\b/i.test(line)) {
    return "travel";
  }
  if (/\b(veda|mithila|kids|family|school|class|daycare)\b/i.test(line)) {
    return "family";
  }
  if (/\b(budget|bill|payment|mortgage|credit|monarch|investment|transaction)\b/i.test(line)) {
    return "financial";
  }
  if (/\b(feature|project|deploy|ship|goal|work|airbnb|identity team)\b/i.test(line)) {
    return "project";
  }
  if (/\b(prefer|preference|profile|identity|name|timezone)\b/i.test(line)) {
    return "profile";
  }
  return "general";
}

function normalizeSourceType(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "conversation_assertive") {
    return "conversation_assertive";
  }
  return DEFAULT_INGEST_SOURCE_TYPE;
}

function coerceIsoTimestamp(rawTs) {
  if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
    const ms = rawTs > 10_000_000_000 ? rawTs : rawTs * 1000;
    const date = new Date(ms);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }
  return nowIso();
}

function readInboundMessageId(event) {
  const metadata = event?.metadata || {};
  const messageId = (
    metadata.messageId ||
    metadata.message_id ||
    metadata.telegramMessageId ||
    metadata.id ||
    ""
  );
  return String(messageId || "").trim();
}

function buildInboundObservation(params) {
  const { event, ctx, stateApi, entityId, sourceType } = params;
  const text = normalizeInboundText(event?.content || "");
  const domain = inferDomainFromText(text);
  const field = `${domain}.current_assertion`;
  const channelId = String(ctx?.channelId || "unknown").toLowerCase() || "unknown";
  const conversationId = String(
    ctx?.conversationId ||
    event?.metadata?.threadId ||
    event?.metadata?.to ||
    event?.from ||
    "unknown"
  );
  const inboundMessageId = readInboundMessageId(event);
  const fingerprint = [
    channelId,
    conversationId,
    inboundMessageId || "(no-message-id)",
    String(event?.from || ""),
    String(event?.timestamp || ""),
    text
  ].join("|");
  const eventId = deterministicUuidFromText(`state-chat-observation:${fingerprint}`);

  let intent = "historical";
  try {
    if (typeof stateApi.classifyIntent === "function") {
      const classified = stateApi.classifyIntent(text);
      const nextIntent = String(classified?.intent || "").toLowerCase();
      if (["assertive", "planning", "hypothetical", "historical", "retract"].includes(nextIntent)) {
        intent = nextIntent;
      }
    }
  } catch (_error) {
    intent = "historical";
  }

  const refId = inboundMessageId || eventId.slice(0, 12);
  return {
    event_id: eventId,
    event_ts: coerceIsoTimestamp(event?.timestamp),
    domain,
    entity_id: entityId || DEFAULT_ENTITY_ID,
    field,
    candidate_value: text,
    intent,
    source: {
      type: normalizeSourceType(sourceType),
      ref: `message:${channelId}:${conversationId}:${refId}`
    },
    corroborators: []
  };
}

function maybeApplyNaturalDecision(params) {
  const { stateApi, rootDir, text } = params;
  const action = parseNaturalConfirmationAction(text);
  if (!action) {
    return { handled: false };
  }

  const state = stateApi.loadState(rootDir);
  const resolved = resolvePrompt(rootDir, state, "");
  if (resolved.error) {
    return { handled: false };
  }

  runConfirmFlow({
    stateApi,
    rootDir,
    parsed: { action },
    promptId: resolved.promptId,
    pending: resolved.pending
  });
  return {
    handled: true,
    action,
    promptId: resolved.promptId
  };
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
  const bridgeCfg = api.pluginConfig || {};
  const autoIngestInbound = bridgeCfg.autoIngestInbound !== false;
  const ingestChannels = resolveIngestChannels(bridgeCfg);
  const ingestMinChars = Math.max(
    3,
    Number(bridgeCfg.ingestMinChars || process.env.STATE_INGEST_MIN_CHARS || DEFAULT_INGEST_MIN_CHARS)
  );
  const ingestMaxPending = Math.max(
    1,
    Number(bridgeCfg.ingestMaxPending || process.env.STATE_INGEST_MAX_PENDING || DEFAULT_INGEST_MAX_PENDING)
  );
  const ingestSourceType = normalizeSourceType(
    bridgeCfg.ingestSourceType || process.env.STATE_INGEST_SOURCE_TYPE || DEFAULT_INGEST_SOURCE_TYPE
  );
  const ingestEntityId = String(bridgeCfg.entityId || process.env.STATE_ENTITY_ID || DEFAULT_ENTITY_ID);
  const ingestAllowedSenders = parseStringSet(bridgeCfg.ingestAllowedSenders || process.env.STATE_INGEST_ALLOWED_SENDERS || "");
  const projectOnIngest = bridgeCfg.projectOnIngest !== false;

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

  api.on("message_received", async (event, ctx) => {
    if (!autoIngestInbound) {
      return;
    }

    const channelId = String(ctx?.channelId || "").toLowerCase();
    if (!isChannelEnabled(ingestChannels, channelId)) {
      return;
    }
    if (ingestAllowedSenders.size > 0 && !ingestAllowedSenders.has(String(event?.from || "").toLowerCase())) {
      return;
    }
    if (looksLikeSelfMessage(event?.metadata)) {
      return;
    }

    const rootDir = resolveRootDir(api, "");
    const stateScriptPath = resolveStateScriptPath(api, rootDir);
    if (!stateScriptPath) {
      return;
    }

    let stateApi;
    try {
      stateApi = loadStateApi(stateScriptPath);
    } catch (error) {
      api.logger.warn?.(`state-consistency-bridge: failed to load runtime for message_received hook (${String(error.message || error)})`);
      return;
    }

    try {
      if (typeof stateApi.ensureStateFiles === "function") {
        stateApi.ensureStateFiles(rootDir);
      }
    } catch (_error) {
      // Ignore bootstrap failures; downstream reads will surface problems.
    }

    const text = normalizeInboundText(event?.content || "");
    if (!text) {
      return;
    }

    const decision = maybeApplyNaturalDecision({ stateApi, rootDir, text });
    if (decision.handled) {
      api.logger.info?.(`state-consistency-bridge: applied natural ${decision.action} for prompt ${decision.promptId.slice(0, 8)}`);
      return;
    }

    if (shouldSkipInboundAssertion(text, ingestMinChars)) {
      return;
    }

    const state = stateApi.loadState(rootDir);
    const pendingCount = Object.keys(state.pending_confirmations || {}).length;
    if (pendingCount >= ingestMaxPending) {
      api.logger.debug?.(`state-consistency-bridge: skipped inbound ingestion (pending cap reached: ${pendingCount}/${ingestMaxPending})`);
      return;
    }

    const observation = buildInboundObservation({
      event,
      ctx,
      stateApi,
      entityId: ingestEntityId,
      sourceType: ingestSourceType
    });
    const ingestResult = stateApi.ingestObservation(rootDir, observation, { forceCommit: false });

    if (ingestResult.status === "pending_confirmation" && ingestResult.prompt?.prompt_id) {
      updateReviewState(rootDir, ingestResult.prompt.prompt_id);
    }

    if (projectOnIngest && typeof stateApi.renderHeartbeatProjection === "function") {
      try {
        stateApi.renderHeartbeatProjection(rootDir, { entity_id: ingestEntityId });
      } catch (_error) {
        // Projection failures should not break inbound message processing.
      }
    }
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
  buildInboundObservation,
  buildCanonicalPrependContext,
  buildPromptButtons,
  buildPromptMessage,
  maybeApplyNaturalDecision,
  parseNaturalConfirmationAction,
  parseControlArgs,
  resolvePromptId,
  summarizeValue,
  toConfirmationPhrase
};
