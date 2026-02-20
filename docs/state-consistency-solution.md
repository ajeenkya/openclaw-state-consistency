# State Consistency Solution for Personal AI Agents

**Date**: February 20, 2026  
**Author**: Milo (AI Agent)  
**Reviewer**: AJ Bhatalkar  

---

## 📋 Executive Summary

Personal AI agents face a fundamental distributed systems problem: **maintaining state consistency across multiple information sources that change over time**. This document proposes a comprehensive solution based on real-world failure analysis and industry best practices.

### **Revision Notes (Feb 19, 2026)**
- Adopted a **single-writer canonical state model** with `memory/state-tracker.json` as machine source of truth.
- Replaced global source ordering with a **domain-specific truth authority matrix** (travel, family, project, financial, profile).
- Added **adaptive confidence thresholds** that start with user confirmation and learn safer autonomy over time.

### **Pragmatic Rollout Notes (Feb 20, 2026)**
- Core MVP ships first: canonical state store + basic deterministic resolver + ingestion/projection pipeline.
- Advanced capabilities (adaptive learning loops, strict AST projection modes, richer extraction models) are configurable and can be enabled progressively.
- Runtime implementation is **TypeScript/Node-first** for OpenClaw core; Python models are optional reference adapters for ecosystem integrations.
- State model is explicitly **multi-entity** (`entity_id`) to support individuals, families, and teams from v1.

### **Implementation Status (Shipped in this thread, Feb 20, 2026)**
- **Phase 1 delivered (core consistency engine)**:
  - `scripts/state-consistency.js` (single-writer ingest/resolve/persist/project pipeline)
  - `scripts/migrate-state-to-canonical.js` (bootstrap existing markdown state)
  - `schemas/state_observation.schema.json`
  - `schemas/user_confirmation.schema.json`
  - `schemas/signal_event.schema.json`
- **Phase 2 delivered (high-value automation)**:
  - `scripts/state-poller-runner.js` (calendar/email polling + review promotion + projection)
  - `scripts/state-install-poller-cron.sh`
  - `scripts/state-uninstall-poller-cron.sh`
  - `review-queue` promotion flow with `max_pending` flood control
- **Conversational confirmation loop delivered**:
  - `scripts/state-telegram-review.js` (one-by-one pending confirmations in Telegram)
  - `scripts/state-install-telegram-review-cron.sh`
  - `scripts/state-uninstall-telegram-review-cron.sh`
  - `scripts/state-install-telegram-review-launchd.sh`
  - `scripts/state-uninstall-telegram-review-launchd.sh`
- **Runtime bridge delivered (main chat + interception)**:
  - `plugins/state-consistency-bridge` OpenClaw plugin
  - `before_agent_start` canonical-state context injection into main-chat reasoning
  - `message_received` auto-ingestion of inbound assertions into canonical `StateObservation` events
  - Natural chat `yes/no` acknowledgements can auto-resolve active pending confirmations
  - `/state-confirm` command interception for Telegram Yes/No callback control messages
  - Immediate next-prompt handoff with inline Yes/No buttons (no manual scripts per decision)
- **Natural-language E2E harness delivered**:
  - `scripts/state-telegram-e2e.js` (`guide`, `prepare`, `status`, `verify`)
  - End-to-end Telegram validation path for OSS users using normal chat interactions
- **OSS hardening completed in this revision**:
  - Neutral default entity (`user:primary`) instead of personal IDs.
  - Removed hardcoded Telegram fallback target; runtime now requires explicit target config.
  - Launchd installer now derives workspace path dynamically from script location.

### **Quick Commands (Current Runtime)**
```bash
npm run state:init
npm run state:migrate
npm run state:poll
npm run state:review-queue
npm run state:pending
npm run state:telegram-review:run
npm run state:plugin:install
npm run state:e2e:guide
npm test
```

### **Deferred by Design (Post-MVP)**
- Full AST parser dependency for all projections (current default uses deterministic machine zones with compatibility mode).
- Adaptive threshold learning enabled in production (`adaptive_learning.enabled` remains gated by rollout criteria).
- Broader webhook/plugin coverage beyond calendar/email.

---

## 🚨 The Triggering Incident

### What Happened
During a routine heartbeat check on February 19, 2026, the agent incorrectly assumed AJ was "leaving for Tahoe on Sunday" when he was already in Tahoe. This led to:
- Incorrect Amazon return scheduling (before trip vs. after trip)
- Persistent wrong assumptions despite contextual clues
- Loss of user confidence in agent reliability

### Specific Error Chain
1. **HEARTBEAT.md** contained stale information: "Sunday 7-8 AM: Leave for Tahoe"
2. Agent treated static file as authoritative truth
3. User mentioned "we are in Tahoe" - no automatic state correction triggered
4. Wrong timeline persisted, affecting downstream decisions

---

## 🌐 Broader Impact: Where This Problem Manifests

### **Scenario 1: Travel Status**
- **Static file**: "Trip planned for next week"
- **Reality**: Trip happened yesterday
- **Impact**: Wrong packing reminders, booking suggestions

### **Scenario 2: Project Status**  
- **MEMORY.md**: "Working on feature X"
- **Reality**: Feature X shipped last month
- **Impact**: Obsolete task suggestions, incorrect progress tracking

### **Scenario 3: Family Schedule**
- **Calendar**: Regular recurring events
- **Reality**: Kids sick, school cancelled
- **Impact**: Wrong activity planning, scheduling conflicts

### **Scenario 4: Financial State**
- **Monarch data**: Last week's transactions
- **Reality**: Major purchase made today
- **Impact**: Incorrect budget advice, missed payment alerts

### **Scenario 5: Work Context**
- **Static docs**: Q1 goals and priorities
- **Reality**: Mid-quarter pivot, new priorities
- **Impact**: Irrelevant suggestions, outdated focus areas

---

## 🔍 Root Cause Analysis: How We Reached The Conclusion

### **Discovery Process**
1. **User Challenge**: "Why do you think we're leaving Sunday when we're already in Tahoe?"
2. **Pattern Recognition**: This wasn't an isolated mistake but symptomatic of a systemic issue
3. **System Analysis**: Identified multiple competing truth sources with no conflict resolution
4. **Abstraction**: Recognized this as a classic distributed systems consistency problem

### **Fundamental Issues Identified**

#### **1. Multiple Sources of Truth**
```
Static Files:     HEARTBEAT.md, MEMORY.md, GOALS.md
Dynamic Data:     Calendar events, emails, transaction data  
Live Context:     Conversation history, user corrections
Inferred State:   Time-based assumptions, logical deductions
```

#### **2. No Clear Authority Hierarchy**
- Which source wins when they conflict?
- How do we handle temporal precedence?
- When should static files override live data?

#### **3. Missing Update Propagation**
- User mentions state changes → no automatic file updates
- Calendar changes → no HEARTBEAT.md reflection
- Context shifts → no memory file corrections

#### **4. Stale Data Accumulation**  
- Old information never expires
- No validation against current reality
- Feedback loops amplify incorrect assumptions

#### **5. Human-AI Interaction Gap**
- Users assume agents "know" current state
- Agents assume static files are current
- No explicit state synchronization protocol

---

## 🛠️ Solution Options Explored

### **Option 1: Event-Driven Architecture** 
**Inspiration**: Netflix, Uber microservices
```
Pros: Real-time updates, decoupled components
Cons: Complex to implement, potential event storms
Application: Every state mention triggers file updates
```

### **Option 2: Single Source of Truth + Hierarchy**
**Inspiration**: Google Spanner, Amazon DynamoDB
```  
Pros: Clear conflict resolution, simple mental model
Cons: May discard valuable information, rigid structure
Application: Recent context > Calendar > Static files > Defaults
```

### **Option 3: Event Sourcing**
**Inspiration**: Banking systems, LinkedIn data platform
```
Pros: Complete audit trail, point-in-time recovery
Cons: Storage overhead, complexity for simple cases  
Application: Log all changes, rebuild state from events
```

### **Option 4: Cache Invalidation + TTL**
**Inspiration**: Redis, CDN edge caches
```
Pros: Prevents stale data, automatic cleanup
Cons: May lose valid long-term information
Application: HEARTBEAT.md items expire, refresh from context
```

### **Option 5: Vector Clocks**  
**Inspiration**: Distributed databases (Riak, Cassandra)
```
Pros: Handles concurrent updates perfectly
Cons: Overkill for single-agent systems
Application: Track update causality across all sources
```

---

## 🎯 Recommended Solution: Hybrid Event-Driven + Hierarchical Truth

### **Core Architecture**

#### **1. Domain-Specific Truth Authority Matrix**

| Domain | Primary Source | Secondary Source | Tertiary Source | Notes |
|--------|----------------|------------------|-----------------|-------|
| Travel/location state | Live user context (explicit statements, last 72h) | Calendar events | HEARTBEAT.md / MEMORY.md | User "I am in X" overrides planned itinerary |
| Family schedule | Calendar | Live user context | Static files | Same-day user updates can override calendar |
| Project status | Live user context + repo signals (commits/PR status, when available) | MEMORY.md / project docs | Calendar | Prefer execution evidence over stale planning docs |
| Financial state | Transaction/email signals | Live user context | Static budget notes | External ledger-like signals win unless user explicitly corrects |
| Long-term profile/preferences | MEMORY.md | USER.md | Live context | Requires stronger confirmation before mutation |

Entity scoping rule:
- All state assertions are keyed as `entity_id + domain + field` (for example: `user:primary + travel + location`).
- `entity_id` supports `user:*`, `family:*`, and `team:*` namespaces in v1.

#### **2. Canonical State Ownership (Single Writer Model)**
```
Canonical store: memory/state-tracker.json
Derived views:   HEARTBEAT.md, MEMORY.md snippets, memory/state-changes.md

Write path:
1) Ingest observation as event
2) Run conflict resolver + confidence scoring
3) Commit accepted state to canonical store
4) Regenerate derived views from canonical store
```

Rules:
- `memory/state-tracker.json` is the only machine-writable source of truth.
- Markdown files are human-readable projections, not peer authorities.
- Manual edits in markdown are ingested as new events (not silently overwritten).
- Canonical key format is `entities[entity_id].state[domain][field]`.

#### **3. Event-Driven Updates**
```
Trigger Events:
- User mentions state changes
- Calendar webhook/poll event occurs  
- Email/transaction webhook/poll event occurs
- Time-based invalidation triggers

Actions:
- Classify intent (`assertive`, `planning`, `hypothetical`, `historical`)
- Enforce structured extraction output (schema-validated JSON only)
- Use few-shot extraction prompts per domain with fallback to `tentative` when confidence is low
- Score confidence with source reliability + recency + corroboration
- Apply deterministic merge policy
- Write accepted updates to canonical store
- Append audit event to memory/state-changes.md
- Ask user only when confidence falls in review band
```

#### **4. Smart Validation Layer**
```
Consistency Checks:
- Timeline logic (does this sequence make sense?)
- Conflict detection (sources disagree)
- Staleness detection (last update > threshold)
- User confirmation (when uncertain)
```

Deterministic merge policy (per domain):
```text
confidence = source_reliability * recency_factor * intent_factor * corroboration_factor
margin = top_candidate_confidence - second_candidate_confidence

if confidence >= auto_threshold[domain] and margin >= margin_threshold[domain]:
    auto-commit
elif confidence >= ask_threshold[domain]:
    ask user, then commit/reject
else:
    store as tentative observation; do not mutate committed state
```

#### **5. Adaptive Threshold Learning**
- Feature flag: `adaptive_learning.enabled=false` by default in initial MVP rollout.
- Start conservative: `ask_threshold=0.65`, `auto_threshold=0.90` for all domains.
- Initial calibration period: first 30 state mutations require user confirmation unless confidence >= 0.98.
- Learn per-domain thresholds from outcomes:
  - User confirms auto update -> reinforce source reliability for contributing signals
  - User corrects update -> penalize contributing signals, raise `auto_threshold`
- Update thresholds daily using exponential moving averages with hard bounds:
  - `ask_threshold` in `[0.55, 0.80]`
  - `auto_threshold` in `[0.80, 0.99]`
- Goal: minimize correction rate while increasing autonomous commits safely.
- Enablement gate: activate adaptive learning only after Stage 1 criteria have passed for 7 consecutive days.

#### **6. Implementation Interface Contracts (v1)**

`StateObservation` event (append-only input):
```json
{
  "event_id": "uuid-v7",
  "event_ts": "2026-02-19T15:00:00Z",
  "domain": "travel",
  "entity_id": "user:primary",
  "field": "travel.status",
  "candidate_value": "in_progress",
  "intent": "assertive",
  "source": {
    "type": "conversation_assertive",
    "ref": "thread:646:msg:1842"
  },
  "corroborators": [
    {"type": "calendar", "ref": "event:abc123"}
  ]
}
```

Validation requirement:
- Every `StateObservation` payload MUST validate against a strict schema before any resolver logic runs.
- Canonical definitions:
  - JSON Schema 2020-12: `schemas/state_observation.schema.json` (single source of truth)
  - TypeScript runtime validator (Ajv): generated from canonical JSON Schema
  - Optional Python mirror model: `StateObservationModel` (for non-core adapters/tests)
- Runtime policy:
  - `additionalProperties: false` on all objects
  - strict enums for `domain`, `intent`, `source.type`
  - RFC3339 timestamp format validation for `event_ts`
  - UUID validation for `event_id`
  - `entity_id` pattern validation: `^(user|family|team):[a-z0-9._-]+$`
  - minimum/maximum length constraints on string fields (`field`, `candidate_value`, `source.ref`)

`ResolveState` contract (deterministic pure function):
```text
ResolveState(
  committed_state[entity_id][domain],
  observation_event,
  source_reliability_map,
  domain_thresholds
) -> {
  decision: auto_commit | ask_user | tentative_reject,
  confidence: float,
  margin: float,
  reasons: string[],
  proposed_patch: json_patch[]
}
```

`PersistState` contract:
```text
PersistState(
  decision_bundle,
  state_tracker_json_path,
  state_changes_log_path
) -> {
  committed_version: int,
  projection_required: bool
}
```

`Projection` contract (canonical -> markdown):
```text
RenderProjections(
  committed_state,
  output_targets = [HEARTBEAT.md, MEMORY.md]
) -> deterministic_file_updates
```

`UserConfirmation` payload (for review band):
```json
{
  "prompt_id": "uuid-v7",
  "entity_id": "user:primary",
  "domain": "travel",
  "proposed_change": "travel.status: planning -> in_progress",
  "confidence": 0.78,
  "reason_summary": [
    "Explicit first-person assertion detected",
    "Recent travel calendar corroboration"
  ],
  "actions": ["confirm", "reject", "edit"]
}
```

Validation requirement:
- Every `UserConfirmation` payload MUST validate against:
  - JSON Schema 2020-12: `schemas/user_confirmation.schema.json` (single source of truth)
  - TypeScript runtime validator (Ajv): generated from canonical JSON Schema
  - Optional Python mirror model: `UserConfirmationModel` (for non-core adapters/tests)
- Strict constraints:
  - `actions` must be exactly one of `confirm|reject|edit` in user response payloads
  - `confidence` must be in `[0.0, 1.0]`
  - `entity_id` pattern validation: `^(user|family|team):[a-z0-9._-]+$`
  - `reason_summary` max 5 entries, each <= 160 chars

Schema failure handling (non-negotiable):
```text
on_validation_failure(payload, schema_name):
  1) Do not call resolver or state writer
  2) Write failed payload + error list to dead-letter queue:
       memory/state-dlq.jsonl
  3) Attach diagnostics:
       event_id/prompt_id, schema_name, validation_errors, first_seen_ts, retry_count
  4) Retry policy:
       exponential backoff (1m, 5m, 30m), max 3 retries
  5) If still invalid after max retries:
       mark as permanently_failed and open human review item
```

DLQ SLO:
- `state-dlq` unresolved items must remain zero for >24h windows.
- Any permanently failed item in travel/financial domains triggers immediate user alert.

Stack alignment policy:
- OpenClaw core path is TypeScript/Node.js first.
- Core runtime depends on JSON Schema + Ajv only; no mandatory Python runtime dependency.
- Python/Pydantic remains a reference adapter layer for integrations, offline analysis, and compatibility tests.

Intent extraction reliability guardrails:
- Use domain-specific few-shot examples with required JSON output schema.
- Reject free-form extractor output; accept only schema-valid structured payloads.
- For low-confidence or ambiguous extraction, force `tentative_reject` / `ask_user` path (never silent auto-commit).
- Maintain confusion-matrix metrics for `assertive/planning/hypothetical/historical` classification and retrain prompts from real correction data.

#### **7. Failure Modes and Safeguards**
- **Duplicate events**: ignore if `event_id` already processed (idempotency).
- **Out-of-order timestamps**: process by event time, but never regress committed state without explicit user confirmation.
- **Projection drift**: if `STATE` zones are manually changed, revert to canonical projection and create a drift review event (no direct state mutation).
- **Source outage**: degrade gracefully by lowering unavailable source weight; do not silently substitute assumptions.
- **Ambiguous language**: classify as `tentative` unless explicit assertive intent is detected.

#### **8. Deterministic Markdown Projection and Ingestion**

Chosen stance:
- Default mode: **AST-based parsing** (`remark` ecosystem) plus **strict machine-only injection zones**.
- Compatibility mode (MVP rollout option): `projection_mode=legacy_string` for pre-existing workspaces without zones.
- Unbounded raw string replacement across full files is prohibited in all modes.

Machine zone contract:
```markdown
<!-- STATE:BEGIN zone_id=active_reminders schema=v1 -->
... machine-managed projection content only ...
<!-- STATE:END zone_id=active_reminders -->

<!-- STATE-INPUT:BEGIN zone_id=manual_overrides schema=v1 -->
- [user:primary] travel.status = in_progress #intent=assertive
<!-- STATE-INPUT:END zone_id=manual_overrides -->
```

Rules:
- In default mode, system writes only inside `STATE` zones.
- Human-authored narrative text outside zones is never modified by the system.
- Manual state edits are accepted only inside `STATE-INPUT` zones.
- Manual edits inside `STATE` zones are treated as drift and reverted on next projection pass, while creating a review event.
- In compatibility mode, writes are limited to explicit anchored sections (`## Active Reminders`, `## State Change Log`) with pre-write backup and warning logs.

Projection write algorithm (deterministic):
```text
1) Parse markdown into AST
2) Locate target zone nodes by exact `zone_id`
3) Render canonical state -> normalized markdown fragment (stable sort by domain, field)
4) Replace AST children inside zone only
5) Serialize with fixed formatter config (line endings, list marker, heading style)
6) Write file only if content hash changed
```

Compatibility mode algorithm (`projection_mode=legacy_string`):
```text
1) Verify required heading anchors exist exactly once
2) Build normalized block text from canonical state (stable sort)
3) Replace only bounded text between heading anchors
4) Emit warning event: "legacy_string_projection_used"
5) Create timestamped backup before write
```

Manual edit -> `StateObservation` diff algorithm:
```text
Inputs:
  A = last accepted normalized entries for STATE-INPUT zone (from state-tracker snapshot)
  B = current normalized entries parsed from AST in same zone

Normalization:
  - trim whitespace
  - collapse repeated spaces
  - canonical key format: "[entity_id] field = value #intent=..."
  - lowercase entity/domain/intent tokens where applicable

Diff:
  added   = B - A
  removed = A - B

For each added entry:
  - parse to structured candidate {entity_id, domain, field, candidate_value, intent}
  - emit `StateObservation` with source.type=`manual_markdown`, source.ref=`<file>:<zone_id>:<line_hash>`

For each removed entry:
  - emit retraction observation with intent=`retract` and candidate_value=`null`

For parse failures:
  - send to DLQ with parse_error context
  - do not mutate committed state
```

Determinism guarantees:
- Default mode: same canonical state + same formatter config => byte-identical projected zone output.
- Compatibility mode: same canonical state + same anchor layout => byte-identical anchored block output.
- Same input zone text => same normalized entry set => same emitted semantic events (stable content fingerprint).
- Non-zone markdown edits cannot alter committed state.

### **Implementation Plan**

#### **Track A: Core MVP (Week 1-2, Mandatory)**
- Create canonical schema in `memory/state-tracker.json` with multi-entity keys.
- Implement TS/Node single-writer pipeline (`ingest -> validate(Ajv) -> resolve -> persist -> project`).
- Ship basic resolver (deterministic merge policy, fixed thresholds, no adaptive learning yet).
- Add timestamp/provenance tracking and `memory/state-changes.md` audit log.
- Implement idempotency (`event_id`) and deterministic resolver unit tests.
- Add external signal ingestion primitives early:
  - calendar polling + webhook hook interface
  - email polling + webhook hook interface
- Deliver migration utility:
  - `scripts/migrate-state-to-canonical.(ts|js)` to ingest existing `HEARTBEAT.md` and `MEMORY.md` into canonical state.
- Publish reference implementations:
  - TypeScript reference (production path)
  - Python parity reference (optional adapter) + shared fixture tests

#### **Track B: Safety + Calibration (Week 2-3, Mandatory Before Broad Autonomy)**
- Enable user confirmation workflow (`confirm/reject/edit`) for review-band decisions.
- Add structured intent extraction with few-shot domain prompts and schema-only outputs.
- Add projection drift detection + reconciliation.
- Keep `adaptive_learning.enabled=false` until rollout gates pass.

#### **Track C: Advanced Autonomy (Post-MVP, Optional/Configurable)**
- Enable adaptive threshold learning from user feedback.
- Tune source reliability weights and domain bounds.
- Add predictive invalidation and further performance optimization.
- Roll out per domain only after hard promotion criteria are met.

### **Rollout Gates (Hard Promotion Criteria)**

| Stage | Duration | Auto-Commit Allowed | Promotion Gate (must all pass) |
|-------|----------|---------------------|---------------------------------|
| Stage M: MVP Core | 7-14 days | Yes (fixed threshold only) | Canonical store + resolver + projections stable, schema validation success >= 99.9%, no data-loss incidents |
| Stage 0: Shadow | 3 days | No | Resolver output matches human judgment on >= 95% sampled events |
| Stage 1: Assisted | 7 days | Only if confidence >= 0.98 | Correction rate <= 5%, no P0 false-state incidents |
| Stage 2: Calibrated | 14 days | Domain thresholds enabled | Auto-Commit Precision >= 97%, Review Burden <= 40% |
| Stage 3: Autonomous | Ongoing | Adaptive thresholds | 30-day rolling correction rate <= 2%, P0 incidents = 0 |

Rollback rules:
- Any P0 false-state incident in travel/financial domains -> immediate fallback to Stage 1 behavior for that domain.
- If weekly correction rate rises above 5% in any domain -> raise `auto_threshold` by +0.05 and require confirmations for next 20 events.
- If schema validation success drops below 99.5% in any 24h window -> fall back to Stage M behavior and disable adaptive learning globally.

### **Specific File Changes**

#### **HEARTBEAT.md Structure Update**
```markdown
## Active Reminders
- [ ] **Item**: Description (domain: travel) (expires: YYYY-MM-DD)
- [ ] **Travel**: Tahoe trip (domain: travel) (expires: 2026-02-23) (confidence: 0.96) (source: conversation_2026-02-19)

## State Change Log
- 2026-02-19 14:30: travel.status planning -> in_progress (confidence: 0.96) (resolution: auto_commit)
```

#### **New File: memory/state-tracker.json**
```json
{
  "last_consistency_check": "2026-02-19T15:30:00Z",
  "runtime": {
    "projection_mode": "ast_zones",
    "adaptive_learning_enabled": false
  },
  "domains": {
    "travel": {
      "ask_threshold": 0.65,
      "auto_threshold": 0.90,
      "margin_threshold": 0.15,
      "calibration_remaining": 30
    },
    "project": {
      "ask_threshold": 0.65,
      "auto_threshold": 0.90,
      "margin_threshold": 0.20,
      "calibration_remaining": 30
    }
  },
  "source_reliability": {
    "conversation_assertive": 0.90,
    "calendar": 0.85,
    "transactions_email": 0.88,
    "static_markdown": 0.60
  },
  "entities": {
    "user:primary": {
      "state": {
        "travel": {
          "status": "in_progress",
          "location": "Tahoe",
          "last_update": "2026-02-19T15:00:00Z",
          "source": "conversation_assertive"
        }
      }
    },
    "family:veda": {
      "state": {
        "school": {
          "status": "break_week",
          "last_update": "2026-02-19T08:00:00Z",
          "source": "calendar"
        }
      }
    }
  },
  "tentative_observations": [],
  "active_conflicts": [],
  "pending_validations": ["project_timeline"],
  "learning_stats": {
    "auto_commits": 0,
    "auto_commit_corrections": 0,
    "ask_user_confirmations": 0
  }
}
```

---

## ✅ Success Metrics

### **Reliability Metrics**
- **Auto-Commit Precision**: % of autonomous commits later confirmed correct (target: >= 97%)
- **State Accuracy**: % of agent assumptions matching observed reality
- **Conflict Detection Recall**: % of inconsistencies caught automatically  
- **Update Propagation**: Time from user mention to committed state update
- **Idempotency Integrity**: % of duplicate events correctly ignored (target: 100%)
- **Schema Validation Success**: % of events passing schema checks before resolve (target: >= 99.9%)

### **User Experience Metrics**
- **Correction Frequency**: How often users need to correct agent assumptions (target: downward trend week-over-week)
- **Context Continuity**: % of conversations where agent maintains correct context
- **Review Burden**: % of state changes that require user confirmation
- **User Confidence**: Subjective rating of agent reliability
- **Confirmation Latency**: Median time to resolve ask-user prompts (target: < 2 min in active sessions)
- **Intent Extraction Quality**: Precision/recall for `assertive/planning/hypothetical/historical` classes

### **System Health Metrics**
- **Staleness Index**: Average age of information in static files
- **Validation Coverage**: % of state changes verified against multiple sources
- **Response Latency**: Time impact of consistency checking
- **Threshold Stability**: Daily variance of learned thresholds per domain
- **Projection Drift Rate**: % of projection files requiring reconciliation (target: < 1% daily)
- **Signal Freshness**: Age of latest calendar/email ingestion per entity/domain

---

## 🔄 Continuous Improvement

### **Learning Loop**
1. **Monitor**: Track state inconsistency incidents
2. **Analyze**: Root cause analysis for each failure
3. **Adapt**: Update per-domain source reliability and thresholds based on outcomes
4. **Evolve**: Improve state change detection algorithms

### **Future Enhancements**
- **Predictive State Management**: Anticipate state changes based on patterns
- **Multi-Agent Coordination**: Handle state across multiple AI agents  
- **Broader Signal Integrations**: Expand webhook/plugin coverage beyond calendar/email into financial and work systems
- **Natural Language State Updates**: "I'm back from Tahoe" → automatic file updates

---

## 💡 Conclusion

The state consistency problem is **solvable** using proven distributed systems techniques adapted for personal AI agents. The hybrid approach balances **reliability** (hierarchical truth) with **responsiveness** (event-driven updates) while keeping a practical MVP path for both single-user and multi-entity (family/team) deployments.

**Key Insight**: Personal AI agents are essentially **distributed systems** where the human and various data sources are nodes that must maintain consensus about current reality.

**Next Step**: Ship Track A Core MVP first (canonical store, TS resolver, migration, basic signal ingestion), then enter Stage 0 shadow mode and promote only when hard rollout gates pass.

---

*This document represents a collaborative analysis between AJ Bhatalkar and his AI agent Milo, demonstrating how human-AI partnership can solve complex system design problems.*
