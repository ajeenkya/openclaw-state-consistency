# Developer Guide

**How to integrate state consistency into your OpenClaw agents**

---

## Quick Setup

### **Option 1: Auto-Plugin (Recommended)**

```bash
# Install and activate
npm run state:plugin:install

# Restart OpenClaw
# Everything else happens automatically
```

The plugin handles:
- Extracting state observations from conversations
- Injecting current state into your agent's context  
- Routing confirmations through Telegram/Discord
- No changes needed to your agent code

### **Option 2: Manual Integration**

```bash
# Set up the core system
npm run state:init

# Import existing memory (optional)
npm run state:migrate  

# Set up external polling (optional)
npm run state:poller:install-cron

# Set up confirmation system
npm run state:telegram-review:install-launchd
```

---

## How Your Agent Uses State

### **Automatic State Injection**

Before every response, your agent gets this added to its context:

```markdown
## Canonical State

Based on verified information, here's what I know for certain:

**Travel**: You are currently in Tahoe (confirmed Feb 19, 2026)
**Project**: Feature X is 85% complete (updated 2 hours ago via GitHub)  
**Schedule**: Meeting with client moved to 3:30 PM today (calendar update)

Use this verified information instead of guessing or relying on potentially stale data.
```

### **State Observation Flow**

When someone says something factual, the system:

1. **Extracts the observation**: "We are in Tahoe now" → `{location: "Tahoe", confidence: 0.9}`
2. **Checks confidence**: 0.9 is above auto-threshold (0.85) for travel domain
3. **Updates canonical state**: `travel.location = "Tahoe"`
4. **Available for next response**: Agent knows current location

### **Confirmation Workflow**

For medium-confidence observations:

```
User: "I might work from home tomorrow"
System: Detects planning intent, confidence: 0.75
System: Sends Telegram: "Confirm: You're working from home tomorrow? ✅ Yes ❌ No"
User: Taps ✅
System: Updates canonical state
Agent: Now knows work location for tomorrow
```

---

## Configuration

### **Basic Configuration**

Most developers can just set:

```bash
export STATE_ENTITY_ID="user:yourname"
export STATE_TELEGRAM_TARGET="your_telegram_user_id"  
```

### **Domain Tuning**

Different types of info need different confidence levels:

```json
{
  "domains": {
    "project": {
      "auto_threshold": 0.85,    // Auto-store if 85%+ confident
      "ask_threshold": 0.70      // Ask user if 70-85% confident  
    },
    "financial": {
      "auto_threshold": 0.95,    // Money needs higher confidence
      "ask_threshold": 0.80
    },
    "casual": {
      "auto_threshold": 0.80,    // More relaxed for casual info
      "ask_threshold": 0.60
    }
  }
}
```

### **Source Reliability**

Tell the system how much to trust different information sources:

```javascript
const SOURCE_RELIABILITY = {
  user_confirmation: 1.0,        // Human says it's true
  calendar_webhook: 0.90,        // Real-time API update
  github_api: 0.85,              // Structured API data
  conversation_assertive: 0.85,  // "We are in Paris now"  
  conversation_planning: 0.70,   // "We might go to Paris"
  static_markdown: 0.60,         // File-based info (could be stale)
  conversation_hypothetical: 0.40 // "Paris would be nice"
};
```

---

## Integration Patterns

### **GitHub Integration**

Track project status automatically:

```bash
# Set up GitHub webhook endpoint
# Point it to: http://your-server.com/webhook/github

# Webhook handler
app.post('/webhook/github', (req, res) => {
  if (req.body.action === 'closed' && req.body.pull_request) {
    const observation = {
      entity_id: "user:dev",
      state_key: `project.${req.body.repository.name}`,
      state_value: "PR merged",
      source_type: "github_webhook"  
    };
    ingestObservation(observation);
  }
});
```

### **Calendar Sync**

Your agent stays updated on your schedule:

```bash
# Enable Google Calendar polling  
export STATE_GOG_ACCOUNT="your-email@gmail.com"
npm run state:poller:install-cron

# Now your agent knows:
# - Upcoming meetings
# - Schedule changes  
# - Free time availability
```

### **Discord Bot Integration**

```javascript
client.on('messageCreate', message => {
  // Look for status updates
  const statusPattern = /(completed|finished|deployed|merged)/i;
  if (statusPattern.test(message.content)) {
    
    const observation = {
      entity_id: "team:myteam",
      state_key: extractStateKey(message.content), 
      state_value: extractValue(message.content),
      source_type: "conversation_assertive"
    };
    
    // Send for processing
    ingestStateObservation(observation);
  }
});
```

### **File System Watching**

Monitor your project files for changes:

```javascript
const chokidar = require('chokidar');

chokidar.watch('project/**/*.md').on('change', (path) => {
  // Extract state from file changes
  const content = fs.readFileSync(path, 'utf8');
  if (content.includes('Status: Complete')) {
    ingestObservation({
      state_key: `project.${path}`,
      state_value: "complete",
      source_type: "file_system"
    });
  }
});
```

---

## Agent System Instructions

### **Required Addition to Your System Prompt**

```markdown
## State Consistency Instructions

Your canonical state is injected before every response. This contains verified, up-to-date information that you should use instead of guessing or relying on potentially stale data.

### Before stating facts:
1. **Check canonical state first** - Use verified information when available
2. **Verify with tools when needed** - Use session_status, Read, memory_search for missing info
3. **Never guess** - If uncertain, say "Let me check that" and use appropriate tools
4. **Attribute sources** - "According to my records..." or "Based on the latest update..."

### Examples:
❌ "Your meeting is at 3 PM" (could be wrong)  
✅ "According to your calendar, your meeting is at 3:30 PM" (verified)

❌ "Feature X is probably done" (guessing)
✅ "Let me check the latest status" → [uses tool] → "Feature X is 85% complete"
```

### **Optional: Custom Confidence Patterns**

Add to your agent's instructions if you want more control:

```markdown
When I mention something that might be factual:
- If I sound certain ("We are in Tokyo"), that should be high confidence
- If I'm planning ("We'll go to Tokyo next week"), that's medium confidence  
- If I'm speculating ("Tokyo might be nice"), that's low confidence

The system will ask for confirmation on medium confidence items.
```

---

## API Reference

### **Core Functions**

**Ingest State Observation**
```javascript
const observation = {
  entity_id: "user:dev",           // Required: who this applies to
  state_key: "project.status",     // Required: what aspect of state
  state_value: "deployed",         // Required: the new value  
  source_type: "conversation_assertive", // Required: how we learned this
  confidence: 0.9,                 // Optional: explicit confidence
  reasoning: "User said 'deployed to prod'" // Optional: why we extracted this
};

await ingestObservation(observation);
```

**Query Current State**
```bash
# Get all state
npm run state:status

# Get specific key  
npm run state:status | jq '.canonical_state["project.status"]'

# Get state history
node scripts/state-consistency.js history --key project.status --limit 5
```

**Manual Confirmation**
```bash
# See what needs confirmation
npm run state:pending

# Confirm by ID  
node scripts/state-consistency.js confirm --id abc-123 --decision yes

# Batch confirm
npm run state:review-queue
```

### **Schema Reference**

**State Observation Schema**
```json
{
  "type": "object",
  "properties": {
    "entity_id": {"type": "string"},
    "state_key": {"type": "string"},
    "state_value": {},
    "source_type": {"enum": [
      "conversation_assertive",
      "conversation_planning", 
      "conversation_hypothetical",
      "calendar_poll",
      "github_webhook",
      "user_confirmation"
    ]},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "timestamp": {"type": "string", "format": "date-time"}
  },
  "required": ["entity_id", "state_key", "state_value", "source_type"]
}
```

---

## Debugging

### **Common Issues**

**Agent not using canonical state:**
```bash
# Check if plugin is loaded
ls ~/.openclaw/plugins/state-consistency-bridge/

# Check OpenClaw logs  
tail -f ~/.openclaw/logs/gateway.log | grep state

# Verify state injection is working
npm run state:status | jq '.last_injection'
```

**Too many confirmations:**
```bash
# Check what's pending
npm run state:pending

# Raise confidence thresholds
export STATE_REVIEW_MIN_CONFIDENCE="0.8"

# Or enable learning mode
export STATE_ADAPTIVE_MODE="shadow"
```

**State not persisting:**
```bash
# Check file permissions
ls -la memory/state-tracker.json

# Check for schema validation errors  
cat memory/state-dlq.jsonl

# Verify data format
npm run schema:check
```

### **Health Monitoring**

```bash
# Overall system health
npm run state:health

# Response: 
# {
#   "status": "ok",
#   "pending": 3,
#   "dlq_count": 0,  
#   "last_poll": "2026-02-19T18:30:00Z",
#   "memory_usage": "52MB"
# }

# Detailed diagnostics
npm run state:doctor
```

---

## Advanced Usage

### **Custom Intent Classification**

Replace the built-in rule-based classifier:

```bash
export STATE_INTENT_EXTRACTOR_MODE="command"
export STATE_INTENT_EXTRACTOR_CMD="python3 my_classifier.py"
```

Your classifier gets JSON on stdin:
```json
{"text": "We finished the deployment", "domain": "project"}
```

Should output:
```json
{"intent": "assertive", "confidence": 0.95, "reasoning": "Past tense completion"}
```

### **Multi-User Setup**

```bash
# Team shared state
export STATE_ENTITY_ID="team:dev-squad"

# Individual developer state  
export STATE_ENTITY_ID="user:alice"

# Family shared state
export STATE_ENTITY_ID="family:smiths"
```

### **Custom Confirmation Channels**

```javascript
// Slack integration example
class SlackConfirmationHandler {
  async sendConfirmation(prompt) {
    await this.slack.postMessage({
      channel: '#dev-confirmations',
      text: prompt.question,
      attachments: [{
        actions: [{
          name: 'confirm',
          text: 'Yes',
          type: 'button',
          value: prompt.id
        }, {
          name: 'reject', 
          text: 'No',
          type: 'button',
          value: prompt.id
        }]
      }]
    });
  }
}
```

---

## Performance Tips

### **For Solo Developers**
```bash
# Lightweight configuration
export MAX_PROCESSED_EVENT_IDS="1000"
export STATE_REVIEW_MAX_PENDING="5" 
export STATE_CLEANUP_INTERVAL="24"
```

### **For Teams**
```bash
# Handle more volume
export MAX_PROCESSED_EVENT_IDS="5000"
export STATE_REVIEW_MAX_PENDING="20"
export STATE_BATCH_SIZE="10"
```

### **Memory Optimization**
```bash
# Clean up old events
npm run state:cleanup --older-than 30d

# Reduce event history
export MAX_PROCESSED_EVENT_IDS="2000"

# Smaller confirmation queues
export STATE_REVIEW_MAX_PENDING="10"
```

---

## Community

### **Getting Help**
- **GitHub Issues** - Bug reports and feature requests
- **Discussions** - Questions and community examples
- **Discord #state-consistency** - Real-time help
- **Weekly Office Hours** - Live Q&A (Fridays 2 PM PST)

### **Contributing**
- **Share your setup** - Add examples to community-examples.md
- **Report bugs** - Help us make it more reliable
- **Request features** - Tell us what integrations you need
- **Submit PRs** - Code contributions welcome

### **Roadmap**
- Discord native integration
- Visual state browser  
- More external connectors (Notion, Linear, Obsidian)
- Performance improvements for large teams

---

*🛠️ Happy building! Questions? Ask in Discord or open an issue.*