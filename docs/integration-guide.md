# OpenClaw Integration Guide

**Complete developer guide for integrating state consistency into OpenClaw agents**

---

## Overview

This guide shows you how to integrate the OpenClaw State Consistency Engine into your AI agents to eliminate hallucination and ensure reliable memory across sessions.

**What you'll achieve:**
- Agents verify facts before stating them
- Consistent memory across all sessions  
- Automatic conflict resolution from multiple data sources
- Enterprise-grade audit trails and reliability

---

## Quick Integration (5 minutes)

### **Step 1: Install and Configure**
```bash
# In your OpenClaw workspace
git clone https://github.com/ajeenkya/openclaw-state-consistency.git
cd openclaw-state-consistency
npm install

# Initialize the system
npm run state:init
npm run state:migrate  # Import existing OpenClaw memory
npm run state:doctor   # Verify setup
```

### **Step 2: Install the Plugin**
```bash
# Install the OpenClaw bridge plugin  
npm run state:plugin:install

# Restart your OpenClaw gateway
# This activates automatic state injection and confirmation handling
systemctl restart openclaw-gateway  # or your restart method
```

### **Step 3: Verify Integration**
```bash
# Test the end-to-end flow
npm run state:e2e:prepare -- --target YOUR_TELEGRAM_ID
npm run state:e2e:verify -- --field general.test --expected "Integration working"
```

**🎉 Your agent now has enterprise-grade state consistency!**

---

## How It Works

### **Automatic State Management Flow**

```mermaid
graph TD
    A[User sends message] --> B[OpenClaw receives]
    B --> C[Plugin intercepts]
    C --> D{Contains assertion?}
    D -->|Yes| E[Extract state observation]
    D -->|No| F[Normal processing]
    
    E --> G[Schema validation]
    G --> H[Intent classification]  
    H --> I[Confidence calculation]
    I --> J{Confidence check}
    
    J -->|High| K[Auto-apply to state]
    J -->|Medium| L[Queue for confirmation]
    J -->|Low| M[Request clarification]
    
    K --> N[Inject updated state]
    L --> O[Send Telegram confirmation]
    M --> N
    O --> P[User confirms/rejects]
    P --> K
    
    N --> Q[Agent responds with accurate info]
    
    F --> R[Inject current canonical state]
    R --> Q
```

### **Plugin Functions**

**1. `before_agent_start` Hook**
- Injects current canonical state into model context
- Ensures agent has latest verified information
- Happens before every response generation

**2. `message_received` Hook**  
- Scans incoming messages for factual assertions
- Extracts state observations automatically
- Routes through confidence-based decision pipeline

**3. `/state-confirm` Command Handler**
- Processes Yes/No button callbacks from Telegram
- Applies confirmations to canonical state
- Handles natural language "yes"/"no" replies

---

## Agent System Instructions

### **Required System Prompt Addition**

Add this to your OpenClaw agent's system instructions:

```markdown
## State Consistency Protocol (MANDATORY)

Your canonical state is automatically injected before every response. Use this verified information rather than guessing or hallucinating.

### Before stating any fact, check:
1. **Is this information in my canonical state?** → Use that as authoritative
2. **Do I need to verify this with tools?** → Use session_status, Read, memory_search
3. **Am I about to guess plausible information?** → Stop and verify instead

### Source attribution patterns:
- "According to my canonical state, your location is..."
- "Based on session_status, the current time is..."  
- "Let me verify this information first" → [use appropriate tool]

### Never:
- Generate plausible-sounding dates, numbers, or status information
- Make assumptions about user preferences without checking canonical state
- Continue conversations based on potentially stale information

The state consistency system will automatically learn from your interactions and improve over time.
```

### **Example Integration in Practice**

**❌ Before (Unreliable):**
```
User: "What time is my meeting today?"
Agent: "Your meeting is at 3 PM today." [Hallucinated - no verification]
```

**✅ After (Reliable):**
```
User: "What time is my meeting today?"  
Agent: [Checks injected canonical state]
"According to your canonical state, I don't have current calendar information. Let me check your calendar."
[Uses calendar tool] → "Your meeting is at 3:30 PM today."
[State system automatically stores this for future reference]
```

---

## Configuration Options

### **Domain-Specific Settings**

Configure different reliability thresholds by information domain:

```json
{
  "domains": {
    "financial": {
      "ask_threshold": 0.75,    // Higher scrutiny for money
      "auto_threshold": 0.95,   // Very confident before auto-applying
      "margin_threshold": 0.20  // Conservative boundaries
    },
    "travel": {
      "ask_threshold": 0.65,    // Medium stakes
      "auto_threshold": 0.90,   
      "margin_threshold": 0.15
    },
    "family": {
      "ask_threshold": 0.65,    // Personal context
      "auto_threshold": 0.90,
      "margin_threshold": 0.15  
    },
    "project": {
      "ask_threshold": 0.70,    // Work coordination
      "auto_threshold": 0.92,
      "margin_threshold": 0.18
    }
  }
}
```

### **Source Reliability Tuning**

Adjust how much you trust different information sources:

```json
{
  "source_reliability": {
    "user_confirmation": 1.00,      // Human verification always trusted
    "calendar_webhook": 0.90,       // Real-time API calls
    "email_poll": 0.84,             // Parsed structured data
    "conversation_assertive": 0.90, // "We are in Tahoe now"
    "conversation_planning": 0.75,  // "We might go to Tahoe" 
    "static_markdown": 0.60         // File-based memory
  }
}
```

### **Adaptive Learning** (Enterprise Feature)

Let the system learn optimal thresholds from user corrections:

```bash
# Start in observation mode (safe)
export STATE_ADAPTIVE_MODE="shadow"
export STATE_ADAPTIVE_MIN_SAMPLES="20"  # Learn after 20 interactions

# After validation period, apply learned thresholds  
export STATE_ADAPTIVE_MODE="apply"
export STATE_ADAPTIVE_TARGET_CORRECTION_RATE="0.05"  # Target 5% error rate
```

---

## Advanced Integration Patterns

### **Custom Intent Classification**

Replace the built-in rule-based intent classifier with your own ML model:

```bash
# Configure external intent classifier
export STATE_INTENT_EXTRACTOR_MODE="command"
export STATE_INTENT_EXTRACTOR_CMD="python3 scripts/custom_intent_classifier.py"
```

Your classifier should accept JSON input:
```json
{
  "text": "We are in Tahoe now",
  "domain": "travel",
  "context": "User responding to location question"
}
```

And output schema-compliant JSON:
```json
{
  "intent": "assertive",
  "confidence": 0.95,
  "reason": "Present tense definitive statement with location",
  "domain": "travel"
}
```

### **Multi-Entity Deployment**

Handle teams, families, or departments with separate state:

```bash
# Team deployment
export STATE_ENTITY_ID="team:engineering"

# Family deployment  
export STATE_ENTITY_ID="family:smith" 

# Department deployment
export STATE_ENTITY_ID="dept:sales-west"
```

Each entity maintains separate canonical state while sharing the same infrastructure.

### **Custom Confirmation Channels**

Extend beyond Telegram for confirmation workflows:

```javascript
// Plugin: Slack confirmation integration
class SlackConfirmationHandler {
  async sendConfirmation(prompt) {
    return await this.slack.postMessage({
      channel: process.env.SLACK_CHANNEL,
      blocks: [{
        type: "section", 
        text: { type: "mrkdwn", text: prompt.question },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Confirm" },
          action_id: `state_confirm_${prompt.id}`
        }
      }]
    });
  }
}
```

---

## Troubleshooting

### **Common Issues**

**1. Plugin Not Loading**
```bash
# Verify plugin installation
ls -la ~/.openclaw/plugins/state-consistency-bridge/

# Check OpenClaw logs
tail -f ~/.openclaw/logs/gateway.log | grep state-consistency

# Restart gateway with verbose logging
DEBUG=* openclaw gateway start
```

**2. Confirmations Not Appearing**  
```bash
# Verify Telegram configuration
npm run state:health
# Check: telegram_target_configured, last_review_age

# Test manual confirmation  
npm run state:telegram-review:run
```

**3. State Not Persisting**
```bash
# Check canonical state file permissions
ls -la memory/state-tracker.json

# Validate schema compliance
npm run schema:check

# Review dead letter queue for failures
cat memory/state-dlq.jsonl | tail -10
```

**4. High Confirmation Volume**
```bash
# Adjust confidence thresholds to be more permissive
# Edit cron-config.json or set environment variables:
export STATE_REVIEW_MIN_CONFIDENCE="0.8"  # Higher = fewer confirmations

# Check which domains are generating the most confirmations
npm run state:pending | jq '.[] | .domain' | sort | uniq -c
```

### **Performance Optimization**

**Memory Usage**
```bash
# Monitor memory usage
npm run state:health | jq '.memory_usage'

# Clean up old processed events (keep last 1000)
# This is handled automatically but can be tuned:
export MAX_PROCESSED_EVENT_IDS="500"
```

**Response Latency**  
```bash
# Check injection overhead
time npm run state:status  # Should be <50ms

# Profile canonical state size
ls -lh memory/state-tracker.json  # Optimal: <100KB
```

---

## Development Workflow

### **Testing State Changes**

```bash
# Manual state injection for testing
echo '{"entity_id":"user:test","state_key":"travel.location","state_value":"Paris","source_type":"user_confirmation","confidence":1.0}' | \
  node scripts/state-consistency.js ingest

# Verify the change
npm run state:status | jq '.canonical_state["travel.location"]'

# Test projection back to memory files  
npm run state:project
cat HEARTBEAT.md | grep -A5 "CANONICAL STATE"
```

### **Schema Evolution**

When adding new domains or changing data structures:

```bash
# 1. Update schemas in schemas/ directory
# 2. Validate schema changes
npm run schema:check

# 3. Test with sample data
echo '{"entity_id":"user:test","state_key":"health.exercise","state_value":"completed","source_type":"conversation_assertive"}' | \
  node scripts/state-consistency.js validate --schema state_observation

# 4. Update domain defaults if needed
# Edit DOMAIN_DEFAULTS in scripts/state-consistency.js
```

### **Custom Domain Addition**

```javascript
// Add to DOMAIN_DEFAULTS in state-consistency.js
const DOMAIN_DEFAULTS = {
  // ... existing domains
  health: { 
    ask_threshold: 0.65, 
    auto_threshold: 0.90, 
    margin_threshold: 0.15, 
    calibration_remaining: 30 
  }
};

// Add few-shot examples for intent classification
const FEW_SHOT_EXAMPLES = {
  // ... existing examples  
  health: [
    { input: "I completed my workout today.", intent: "assertive" },
    { input: "I plan to exercise tomorrow.", intent: "planning" },
    { input: "I might skip the gym if I'm tired.", intent: "hypothetical" }
  ]
};
```

---

## API Reference

### **Core Functions**

**State Observation Ingestion**
```bash
# Via command line
echo '{"entity_id":"user:primary","state_key":"travel.location","state_value":"NYC","source_type":"conversation_assertive","confidence":0.9}' | \
  node scripts/state-consistency.js ingest

# Via Node.js API
const stateConsistency = require('./scripts/state-consistency.js');
await stateConsistency.ingestObservation({
  entity_id: "user:primary",
  state_key: "project.status", 
  state_value: "completed",
  source_type: "user_confirmation",
  confidence: 1.0
});
```

**State Querying**
```bash
# Get current canonical state
npm run state:status

# Get specific state key
npm run state:status | jq '.canonical_state["travel.location"]'

# Get state with history
node scripts/state-consistency.js history --key travel.location --limit 10
```

**Manual Confirmation**
```bash
# Confirm pending item by ID
node scripts/state-consistency.js confirm --id abc-123-def --decision yes

# List all pending confirmations  
npm run state:pending
```

---

## Security Considerations

### **Input Validation**
- All state observations validated against strict JSON Schema
- Failed validations sent to dead letter queue for analysis
- No arbitrary code execution from user input

### **Access Control**
```bash
# Restrict which senders can trigger state ingestion
export STATE_INGEST_ALLOWED_SENDERS="user_id_1,user_id_2"

# Limit which channels are monitored
export STATE_INGEST_CHANNELS="telegram,discord"
```

### **Audit Trail**  
- Complete history of all state changes in memory/state-tracker.json
- Audit log includes: timestamp, source, confidence, reasoning
- Point-in-time recovery to any previous state version

---

## Enterprise Deployment

### **High Availability Setup**

```bash
# Shared state store (Redis)
export STATE_STORE_TYPE="redis"
export STATE_STORE_URL="redis://cluster.company.com:6379"

# PostgreSQL audit store
export AUDIT_STORE_TYPE="postgresql"  
export AUDIT_STORE_URL="postgres://user:pass@db.company.com/audit"

# Load balancer configuration
export STATE_INSTANCE_ID="node-1"
export STATE_CLUSTER_PEERS="node-2.internal,node-3.internal"
```

### **Monitoring Integration**

```bash
# Prometheus metrics endpoint
export STATE_METRICS_PORT="9090"

# Health check for load balancer
curl http://localhost:8080/health
# Returns: {"status":"ok","pending":5,"dlq":0,"last_poll":"2026-02-19T18:30:00Z"}

# Grafana dashboard queries
state_consistency_pending_count        # Pending confirmations
state_consistency_dlq_count           # Failed validations  
state_consistency_confidence_avg      # Average confidence scores
state_consistency_resolution_time     # Time to resolve conflicts
```

### **Compliance Configuration**

```bash
# GDPR compliance
export STATE_PII_ENCRYPTION="aes-256-gcm"
export STATE_RETENTION_DAYS="365" 
export STATE_ANONYMIZATION_ENABLED="true"

# SOX compliance  
export STATE_AUDIT_IMMUTABLE="true"
export STATE_FINANCIAL_DOMAINS="financial,accounting,treasury"
export STATE_FINANCIAL_APPROVAL_REQUIRED="true"

# HIPAA compliance
export STATE_PHI_DOMAINS="health,medical"
export STATE_PHI_DOUBLE_APPROVAL="true"
export STATE_PHI_AUDIT_LEVEL="verbose"
```

---

This integration guide provides everything needed to deploy enterprise-grade state consistency in your OpenClaw agents. For additional support, see our [Enterprise Support](#) options or join the [Developer Community](#).

*🚀 Ready to eliminate AI reliability failures? Start with the 5-minute quick integration above.*