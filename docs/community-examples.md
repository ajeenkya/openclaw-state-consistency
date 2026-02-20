# Community Examples & Use Cases

**Real OpenClaw developers sharing how they use state consistency**

---

## Solo Developer Stories

### **Alex - Freelance Developer**
*"I have ADHD and constantly lose context between coding sessions"*

**The Problem:**
- Forgot what features were implemented vs. planned
- Lost track of which bugs were fixed
- Agent gave outdated project status to clients

**Setup:**
```bash
# Simple single-user configuration
export STATE_ENTITY_ID="user:alex"
export STATE_TELEGRAM_TARGET="my_telegram_id"

# Project-focused domains
{
  "domains": {
    "project": {"auto_threshold": 0.85},
    "client": {"auto_threshold": 0.90}  
  }
}
```

**Results:**
- Agent remembers exactly where I left off each session
- Client updates are always accurate
- Haven't missed a deadline since implementing

**Key insight:** *"The confirmation workflow via Telegram is perfect. I get a quick 'Confirm: Feature X is complete?' and just tap Yes. Takes 2 seconds but prevents hours of confusion later."*

### **Sarah - Content Creator**  
*"My AI assistant kept giving me stale information about my content pipeline"*

**The Problem:**
- Agent didn't know which videos were published vs. scheduled
- Wrong information about sponsorship deadlines  
- Lost track of content series progress

**Setup:**
```bash
# Content creator workflow
export STATE_ENTITY_ID="creator:sarah"

# Connected to YouTube API and calendar
export STATE_GOG_ACCOUNT="sarah@creator.com"
```

**Custom domains:**
```json
{
  "content": {"auto_threshold": 0.80},
  "sponsorship": {"auto_threshold": 0.95},  
  "schedule": {"auto_threshold": 0.85}
}
```

**Results:**
- Agent knows current video status and upcoming deadlines
- Sponsorship tracking is bulletproof (money = high threshold)
- Content planning conversations are much more productive

---

## Small Team Examples

### **DevShop - 4-Person Development Team**
*"Our project management bot was constantly out of sync"*

**The Challenge:**
- 4 developers, different information about feature status
- Agent didn't know who was working on what
- Sprint planning based on outdated information

**Setup:**
```bash
# Team entity with shared state
export STATE_ENTITY_ID="team:devshop"

# GitHub integration for real project status  
export STATE_GITHUB_TOKEN="your_token"
export STATE_GITHUB_REPOS="devshop/client-portal,devshop/api-service"
```

**Confirmation workflow:**
- Technical lead gets confirmation requests for major milestones
- Developers can confirm their own task completions
- Client-facing status requires team lead approval

**Results:**
- Sprint planning takes 30% less time
- Client demos never have "that feature isn't done yet" moments
- Team coordination improved dramatically

**Team feedback:**
> *"The best part is that when someone says 'X is done' in Slack, the bot picks it up and asks for confirmation. No more manual status updates."* - Jake, Tech Lead

### **Research Lab - 6 Graduate Students**
*"Our literature review agent was citing outdated paper statuses"*

**The Problem:**
- Papers marked as "to read" when already reviewed
- Duplicate work on literature summaries
- Lost track of which experiments were completed

**Setup:**
```bash
export STATE_ENTITY_ID="lab:nlp-research"

# Academic-focused domains
{
  "domains": {
    "literature": {"auto_threshold": 0.80},
    "experiments": {"auto_threshold": 0.90},
    "deadlines": {"auto_threshold": 0.95}
  }
}
```

**Integration:**
- Zotero API for paper management
- Lab notebook Markdown files  
- Conference deadline tracking

**Results:**
- No more duplicate literature reviews
- Experiment tracking is reliable
- Conference submission deadlines never missed

---

## Creative Use Cases

### **Home Automation Enthusiast**
*"My smart home agent needs to know real device states"*

**Setup:**
```bash
export STATE_ENTITY_ID="home:smart-house"

# IoT device domains
{
  "domains": {
    "devices": {"auto_threshold": 0.85},
    "automation": {"auto_threshold": 0.90},
    "energy": {"auto_threshold": 0.80}
  }
}
```

**Sources:**
- Home Assistant API for device states
- Energy monitoring dashboard
- Manual confirmations for automations

**Example workflow:**
```
User: "Turn on movie mode"
Agent: [Checks canonical state] "Living room lights are currently on, TV is off, sound system is off. Activating movie mode..."
[Updates state after actions complete]
```

### **Dungeon Master Assistant**
*"My D&D campaign agent kept forgetting plot developments"*

**The Problem:**  
- Forgot which NPCs were alive/dead
- Lost track of player choices and consequences
- Session notes were inconsistent

**Setup:**
```bash
export STATE_ENTITY_ID="campaign:dragon-heist"

# D&D specific domains  
{
  "domains": {
    "npcs": {"auto_threshold": 0.90},
    "plot": {"auto_threshold": 0.85},
    "player_choices": {"auto_threshold": 0.95}
  }
}
```

**Sources:**
- Session notes (Markdown files)
- Player conversation during sessions
- Manual updates between sessions

**Results:**
- NPCs have consistent personalities and remember player interactions
- Plot threads don't get forgotten
- Campaign continuity is much better

---

## Integration Patterns

### **GitHub Projects**
```javascript
// Webhook integration example
app.post('/github-webhook', (req, res) => {
  if (req.body.action === 'closed' && req.body.pull_request) {
    const observation = {
      entity_id: "team:myteam",
      state_key: `project.pr_${req.body.pull_request.number}`,
      state_value: "merged",
      source_type: "github_webhook",
      confidence: 0.95
    };
    
    // Send to state consistency system
    ingestObservation(observation);
  }
});
```

### **Calendar Sync**
```bash
# Automatic calendar polling
npm run state:poller:install-cron

# Pulls from Google Calendar every 15 minutes
# Updates agent memory with meeting status, deadlines, etc.
```

### **Discord Bot Integration**
```javascript
// Discord message handler
client.on('messageCreate', (message) => {
  if (message.content.includes('completed') || message.content.includes('finished')) {
    // Extract potential state update
    const observation = extractStateFromMessage(message.content);
    if (observation.confidence > 0.7) {
      // Send for confirmation
      sendConfirmationRequest(observation);
    }
  }
});
```

---

## Configuration Recipes

### **Conservative Setup** (High Accuracy)
```json
{
  "domains": {
    "general": {"auto_threshold": 0.95, "ask_threshold": 0.85}
  },
  "adaptive_learning": false,
  "review_max_pending": 5
}
```
*Good for: Financial tracking, important deadlines, critical project info*

### **Balanced Setup** (Default)
```json  
{
  "domains": {
    "general": {"auto_threshold": 0.90, "ask_threshold": 0.70}
  },
  "adaptive_learning": true,
  "review_max_pending": 10
}
```
*Good for: Most development and personal productivity use cases*

### **Permissive Setup** (High Throughput)
```json
{
  "domains": {
    "general": {"auto_threshold": 0.80, "ask_threshold": 0.60}
  },
  "adaptive_learning": true,
  "review_max_pending": 20
}
```
*Good for: Content creation, brainstorming, casual conversation tracking*

---

## Community Tips & Tricks

### **Debugging State Issues**

```bash
# Check what's in your canonical state
npm run state:status | jq '.canonical_state'

# See recent state changes  
npm run state:status | jq '.recent_changes' 

# Check for failed validations
cat memory/state-dlq.jsonl | tail -5

# View pending confirmations
npm run state:pending
```

### **Custom Confidence Calculation**

```javascript
// Override confidence for specific patterns
function customConfidenceBoost(observation) {
  // Boost confidence for version control messages
  if (observation.source_type === 'conversation_assertive' && 
      observation.text.includes('merged') || 
      observation.text.includes('deployed')) {
    return Math.min(1.0, observation.confidence + 0.15);
  }
  return observation.confidence;
}
```

### **Batch State Updates**

```bash
# For migrating existing data
cat project-status.json | jq -c '.[]' | while read line; do
  echo "$line" | node scripts/state-consistency.js ingest
done
```

---

## Getting Help

### **Community Support**

- **GitHub Discussions** - Questions, ideas, and general help
- **Discord #state-consistency** - Real-time chat with other users  
- **Weekly Office Hours** - Live Q&A sessions (Fridays 2 PM PST)

### **Common Questions**

**Q: How do I handle conflicting information?**
A: The system uses source reliability + recency to resolve conflicts automatically. You can tune the weights in your config.

**Q: Can I use this without Telegram?**  
A: Yes! Confirmations can go through Discord, Slack, or just log files. Check the integrations guide.

**Q: What if my agent is making too many confirmation requests?**
A: Raise your confidence thresholds or enable adaptive learning to tune them automatically.

### **Troubleshooting**

**State not updating:**
1. Check `npm run state:health`  
2. Verify schema validation with `npm run schema:check`
3. Look for errors in `memory/state-dlq.jsonl`

**Performance issues:**
1. Check memory usage: `npm run state:status | jq '.memory_usage'`
2. Consider cleanup: `npm run state:cleanup --older-than 30d` 
3. Tune batch sizes in your configuration

---

## Contributing Your Examples

**Share your setup!** If you have an interesting use case or configuration:

1. **Open a Discussion** with your story and setup
2. **Submit a PR** to add your example to this file
3. **Join our Discord** and share in #showcase

**What we're looking for:**
- Real problems solved with specific configurations
- Creative integrations with other tools
- Performance optimizations for unique use cases  
- Domain-specific tuning examples

**Help other developers** by sharing what works (and what doesn't) in your setup!

---

*🤝 Built by the community, improved by the community.*