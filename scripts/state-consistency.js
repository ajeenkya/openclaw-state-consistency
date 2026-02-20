#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const MAX_PROCESSED_EVENT_IDS = 5000;
const MAX_TENTATIVE_OBSERVATIONS = 1000;
const DEFAULT_ENTITY_ID = "user:primary";

const DOMAIN_DEFAULTS = {
  travel: { ask_threshold: 0.65, auto_threshold: 0.9, margin_threshold: 0.15, calibration_remaining: 30 },
  family: { ask_threshold: 0.65, auto_threshold: 0.9, margin_threshold: 0.15, calibration_remaining: 30 },
  project: { ask_threshold: 0.65, auto_threshold: 0.9, margin_threshold: 0.2, calibration_remaining: 30 },
  financial: { ask_threshold: 0.7, auto_threshold: 0.92, margin_threshold: 0.2, calibration_remaining: 30 },
  profile: { ask_threshold: 0.7, auto_threshold: 0.95, margin_threshold: 0.25, calibration_remaining: 30 },
  school: { ask_threshold: 0.65, auto_threshold: 0.9, margin_threshold: 0.15, calibration_remaining: 30 },
  general: { ask_threshold: 0.7, auto_threshold: 0.92, margin_threshold: 0.2, calibration_remaining: 30 }
};

const SOURCE_RELIABILITY_DEFAULTS = {
  conversation_assertive: 0.9,
  conversation_planning: 0.75,
  calendar_poll: 0.85,
  calendar_webhook: 0.9,
  email_poll: 0.84,
  email_webhook: 0.88,
  transactions_email: 0.88,
  static_markdown: 0.6,
  manual_markdown: 0.75,
  system_migration: 0.72,
  user_confirmation: 1
};

const INTENT_FACTORS = {
  assertive: 1,
  planning: 0.72,
  hypothetical: 0.45,
  historical: 0.68,
  retract: 0.95
};

const FEW_SHOT_EXAMPLES = {
  travel: [
    { input: "We are in Tahoe now.", intent: "assertive" },
    { input: "We leave for Tahoe Sunday morning.", intent: "planning" },
    { input: "If weather clears, we might leave earlier.", intent: "hypothetical" }
  ],
  family: [
    { input: "Veda has class at 3 PM today.", intent: "assertive" },
    { input: "Kids will stay home tomorrow.", intent: "planning" },
    { input: "If she feels sick, she may skip school.", intent: "hypothetical" }
  ],
  project: [
    { input: "Feature X shipped this morning.", intent: "assertive" },
    { input: "I will work on migration this week.", intent: "planning" },
    { input: "We might delay this milestone.", intent: "hypothetical" }
  ],
  financial: [
    { input: "Mortgage payment posted today.", intent: "assertive" },
    { input: "We will rebalance next week.", intent: "planning" },
    { input: "If markets drop, we could buy more.", intent: "hypothetical" }
  ],
  profile: [
    { input: "AJ prefers concise action-oriented summaries.", intent: "assertive" },
    { input: "I should update this preference later.", intent: "planning" },
    { input: "Maybe this preference will change.", intent: "hypothetical" }
  ],
  school: [
    { input: "School is closed today.", intent: "assertive" },
    { input: "Class resumes Monday.", intent: "planning" },
    { input: "If snow worsens, school might cancel.", intent: "hypothetical" }
  ],
  general: [
    { input: "This is true right now.", intent: "assertive" },
    { input: "This will happen later.", intent: "planning" },
    { input: "This could happen.", intent: "hypothetical" }
  ]
};

const VALID_DOMAINS = Object.keys(DOMAIN_DEFAULTS);

function nowIso() {
  return new Date().toISOString();
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function deterministicUuidFromText(text) {
  const hash = crypto.createHash("md5").update(text, "utf8").digest();
  const bytes = Buffer.from(hash);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function randomUuid() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return deterministicUuidFromText(`${Date.now()}-${Math.random()}`);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readTextIfExists(filePath, fallback = "") {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, text, "utf8");
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExistsSafe(filePath, fallback) {
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

function appendLine(filePath, line) {
  ensureDirForFile(filePath);
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
}

function parseMaybeJson(input) {
  if (typeof input !== "string") {
    return input;
  }
  const trimmed = input.trim();
  if (trimmed === "") {
    return "";
  }
  const startsLikeJson = (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed === "null" ||
    trimmed === "true" ||
    trimmed === "false" ||
    /^-?\d+(\.\d+)?$/.test(trimmed) ||
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  );
  if (!startsLikeJson) {
    return input;
  }
  try {
    return JSON.parse(trimmed);
  } catch (_err) {
    return input;
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMarkdownLine(line) {
  return line
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPaths(rootDir) {
  return {
    rootDir,
    heartbeat: path.join(rootDir, "HEARTBEAT.md"),
    memory: path.join(rootDir, "MEMORY.md"),
    stateTracker: path.join(rootDir, "memory", "state-tracker.json"),
    stateChanges: path.join(rootDir, "memory", "state-changes.md"),
    stateDlq: path.join(rootDir, "memory", "state-dlq.jsonl"),
    schemas: {
      stateObservation: path.join(rootDir, "schemas", "state_observation.schema.json"),
      userConfirmation: path.join(rootDir, "schemas", "user_confirmation.schema.json"),
      signalEvent: path.join(rootDir, "schemas", "signal_event.schema.json")
    }
  };
}

function resolveGogAccount(rootDir, explicitAccount) {
  if (explicitAccount) {
    return explicitAccount;
  }
  const cronConfig = readJsonIfExistsSafe(path.join(rootDir, "cron-config.json"), {});
  return cronConfig?.accounts?.gogAccount || cronConfig?.accounts?.primary || "";
}

function createDefaultState() {
  return {
    version: 1,
    last_consistency_check: null,
    runtime: {
      projection_mode: "legacy_string",
      adaptive_learning_enabled: false,
      projection_hashes: {}
    },
    domains: JSON.parse(JSON.stringify(DOMAIN_DEFAULTS)),
    source_reliability: { ...SOURCE_RELIABILITY_DEFAULTS },
    entities: {},
    tentative_observations: [],
    active_conflicts: [],
    pending_confirmations: {},
    processed_event_ids: [],
    learning_stats: {
      auto_commits: 0,
      auto_commit_corrections: 0,
      ask_user_confirmations: 0
    }
  };
}

function ensureStateFiles(rootDir) {
  const paths = getPaths(rootDir);
  if (!fs.existsSync(paths.stateTracker)) {
    writeJson(paths.stateTracker, createDefaultState());
  }
  if (!fs.existsSync(paths.stateChanges)) {
    writeText(paths.stateChanges, "# State Changes Log\n\n");
  }
  if (!fs.existsSync(paths.stateDlq)) {
    writeText(paths.stateDlq, "");
  }
  return paths;
}

function loadState(rootDir) {
  const paths = ensureStateFiles(rootDir);
  const state = readJsonIfExists(paths.stateTracker, createDefaultState());
  state.runtime = state.runtime || { projection_mode: "legacy_string", adaptive_learning_enabled: false, projection_hashes: {} };
  state.runtime.projection_hashes = state.runtime.projection_hashes || {};
  state.domains = { ...DOMAIN_DEFAULTS, ...(state.domains || {}) };
  state.source_reliability = { ...SOURCE_RELIABILITY_DEFAULTS, ...(state.source_reliability || {}) };
  state.entities = state.entities || {};
  state.tentative_observations = state.tentative_observations || [];
  state.active_conflicts = state.active_conflicts || [];
  state.pending_confirmations = state.pending_confirmations || {};
  state.processed_event_ids = state.processed_event_ids || [];
  state.learning_stats = state.learning_stats || {
    auto_commits: 0,
    auto_commit_corrections: 0,
    ask_user_confirmations: 0
  };
  return state;
}

function saveState(rootDir, state) {
  const paths = getPaths(rootDir);
  state.last_consistency_check = nowIso();
  writeJson(paths.stateTracker, state);
}

function logStateChange(rootDir, line) {
  const paths = getPaths(rootDir);
  appendLine(paths.stateChanges, `- ${nowIso()} | ${line}`);
}

function pushProcessedEventId(state, eventId) {
  if (state.processed_event_ids.includes(eventId)) {
    return;
  }
  state.processed_event_ids.push(eventId);
  if (state.processed_event_ids.length > MAX_PROCESSED_EVENT_IDS) {
    state.processed_event_ids.splice(0, state.processed_event_ids.length - MAX_PROCESSED_EVENT_IDS);
  }
}

function pushTentativeObservation(state, observation, confidence, reasons) {
  state.tentative_observations.push({
    observed_at: nowIso(),
    event_id: observation.event_id,
    event_ts: observation.event_ts,
    entity_id: observation.entity_id,
    domain: observation.domain,
    field: observation.field,
    candidate_value: observation.candidate_value,
    intent: observation.intent,
    source: observation.source,
    corroborators: observation.corroborators || [],
    confidence: round3(confidence),
    reasons
  });
  if (state.tentative_observations.length > MAX_TENTATIVE_OBSERVATIONS) {
    state.tentative_observations.splice(0, state.tentative_observations.length - MAX_TENTATIVE_OBSERVATIONS);
  }
}

function ensureEntityState(state, entityId, domain) {
  if (!state.entities[entityId]) {
    state.entities[entityId] = { state: {} };
  }
  if (!state.entities[entityId].state) {
    state.entities[entityId].state = {};
  }
  if (!state.entities[entityId].state[domain]) {
    state.entities[entityId].state[domain] = {};
  }
  return state.entities[entityId].state[domain];
}

function fieldKeyFromObservation(observation) {
  const prefix = `${observation.domain}.`;
  if (observation.field.startsWith(prefix)) {
    return observation.field.slice(prefix.length);
  }
  return observation.field;
}

function getCurrentFieldConfidence(state, observation) {
  const entity = state.entities[observation.entity_id];
  if (!entity || !entity.state || !entity.state[observation.domain]) {
    return 0;
  }
  const key = fieldKeyFromObservation(observation);
  const record = entity.state[observation.domain][key];
  if (!record || typeof record !== "object" || typeof record.confidence !== "number") {
    return 0;
  }
  return record.confidence;
}

function recencyFactor(eventTs) {
  const eventMs = Date.parse(eventTs);
  if (!Number.isFinite(eventMs)) {
    return 0.5;
  }
  const ageHours = Math.max(0, (Date.now() - eventMs) / (1000 * 60 * 60));
  const decayed = 1 - (Math.min(ageHours, 168) / 168) * 0.6;
  return clamp(decayed, 0.4, 1);
}

function computeConfidence(state, observation) {
  const source = state.source_reliability[observation.source.type] || 0.5;
  const intent = INTENT_FACTORS[observation.intent] || 0.5;
  const recency = recencyFactor(observation.event_ts);
  const corroborationCount = Array.isArray(observation.corroborators) ? observation.corroborators.length : 0;
  const corroboration = clamp(1 + corroborationCount * 0.05, 1, 1.2);
  const confidence = clamp(source * intent * recency * corroboration, 0, 1);
  return {
    confidence: round3(confidence),
    source,
    intent,
    recency,
    corroboration
  };
}

function resolveDecision(state, observation, analysis, options) {
  if (options.forceCommit) {
    return {
      decision: "auto_commit",
      margin: 1,
      reasons: ["force_commit=true"]
    };
  }

  const domainCfg = state.domains[observation.domain] || DOMAIN_DEFAULTS.general;
  const currentConfidence = getCurrentFieldConfidence(state, observation);
  const margin = round3(analysis.confidence - currentConfidence);

  if (analysis.confidence >= domainCfg.auto_threshold && margin >= domainCfg.margin_threshold) {
    return {
      decision: "auto_commit",
      margin,
      reasons: [
        `confidence(${analysis.confidence}) >= auto_threshold(${domainCfg.auto_threshold})`,
        `margin(${margin}) >= margin_threshold(${domainCfg.margin_threshold})`
      ]
    };
  }
  if (analysis.confidence >= domainCfg.ask_threshold) {
    return {
      decision: "ask_user",
      margin,
      reasons: [
        `confidence(${analysis.confidence}) >= ask_threshold(${domainCfg.ask_threshold})`,
        `confidence below auto-threshold or insufficient margin`
      ]
    };
  }
  return {
    decision: "tentative_reject",
    margin,
    reasons: [`confidence(${analysis.confidence}) < ask_threshold(${domainCfg.ask_threshold})`]
  };
}

function stringifyValue(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function applyCommittedObservation(state, observation, confidence) {
  const fieldKey = fieldKeyFromObservation(observation);
  const domainState = ensureEntityState(state, observation.entity_id, observation.domain);

  if (observation.intent === "retract" || observation.candidate_value === null) {
    delete domainState[fieldKey];
    return { fieldKey, retracted: true };
  }

  domainState[fieldKey] = {
    value: observation.candidate_value,
    last_update: observation.event_ts,
    source: observation.source.type,
    confidence: round3(confidence),
    event_id: observation.event_id
  };
  return { fieldKey, retracted: false };
}

function createPendingPrompt(observation, decisionMeta, analysis) {
  const promptId = randomUuid();
  const proposedChange = `${observation.field} -> ${stringifyValue(observation.candidate_value)}`;
  return {
    prompt_id: promptId,
    entity_id: observation.entity_id,
    domain: observation.domain,
    proposed_change: proposedChange,
    confidence: analysis.confidence,
    reason_summary: decisionMeta.reasons.slice(0, 5),
    action: "confirm",
    observation_event: observation,
    source: observation.source,
    created_at: nowIso()
  };
}

function loadSchemaValidators(rootDir) {
  const paths = getPaths(rootDir);
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);

  const observationSchema = readJsonIfExists(paths.schemas.stateObservation, null);
  const confirmationSchema = readJsonIfExists(paths.schemas.userConfirmation, null);
  const signalSchema = readJsonIfExists(paths.schemas.signalEvent, null);

  if (!observationSchema || !confirmationSchema || !signalSchema) {
    throw new Error("Schema files missing. Expected files under ./schemas/");
  }

  return {
    observation: ajv.compile(observationSchema),
    confirmation: ajv.compile(confirmationSchema),
    signal: ajv.compile(signalSchema)
  };
}

function writeDlqEntry(rootDir, schemaName, payload, errors, retryCount = 0, status = "pending_retry") {
  const paths = getPaths(rootDir);
  const now = Date.now();
  const retryScheduleMs = [60_000, 5 * 60_000, 30 * 60_000];
  const waitMs = retryScheduleMs[Math.min(retryCount, retryScheduleMs.length - 1)];
  const entry = {
    dlq_id: randomUuid(),
    schema_name: schemaName,
    payload,
    validation_errors: errors,
    first_seen_ts: new Date(now).toISOString(),
    retry_count: retryCount,
    next_retry_ts: new Date(now + waitMs).toISOString(),
    status
  };
  appendLine(paths.stateDlq, JSON.stringify(entry));
  return entry;
}

function validateOrDlq(rootDir, schemaName, payload) {
  const validators = loadSchemaValidators(rootDir);
  const validator = validators[schemaName];
  if (!validator) {
    throw new Error(`Unknown schema validator: ${schemaName}`);
  }
  const valid = validator(payload);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validator.errors || []).map((error) => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message,
    params: error.params
  }));
  const dlqEntry = writeDlqEntry(rootDir, schemaName, payload, errors);
  return { valid: false, errors, dlqEntry };
}

function ingestObservation(rootDir, observation, options = {}) {
  ensureStateFiles(rootDir);
  const validation = validateOrDlq(rootDir, "observation", observation);
  if (!validation.valid) {
    return {
      status: "validation_failed",
      errors: validation.errors,
      dlq: validation.dlqEntry
    };
  }

  const state = loadState(rootDir);
  if (state.processed_event_ids.includes(observation.event_id)) {
    return { status: "duplicate", event_id: observation.event_id };
  }

  const analysis = computeConfidence(state, observation);
  const decisionMeta = resolveDecision(state, observation, analysis, options);

  pushProcessedEventId(state, observation.event_id);

  if (decisionMeta.decision === "auto_commit") {
    const commitResult = applyCommittedObservation(state, observation, analysis.confidence);
    state.learning_stats.auto_commits += 1;
    saveState(rootDir, state);
    logStateChange(
      rootDir,
      `${observation.event_id} | decision=auto_commit | ${observation.entity_id}/${observation.domain}.${commitResult.fieldKey} | value=${stringifyValue(observation.candidate_value)} | confidence=${analysis.confidence} | source=${observation.source.type}`
    );
    return {
      status: "committed",
      decision: decisionMeta.decision,
      confidence: analysis.confidence,
      margin: decisionMeta.margin,
      reasons: decisionMeta.reasons
    };
  }

  if (decisionMeta.decision === "ask_user") {
    const prompt = createPendingPrompt(observation, decisionMeta, analysis);
    state.pending_confirmations[prompt.prompt_id] = prompt;
    saveState(rootDir, state);
    logStateChange(
      rootDir,
      `${observation.event_id} | decision=ask_user | prompt_id=${prompt.prompt_id} | ${observation.entity_id}/${observation.field} | confidence=${analysis.confidence}`
    );
    return {
      status: "pending_confirmation",
      decision: decisionMeta.decision,
      confidence: analysis.confidence,
      margin: decisionMeta.margin,
      prompt
    };
  }

  pushTentativeObservation(state, observation, analysis.confidence, decisionMeta.reasons);
  saveState(rootDir, state);
  logStateChange(
    rootDir,
    `${observation.event_id} | decision=tentative_reject | ${observation.entity_id}/${observation.field} | confidence=${analysis.confidence}`
  );
  return {
    status: "tentative",
    decision: decisionMeta.decision,
    confidence: analysis.confidence,
    margin: decisionMeta.margin,
    reasons: decisionMeta.reasons
  };
}

function getPendingConfirmation(rootDir, promptId) {
  const state = loadState(rootDir);
  return state.pending_confirmations[promptId] || null;
}

function applyUserConfirmation(rootDir, confirmation) {
  ensureStateFiles(rootDir);
  const validation = validateOrDlq(rootDir, "confirmation", confirmation);
  if (!validation.valid) {
    return {
      status: "validation_failed",
      errors: validation.errors,
      dlq: validation.dlqEntry
    };
  }

  const state = loadState(rootDir);
  const pending = state.pending_confirmations[confirmation.prompt_id];
  if (!pending) {
    return {
      status: "not_found",
      message: `No pending prompt found for prompt_id=${confirmation.prompt_id}`
    };
  }

  if (pending.entity_id !== confirmation.entity_id || pending.domain !== confirmation.domain) {
    return {
      status: "mismatch",
      message: "Confirmation entity/domain does not match pending prompt."
    };
  }

  state.learning_stats.ask_user_confirmations += 1;
  delete state.pending_confirmations[confirmation.prompt_id];

  if (confirmation.action === "reject") {
    saveState(rootDir, state);
    logStateChange(rootDir, `prompt=${confirmation.prompt_id} | action=reject | no state mutation`);
    return {
      status: "rejected",
      prompt_id: confirmation.prompt_id
    };
  }

  const baseObservation = pending.observation_event;
  const committedObservation = {
    ...baseObservation,
    event_id: randomUuid(),
    event_ts: confirmation.ts || nowIso(),
    intent: "assertive",
    candidate_value: confirmation.action === "edit" ? confirmation.edited_value : baseObservation.candidate_value,
    source: {
      type: "user_confirmation",
      ref: `prompt:${confirmation.prompt_id}`
    }
  };

  const observationValidation = validateOrDlq(rootDir, "observation", committedObservation);
  if (!observationValidation.valid) {
    saveState(rootDir, state);
    return {
      status: "validation_failed",
      errors: observationValidation.errors,
      dlq: observationValidation.dlqEntry
    };
  }

  const analysis = computeConfidence(state, committedObservation);
  const commitResult = applyCommittedObservation(state, committedObservation, analysis.confidence);
  saveState(rootDir, state);
  logStateChange(
    rootDir,
    `prompt=${confirmation.prompt_id} | action=${confirmation.action} | committed=${committedObservation.entity_id}/${committedObservation.domain}.${commitResult.fieldKey} | value=${stringifyValue(committedObservation.candidate_value)}`
  );
  return {
    status: "committed",
    prompt_id: confirmation.prompt_id,
    action: confirmation.action,
    committed_event_id: committedObservation.event_id
  };
}

function domainFromText(text) {
  if (/\b(tahoe|trip|travel|flight|northstar|drive)\b/i.test(text)) {
    return "travel";
  }
  if (/\b(veda|mithila|kids|family|school|class)\b/i.test(text)) {
    return "family";
  }
  if (/\b(budget|bill|payment|mortgage|credit|monarch|investment|transaction)\b/i.test(text)) {
    return "financial";
  }
  if (/\b(feature|project|deploy|ship|goal|work|airbnb)\b/i.test(text)) {
    return "project";
  }
  if (/\b(prefer|preference|profile|identity|name|timezone)\b/i.test(text)) {
    return "profile";
  }
  return "general";
}

function sanitizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "item";
}

function parseIsoMaybe(value) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

function normalizeRelativeDayExpr(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^([+-]?\d+)\s*days?$/i);
  if (!match) {
    return raw || value;
  }
  const offsetDays = Number(match[1]);
  if (!Number.isFinite(offsetDays)) {
    return raw;
  }
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function runGogJson(args, account) {
  const cmdArgs = [
    ...args,
    ...(account ? ["--account", account] : []),
    "-j",
    "--results-only"
  ];
  try {
    const output = execFileSync("gog", cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const trimmed = output.trim();
    if (!trimmed) {
      return [];
    }
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === "object") {
      return [parsed];
    }
    return [];
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const message = stderr || stdout || error.message;
    throw new Error(`gog command failed: gog ${cmdArgs.join(" ")} | ${message}`);
  }
}

function inferDomainFromCalendarEvent(event) {
  const text = [
    event.summary || "",
    event.description || "",
    event.location || ""
  ].join(" ");
  const base = domainFromText(text);
  if (base === "family" && /\bschool|class|lesson\b/i.test(text)) {
    return "school";
  }
  return base;
}

function normalizeCalendarValue(event) {
  const startRaw = event.start?.dateTime || event.start?.date || null;
  const endRaw = event.end?.dateTime || event.end?.date || null;
  return {
    event_id: event.id || null,
    summary: event.summary || "(no title)",
    status: event.status || "unknown",
    start: parseIsoMaybe(startRaw) || startRaw,
    end: parseIsoMaybe(endRaw) || endRaw,
    location: event.location || "",
    html_link: event.htmlLink || "",
    updated: parseIsoMaybe(event.updated) || event.updated || null
  };
}

function calendarEventsToSignal(entityId, events, sourceRef, mode = "poll") {
  const items = (events || []).map((event) => {
    const domain = inferDomainFromCalendarEvent(event);
    const token = sanitizeToken(event.id || `${event.summary || "event"}_${event.start?.dateTime || event.start?.date || ""}`);
    return {
      domain,
      field: `${domain}.calendar_event_${token}`,
      ref: `calendar_event:${event.id || token}`,
      value: normalizeCalendarValue(event),
      intent: "assertive",
      corroborators: []
    };
  });
  return {
    signal_id: randomUuid(),
    event_ts: nowIso(),
    source: {
      kind: "calendar",
      mode,
      ref: sourceRef
    },
    entity_id: entityId,
    items
  };
}

function inferDomainFromEmailThread(thread) {
  const text = `${thread.subject || ""} ${thread.from || ""}`.trim();
  const labels = Array.isArray(thread.labels) ? thread.labels.join(" ") : "";
  if (/\b(chase|visa|mastercard|payment|invoice|statement|bank|robinhood|mortgage|credit)\b/i.test(text + " " + labels)) {
    return "financial";
  }
  if (/\b(calendar|flight|trip|travel|airline|hotel|reservation|tahoe)\b/i.test(text + " " + labels)) {
    return "travel";
  }
  if (/\b(school|class|teacher|kids|daycare)\b/i.test(text + " " + labels)) {
    return "school";
  }
  return domainFromText(text);
}

function normalizeEmailValue(thread) {
  return {
    thread_id: thread.id || null,
    subject: thread.subject || "",
    from: thread.from || "",
    date: thread.date || "",
    labels: Array.isArray(thread.labels) ? thread.labels : [],
    message_count: thread.messageCount || 0
  };
}

function gmailThreadsToSignal(entityId, threads, sourceRef, mode = "poll") {
  const items = (threads || []).map((thread) => {
    const domain = inferDomainFromEmailThread(thread);
    const token = sanitizeToken(thread.id || thread.subject || "thread");
    return {
      domain,
      field: `${domain}.email_thread_${token}`,
      ref: `gmail_thread:${thread.id || token}`,
      value: normalizeEmailValue(thread),
      intent: "historical",
      corroborators: []
    };
  });
  return {
    signal_id: randomUuid(),
    event_ts: nowIso(),
    source: {
      kind: "email",
      mode,
      ref: sourceRef
    },
    entity_id: entityId,
    items
  };
}

function classifyIntent(text) {
  const line = text.toLowerCase();
  if (/\b(if|might|maybe|could|would)\b/.test(line)) {
    return { intent: "hypothetical", confidence: 0.62, reason: "conditional language detected" };
  }
  if (/\b(will|plan|planning|tomorrow|next|later|should|need to)\b/.test(line)) {
    return { intent: "planning", confidence: 0.78, reason: "future/planning language detected" };
  }
  if (/\b(yesterday|last|earlier|previously|was|were)\b/.test(line)) {
    return { intent: "historical", confidence: 0.72, reason: "historical language detected" };
  }
  if (/\b(i am|we are|is|are|currently|now|today|already|just)\b/.test(line)) {
    return { intent: "assertive", confidence: 0.82, reason: "current-state assertion language detected" };
  }
  return { intent: "historical", confidence: 0.55, reason: "default fallback classification" };
}

function buildFewShotPrompt(domain, text) {
  const examples = FEW_SHOT_EXAMPLES[domain] || FEW_SHOT_EXAMPLES.general;
  return [
    "Classify intent using strict JSON only. Allowed intents: assertive, planning, hypothetical, historical.",
    "Return JSON object: {\"intent\":\"...\",\"reason\":\"...\"}",
    "",
    "Examples:",
    ...examples.map((x) => `Input: ${x.input}\nOutput: {"intent":"${x.intent}","reason":"..."}`),
    "",
    `Input: ${text}`,
    "Output:"
  ].join("\n");
}

function extractObservationFromText(options) {
  const domain = VALID_DOMAINS.includes(options.domain) ? options.domain : "general";
  const intentInfo = classifyIntent(options.text);
  const field = options.field || `${domain}.note`;
  const observation = {
    event_id: randomUuid(),
    event_ts: nowIso(),
    domain,
    entity_id: options.entity_id,
    field,
    candidate_value: options.text,
    intent: intentInfo.intent,
    source: {
      type: options.source_type,
      ref: options.source_ref
    },
    corroborators: options.corroborators || [],
    meta: {
      extractor: "rule_based_v1",
      classifier_confidence: intentInfo.confidence,
      classifier_reason: intentInfo.reason,
      few_shot_prompt: buildFewShotPrompt(domain, options.text)
    }
  };
  return observation;
}

function buildMigrationObservations(rootDir, entityId) {
  const paths = getPaths(rootDir);
  const observations = [];
  const timestamp = nowIso();

  const heartbeatText = readTextIfExists(paths.heartbeat, "");
  const heartbeatLines = heartbeatText.split(/\r?\n/);
  heartbeatLines.forEach((line, index) => {
    const match = line.match(/^- \[(?: |x|X)\]\s+(.+)$/);
    if (!match) {
      return;
    }
    const itemText = normalizeMarkdownLine(match[1]);
    if (!itemText) {
      return;
    }
    const domain = domainFromText(itemText);
    const base = `heartbeat:${index + 1}:${itemText}`;
    observations.push({
      event_id: deterministicUuidFromText(base),
      event_ts: timestamp,
      domain,
      entity_id: entityId,
      field: `${domain}.reminder`,
      candidate_value: itemText,
      intent: "planning",
      source: {
        type: "static_markdown",
        ref: `HEARTBEAT.md:${index + 1}`
      },
      corroborators: []
    });
  });

  const memoryText = readTextIfExists(paths.memory, "");
  const memoryLines = memoryText.split(/\r?\n/);
  memoryLines.forEach((line, index) => {
    if (!line.startsWith("- ")) {
      return;
    }
    const itemText = normalizeMarkdownLine(line.slice(2));
    if (!itemText || itemText.length < 8) {
      return;
    }
    if (!/current|priority|wife|kids|budget|project|goal|pref|profile|travel|school/i.test(itemText)) {
      return;
    }
    const domain = domainFromText(itemText);
    const base = `memory:${index + 1}:${itemText}`;
    observations.push({
      event_id: deterministicUuidFromText(base),
      event_ts: timestamp,
      domain,
      entity_id: entityId,
      field: `${domain}.note`,
      candidate_value: itemText,
      intent: "historical",
      source: {
        type: "static_markdown",
        ref: `MEMORY.md:${index + 1}`
      },
      corroborators: []
    });
  });

  return observations;
}

function migrateToCanonical(rootDir, options = {}) {
  const entityId = options.entity_id || DEFAULT_ENTITY_ID;
  const forceCommit = Boolean(options.force_commit);
  ensureStateFiles(rootDir);
  const observations = buildMigrationObservations(rootDir, entityId);
  const summary = {
    total: observations.length,
    committed: 0,
    pending_confirmation: 0,
    tentative: 0,
    duplicate: 0,
    validation_failed: 0
  };

  for (const observation of observations) {
    const result = ingestObservation(rootDir, observation, { forceCommit });
    if (summary[result.status] !== undefined) {
      summary[result.status] += 1;
    }
  }
  return summary;
}

function mapSignalSourceType(sourceKind, sourceMode) {
  if (sourceKind === "calendar" && sourceMode === "webhook") {
    return "calendar_webhook";
  }
  if (sourceKind === "calendar" && sourceMode === "poll") {
    return "calendar_poll";
  }
  if (sourceKind === "email" && sourceMode === "webhook") {
    return "email_webhook";
  }
  return "email_poll";
}

function ingestSignalEvent(rootDir, signal, options = {}) {
  ensureStateFiles(rootDir);
  const validation = validateOrDlq(rootDir, "signal", signal);
  if (!validation.valid) {
    return {
      status: "validation_failed",
      errors: validation.errors,
      dlq: validation.dlqEntry
    };
  }

  const sourceType = mapSignalSourceType(signal.source.kind, signal.source.mode);
  const summary = {
    total_items: signal.items.length,
    committed: 0,
    pending_confirmation: 0,
    tentative: 0,
    duplicate: 0,
    validation_failed: 0
  };

  signal.items.forEach((item, idx) => {
    const stableRef = item.ref || `${item.field}:${idx}`;
    const eventId = deterministicUuidFromText(
      `${signal.source.kind}:${signal.source.mode}:${signal.entity_id}:${stableRef}:${JSON.stringify(item.value)}`
    );
    const observation = {
      event_id: eventId,
      event_ts: signal.event_ts,
      domain: item.domain,
      entity_id: signal.entity_id,
      field: item.field,
      candidate_value: item.value,
      intent: item.intent || "assertive",
      source: {
        type: sourceType,
        ref: `${signal.source.ref}#item-${idx + 1}`
      },
      corroborators: item.corroborators || []
    };
    const result = ingestObservation(rootDir, observation, options);
    if (summary[result.status] !== undefined) {
      summary[result.status] += 1;
    }
  });

  return {
    status: "ok",
    ...summary
  };
}

function tentativeToObservation(tentative) {
  return {
    event_id: tentative.event_id || randomUuid(),
    event_ts: tentative.event_ts || tentative.observed_at || nowIso(),
    domain: tentative.domain || "general",
    entity_id: tentative.entity_id || DEFAULT_ENTITY_ID,
    field: tentative.field || "general.note",
    candidate_value: tentative.candidate_value,
    intent: tentative.intent || "assertive",
    source: tentative.source || {
      type: "manual_markdown",
      ref: `tentative:${tentative.event_id || "unknown"}`
    },
    corroborators: tentative.corroborators || []
  };
}

function promoteReviewQueue(rootDir, options = {}) {
  const state = loadState(rootDir);
  const minConfidence = Number(options.min_confidence ?? 0.4);
  const limit = Math.max(1, Number(options.limit || 5));
  const maxPending = Math.max(1, Number(options.max_pending || 10));
  const entityId = options.entity_id || "";
  const domain = options.domain || "";

  const pendingOriginIds = new Set(
    Object.values(state.pending_confirmations)
      .map((item) => item.observation_event?.event_id)
      .filter(Boolean)
  );
  const currentPendingCount = Object.values(state.pending_confirmations)
    .filter((item) => !entityId || item.entity_id === entityId)
    .filter((item) => !domain || item.domain === domain)
    .length;
  const remainingSlots = Math.max(0, maxPending - currentPendingCount);
  if (remainingSlots === 0) {
    return {
      status: "ok",
      promoted_count: 0,
      promoted: [],
      pending_count: currentPendingCount,
      max_pending: maxPending,
      reason: "pending_limit_reached"
    };
  }

  const candidates = state.tentative_observations
    .filter((item) => !item.promoted_at)
    .filter((item) => !entityId || item.entity_id === entityId)
    .filter((item) => !domain || item.domain === domain)
    .filter((item) => Number(item.confidence) >= minConfidence)
    .filter((item) => !pendingOriginIds.has(item.event_id))
    .sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return String(a.observed_at).localeCompare(String(b.observed_at));
    })
    .slice(0, Math.min(limit, remainingSlots));

  const promoted = [];
  for (const item of candidates) {
    const observation = tentativeToObservation(item);
    const decisionMeta = {
      reasons: [
        "promoted_from_tentative_review_queue",
        ...(Array.isArray(item.reasons) ? item.reasons : [])
      ]
    };
    const analysis = {
      confidence: Number(item.confidence || 0)
    };
    const prompt = createPendingPrompt(observation, decisionMeta, analysis);
    state.pending_confirmations[prompt.prompt_id] = prompt;
    item.promoted_at = nowIso();
    item.prompt_id = prompt.prompt_id;
    promoted.push({
      prompt_id: prompt.prompt_id,
      event_id: observation.event_id,
      entity_id: observation.entity_id,
      domain: observation.domain,
      field: observation.field,
      confidence: analysis.confidence
    });
    logStateChange(
      rootDir,
      `review_queue_promoted | prompt_id=${prompt.prompt_id} | event_id=${observation.event_id} | ${observation.entity_id}/${observation.field} | confidence=${analysis.confidence}`
    );
  }

  if (promoted.length > 0) {
    saveState(rootDir, state);
  }

  return {
    status: "ok",
    pending_count: currentPendingCount + promoted.length,
    max_pending: maxPending,
    promoted_count: promoted.length,
    promoted
  };
}

function pollSignals(rootDir, options = {}) {
  const entityId = options.entity_id || DEFAULT_ENTITY_ID;
  const account = resolveGogAccount(rootDir, options.account || "");
  const includeCalendar = options.calendar !== false;
  const includeEmail = options.email !== false;

  if (!includeCalendar && !includeEmail) {
    throw new Error("poll requires at least one source; --calendar-only and --email-only cannot both be set");
  }

  const summary = {
    status: "ok",
    entity_id: entityId,
    account: account || null,
    calendar: null,
    email: null
  };

  if (includeCalendar) {
    const from = normalizeRelativeDayExpr(options.calendar_from || "today");
    const to = normalizeRelativeDayExpr(options.calendar_to || "tomorrow");
    const max = String(options.calendar_max || 25);
    const events = runGogJson(["calendar", "events", "--from", from, "--to", to, "--max", max], account);
    const signal = calendarEventsToSignal(entityId, events, `gog:calendar:from=${from}:to=${to}`, "poll");
    summary.calendar = ingestSignalEvent(rootDir, signal, { forceCommit: Boolean(options.force_commit) });
    summary.calendar.fetched_events = Array.isArray(events) ? events.length : 0;
  }

  if (includeEmail) {
    const query = options.gmail_query || "newer_than:2d";
    const max = String(options.gmail_max || 25);
    const threads = runGogJson(["gmail", "search", query, "--max", max], account);
    const signal = gmailThreadsToSignal(entityId, threads, `gog:gmail:query=${query}`, "poll");
    summary.email = ingestSignalEvent(rootDir, signal, { forceCommit: Boolean(options.force_commit) });
    summary.email.fetched_threads = Array.isArray(threads) ? threads.length : 0;
  }

  return summary;
}

function toStableStateEntries(state, entityFilter) {
  const entries = [];
  const entityIds = Object.keys(state.entities).sort();
  for (const entityId of entityIds) {
    if (entityFilter && entityFilter !== entityId) {
      continue;
    }
    const entity = state.entities[entityId];
    if (!entity || !entity.state) {
      continue;
    }
    const domains = Object.keys(entity.state).sort();
    for (const domain of domains) {
      const fields = entity.state[domain];
      for (const field of Object.keys(fields).sort()) {
        const record = fields[field];
        entries.push({
          entity_id: entityId,
          domain,
          field,
          record
        });
      }
    }
  }
  return entries;
}

function buildCanonicalStateSection(state, entityFilter) {
  const entries = toStableStateEntries(state, entityFilter);
  const lines = [];
  lines.push("Machine-managed section. Edit state via ingestion/confirmation flows.");
  lines.push("");
  lines.push("### Active Canonical State");
  if (entries.length === 0) {
    lines.push("- No committed state yet.");
  } else {
    for (const entry of entries) {
      lines.push(
        `- [${entry.entity_id}] ${entry.domain}.${entry.field} = ${stringifyValue(entry.record.value)} (confidence=${entry.record.confidence}, source=${entry.record.source})`
      );
    }
  }

  lines.push("");
  lines.push("### Pending Confirmations");
  const pending = Object.values(state.pending_confirmations).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (pending.length === 0) {
    lines.push("- None");
  } else {
    for (const item of pending) {
      lines.push(
        `- [${item.prompt_id}] [${item.entity_id}] ${item.proposed_change} (confidence=${item.confidence})`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildStateChangeLogSection(rootDir) {
  const paths = getPaths(rootDir);
  const logText = readTextIfExists(paths.stateChanges, "");
  const lines = logText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "))
    .slice(-20);
  const out = [];
  out.push("Most recent state decisions:");
  out.push("");
  if (lines.length === 0) {
    out.push("- No state changes yet.");
  } else {
    out.push(...lines);
  }
  return `${out.join("\n")}\n`;
}

function zoneMarkers(zoneId) {
  return {
    start: `<!-- STATE:BEGIN zone_id=${zoneId} schema=v1 -->`,
    end: `<!-- STATE:END zone_id=${zoneId} -->`
  };
}

function buildSectionBlock(heading, zoneId, body) {
  const markers = zoneMarkers(zoneId);
  const normalizedBody = body.trimEnd();
  return [
    heading,
    "",
    markers.start,
    normalizedBody,
    markers.end,
    ""
  ].join("\n");
}

function captureSectionBody(text, heading, zoneId) {
  const markers = zoneMarkers(zoneId);
  const startIdx = text.indexOf(markers.start);
  const endIdx = text.indexOf(markers.end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const bodyStart = startIdx + markers.start.length;
    return {
      exists: true,
      body: text.slice(bodyStart, endIdx).replace(/^\n/, "").replace(/\n$/, "")
    };
  }

  const legacyPattern = new RegExp(`(^${escapeRegExp(heading)}\\n\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, "m");
  const legacyMatch = text.match(legacyPattern);
  if (!legacyMatch) {
    return { exists: false, body: "" };
  }
  return { exists: true, body: legacyMatch[2].trimEnd() };
}

function upsertSection(text, heading, zoneId, body) {
  const markers = zoneMarkers(zoneId);
  const normalizedBody = body.trimEnd();
  const section = [
    heading,
    "",
    markers.start,
    normalizedBody,
    markers.end,
    ""
  ].join("\n");

  const startIdx = text.indexOf(markers.start);
  const endIdx = text.indexOf(markers.end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = text.slice(0, startIdx);
    const after = text.slice(endIdx + markers.end.length);
    return `${before}${markers.start}\n${normalizedBody}\n${markers.end}${after}`;
  }

  const legacyPattern = new RegExp(`(^${escapeRegExp(heading)}\\n\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, "m");
  if (legacyPattern.test(text)) {
    return text.replace(legacyPattern, section);
  }

  if (!text.endsWith("\n")) {
    return `${text}\n\n${section}`;
  }
  return `${text}\n${section}`;
}

function removeAllHeadingSections(text, heading) {
  const pattern = new RegExp(`(^${escapeRegExp(heading)}\\n\\n[\\s\\S]*?)(?=\\n##\\s|$)`, "m");
  let out = text;
  while (pattern.test(out)) {
    out = out.replace(pattern, "").replace(/\n{3,}/g, "\n\n");
  }
  return out.trimEnd();
}

function renderHeartbeatProjection(rootDir, options = {}) {
  ensureStateFiles(rootDir);
  const entityFilter = options.entity_id || "";
  const paths = getPaths(rootDir);
  const state = loadState(rootDir);
  let heartbeatText = readTextIfExists(paths.heartbeat, "# HEARTBEAT.md\n");

  const canonicalHeading = "## Canonical State (Machine Managed)";
  const changesHeading = "## State Change Log (Machine Managed)";
  const canonicalZoneId = "canonical_state";
  const changesZoneId = "state_change_log";

  const existingCanonical = captureSectionBody(heartbeatText, canonicalHeading, canonicalZoneId).body;
  const existingChanges = captureSectionBody(heartbeatText, changesHeading, changesZoneId).body;

  const nextCanonical = buildCanonicalStateSection(state, entityFilter);
  const nextChanges = buildStateChangeLogSection(rootDir);

  const canonicalHash = sha256(nextCanonical);
  const changesHash = sha256(nextChanges);
  const existingCanonicalHash = sha256(existingCanonical || "");
  const existingChangesHash = sha256(existingChanges || "");

  const oldCanonicalHash = state.runtime.projection_hashes[canonicalHeading] || "";
  const oldChangesHash = state.runtime.projection_hashes[changesHeading] || "";

  if (oldCanonicalHash && existingCanonicalHash !== oldCanonicalHash && existingCanonicalHash !== canonicalHash) {
    logStateChange(rootDir, `drift_detected | section=${canonicalHeading} | action=reconcile`);
  }
  if (oldChangesHash && existingChangesHash !== oldChangesHash && existingChangesHash !== changesHash) {
    logStateChange(rootDir, `drift_detected | section=${changesHeading} | action=reconcile`);
  }

  const legacyAnchors = [
    "## 🧠 Canonical State",
    "## 🧾 State Change Log",
    canonicalHeading,
    changesHeading,
    "Machine-managed section. Edit state via ingestion/confirmation flows.",
    "Most recent state decisions:",
    zoneMarkers(canonicalZoneId).start,
    zoneMarkers(canonicalZoneId).end,
    zoneMarkers(changesZoneId).start,
    zoneMarkers(changesZoneId).end
  ];
  const anchorPositions = legacyAnchors
    .map((anchor) => heartbeatText.indexOf(anchor))
    .filter((idx) => idx >= 0);
  if (anchorPositions.length > 0) {
    const firstAnchor = Math.min(...anchorPositions);
    heartbeatText = heartbeatText.slice(0, firstAnchor).trimEnd();
  }

  heartbeatText = removeAllHeadingSections(heartbeatText, canonicalHeading);
  heartbeatText = removeAllHeadingSections(heartbeatText, changesHeading);
  const canonicalBlock = buildSectionBlock(canonicalHeading, canonicalZoneId, nextCanonical);
  const changesBlock = buildSectionBlock(changesHeading, changesZoneId, nextChanges);
  heartbeatText = `${heartbeatText}\n\n${canonicalBlock}\n${changesBlock}\n`;
  writeText(paths.heartbeat, heartbeatText);

  state.runtime.projection_hashes[canonicalHeading] = canonicalHash;
  state.runtime.projection_hashes[changesHeading] = changesHash;
  saveState(rootDir, state);
  return {
    status: "ok",
    projected_sections: [canonicalHeading, changesHeading]
  };
}

function getStatus(rootDir) {
  ensureStateFiles(rootDir);
  const state = loadState(rootDir);
  const entities = Object.keys(state.entities);
  const committedCount = toStableStateEntries(state).length;
  const pendingCount = Object.keys(state.pending_confirmations).length;
  return {
    version: state.version,
    last_consistency_check: state.last_consistency_check,
    entities: entities.length,
    committed_fields: committedCount,
    pending_confirmations: pendingCount,
    tentative_observations: state.tentative_observations.length,
    processed_event_ids: state.processed_event_ids.length,
    projection_mode: state.runtime.projection_mode,
    adaptive_learning_enabled: Boolean(state.runtime.adaptive_learning_enabled)
  };
}

function listPendingConfirmations(rootDir, entityId) {
  const state = loadState(rootDir);
  const all = Object.values(state.pending_confirmations);
  if (!entityId) {
    return all;
  }
  return all.filter((item) => item.entity_id === entityId);
}

function parseArgs(argv) {
  const args = { _: [] };
  let key = null;
  for (const token of argv) {
    if (token.startsWith("--")) {
      key = token.slice(2);
      if (!key) {
        continue;
      }
      args[key] = true;
      continue;
    }
    if (key) {
      args[key] = token;
      key = null;
      continue;
    }
    args._.push(token);
  }
  return args;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function loadJsonFromFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function usage() {
  const lines = [
    "Usage: node scripts/state-consistency.js <command> [options]",
    "",
    "Commands:",
    "  init [--root <path>]",
    "  status [--root <path>]",
    `  migrate [--root <path>] [--entity-id ${DEFAULT_ENTITY_ID}] [--force-commit]`,
    "  ingest --file <observation.json> [--root <path>] [--force-commit]",
    "  extract --entity-id <id> --domain <domain> --text <text> --source-type <type> --source-ref <ref> [--field <field>] [--ingest] [--root <path>]",
    "  ingest-signal --file <signal.json> [--root <path>] [--force-commit]",
    `  poll [--root <path>] [--entity-id ${DEFAULT_ENTITY_ID}] [--account email] [--calendar-only|--email-only] [--calendar-from today] [--calendar-to tomorrow] [--calendar-max 25] [--gmail-query "newer_than:2d"] [--gmail-max 25] [--project]`,
    "  review-queue [--root <path>] [--entity-id <id>] [--domain <domain>] [--min-confidence 0.4] [--limit 5] [--max-pending 10] [--project]",
    "  pending [--root <path>] [--entity-id <id>]",
    "  confirm --prompt-id <id> --action confirm|reject|edit [--edited-value <json-or-string>] [--root <path>]",
    "  project [--root <path>] [--entity-id <id>]"
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const rootDir = path.resolve(args.root || process.cwd());

  if (!cmd) {
    usage();
    return 1;
  }

  try {
    if (cmd === "init") {
      ensureStateFiles(rootDir);
      printJson({ status: "ok", initialized: true, root: rootDir });
      return 0;
    }

    if (cmd === "status") {
      printJson({ status: "ok", ...getStatus(rootDir) });
      return 0;
    }

    if (cmd === "migrate") {
      const summary = migrateToCanonical(rootDir, {
        entity_id: args["entity-id"] || DEFAULT_ENTITY_ID,
        force_commit: Boolean(args["force-commit"])
      });
      printJson({ status: "ok", summary });
      return 0;
    }

    if (cmd === "ingest") {
      if (!args.file) {
        throw new Error("--file is required for ingest");
      }
      const observation = loadJsonFromFile(path.resolve(args.file));
      const result = ingestObservation(rootDir, observation, {
        forceCommit: Boolean(args["force-commit"])
      });
      printJson(result);
      return result.status === "validation_failed" ? 2 : 0;
    }

    if (cmd === "extract") {
      const required = ["entity-id", "domain", "text", "source-type", "source-ref"];
      for (const key of required) {
        if (!args[key]) {
          throw new Error(`--${key} is required for extract`);
        }
      }
      const observation = extractObservationFromText({
        entity_id: args["entity-id"],
        domain: args.domain,
        text: args.text,
        source_type: args["source-type"],
        source_ref: args["source-ref"],
        field: args.field
      });

      const validation = validateOrDlq(rootDir, "observation", observation);
      if (!validation.valid) {
        printJson({
          status: "validation_failed",
          errors: validation.errors,
          dlq: validation.dlqEntry
        });
        return 2;
      }

      if (!args.ingest) {
        printJson({
          status: "ok",
          observation
        });
        return 0;
      }

      const result = ingestObservation(rootDir, observation, {
        forceCommit: Boolean(args["force-commit"])
      });
      printJson({
        status: result.status,
        observation,
        result
      });
      return result.status === "validation_failed" ? 2 : 0;
    }

    if (cmd === "ingest-signal") {
      if (!args.file) {
        throw new Error("--file is required for ingest-signal");
      }
      const signal = loadJsonFromFile(path.resolve(args.file));
      const result = ingestSignalEvent(rootDir, signal, {
        forceCommit: Boolean(args["force-commit"])
      });
      printJson(result);
      return result.status === "validation_failed" ? 2 : 0;
    }

    if (cmd === "poll") {
      const result = pollSignals(rootDir, {
        entity_id: args["entity-id"] || DEFAULT_ENTITY_ID,
        account: args.account || "",
        calendar: args["email-only"] ? false : true,
        email: args["calendar-only"] ? false : true,
        calendar_from: args["calendar-from"] || "today",
        calendar_to: args["calendar-to"] || "tomorrow",
        calendar_max: Number(args["calendar-max"] || 25),
        gmail_query: args["gmail-query"] || "newer_than:2d",
        gmail_max: Number(args["gmail-max"] || 25),
        force_commit: Boolean(args["force-commit"])
      });
      if (args.project) {
        renderHeartbeatProjection(rootDir, { entity_id: args["entity-id"] || "" });
      }
      printJson(result);
      return 0;
    }

    if (cmd === "review-queue") {
      const result = promoteReviewQueue(rootDir, {
        entity_id: args["entity-id"] || "",
        domain: args.domain || "",
        min_confidence: Number(args["min-confidence"] || 0.4),
        limit: Number(args.limit || 5),
        max_pending: Number(args["max-pending"] || 10)
      });
      if (args.project) {
        renderHeartbeatProjection(rootDir, { entity_id: args["entity-id"] || "" });
      }
      printJson(result);
      return 0;
    }

    if (cmd === "pending") {
      const pending = listPendingConfirmations(rootDir, args["entity-id"] || "");
      printJson({
        status: "ok",
        count: pending.length,
        items: pending
      });
      return 0;
    }

    if (cmd === "confirm") {
      if (!args["prompt-id"] || !args.action) {
        throw new Error("--prompt-id and --action are required for confirm");
      }
      const pending = getPendingConfirmation(rootDir, args["prompt-id"]);
      if (!pending) {
        printJson({
          status: "not_found",
          message: `No pending prompt found for ${args["prompt-id"]}`
        });
        return 2;
      }

      const confirmation = {
        prompt_id: pending.prompt_id,
        entity_id: pending.entity_id,
        domain: pending.domain,
        proposed_change: pending.proposed_change,
        confidence: pending.confidence,
        reason_summary: pending.reason_summary,
        action: args.action,
        ts: nowIso()
      };
      if (args.action === "edit") {
        confirmation.edited_value = parseMaybeJson(args["edited-value"]);
      }
      const result = applyUserConfirmation(rootDir, confirmation);
      printJson(result);
      return result.status === "validation_failed" || result.status === "not_found" ? 2 : 0;
    }

    if (cmd === "project") {
      const result = renderHeartbeatProjection(rootDir, {
        entity_id: args["entity-id"] || ""
      });
      printJson(result);
      return 0;
    }

    usage();
    return 1;
  } catch (error) {
    printJson({
      status: "error",
      message: error.message
    });
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  DOMAIN_DEFAULTS,
  SOURCE_RELIABILITY_DEFAULTS,
  buildFewShotPrompt,
  classifyIntent,
  createDefaultState,
  ensureStateFiles,
  extractObservationFromText,
  calendarEventsToSignal,
  gmailThreadsToSignal,
  getPendingConfirmation,
  getStatus,
  ingestObservation,
  ingestSignalEvent,
  pollSignals,
  loadState,
  main,
  migrateToCanonical,
  promoteReviewQueue,
  renderHeartbeatProjection,
  validateOrDlq,
  applyUserConfirmation
};
