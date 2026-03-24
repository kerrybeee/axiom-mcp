# AXIOM MCP Server v2.0

AXIOM is a flight recorder for AI agents: a persistent reasoning ledger with searchable receipts, drift detection, session replays, shareable exports, arena comparisons, postmortems, and HTTP/SSE transport for multi-agent setups.

AXIOM now also includes an early control layer: persistent policies, guard evaluations, next-step recommendations, branching options, and cross-session learning.

## What It Does

- Logs reasoning steps and tool calls into SQLite
- Detects looping or repetitive behavior with a drift score
- Replays sessions as timelines, narratives, and markdown casefiles
- Exports sessions as JSON, Markdown, HTML, or compact share cards
- Compares sessions head-to-head in an arena scorecard
- Generates postmortems, fingerprints, and agent DNA summaries
- Stores control policies that can warn, re-plan, switch tools, summarize, or stop runs
- Recommends the best next move for a session instead of only replaying the past
- Proposes alternate branches with predicted outcomes
- Learns recurring healthy and risky patterns from historical runs
- Gates proposed next actions and can persist watch/blocked session state
- Lets a session be explicitly resumed after a re-plan or human review
- Ranks recent sessions with a lightweight leaderboard
- Supports stdio and HTTP/SSE MCP transports

## Tools

| Tool | Description |
| --- | --- |
| `axiom_log` | Record a reasoning step with auto-tags, hashes, and drift updates |
| `axiom_receipts` | Retrieve current-session receipts, optionally filtered by drift |
| `axiom_drift` | Show current drift and tool usage breakdown |
| `axiom_clear` | End the current session and start fresh |
| `axiom_summary` | Return a full JSON session health report |
| `axiom_search` | Search all historical receipts by keyword, tag, tool, drift, or date |
| `axiom_compare` | Side-by-side text comparison of two sessions |
| `axiom_replay` | Replay a session as narrative, timeline, or markdown report |
| `axiom_sessions` | List recent sessions with score, drift, and mission |
| `axiom_export` | Export a session as JSON, Markdown, HTML, or share card |
| `axiom_arena` | Produce a winner card for two sessions in text, JSON, Markdown, or HTML |
| `axiom_postmortem` | Generate a professional or roast-style postmortem |
| `axiom_visualize` | Visualize a session as Mermaid or markdown |
| `axiom_fingerprint` | Show failure fingerprints, DNA, and recommendations |
| `axiom_leaderboard` | Rank recent sessions by overall score |
| `axiom_policy` | Add, list, enable, disable, or remove persistent control policies |
| `axiom_guard` | Evaluate built-in and custom guardrails against a session |
| `axiom_next` | Recommend the best next move for the current trajectory |
| `axiom_branch` | Propose alternate branches with predicted outcomes |
| `axiom_learn` | Learn recurring healthy and risky patterns from history |
| `axiom_gate` | Preflight-check a proposed action and allow, warn, or block it |
| `axiom_intervene` | Persist a watch or blocked state for a session |
| `axiom_resume` | Resume a watched or blocked session after re-planning |

## Install

```bash
npm install
npm run build
```

## Claude Desktop (stdio)

macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`  
Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "axiom": {
      "command": "node",
      "args": ["/absolute/path/to/axiom-mcp/dist/index.js"],
      "env": {
        "AXIOM_WEBHOOK_URL": "https://your-webhook.site/hook",
        "AXIOM_WEBHOOK_THRESHOLD": "0.5"
      }
    }
  }
}
```

## HTTP/SSE

```bash
AXIOM_PORT=3456 npm run start:http
```

Remote hosts can connect to:

- SSE: `http://your-server:3456/sse`
- Health: `http://your-server:3456/health`
- Dashboard: `http://your-server:3456/dashboard`

## Browser Routes

The HTTP server now ships with demo-friendly pages and JSON APIs:

- `/dashboard` - live browser dashboard for current and recent sessions
- `/gallery` - browse featured runs, chaotic failures, and recovery stories
- `/reports/:id` - polished HTML casefile for a session
- `/postmortem/:id?style=professional|roast` - HTML postmortem page
- `/visualize/:id` - Mermaid-ready visualization page
- `/arena?session_a=<id>&session_b=<id>` - head-to-head HTML arena
- `/events` - browser SSE stream for live dashboard updates
- `/api/dashboard` - dashboard JSON payload
- `/api/sessions` - recent session summaries
- `/api/sessions/:id` - single session summary JSON
- `/api/leaderboard` - ranked session summaries
- `/api/gallery` - featured, chaotic, and recovery gallery buckets

## Example Prompts

Ask your agent to use AXIOM like this:

```text
You have access to AXIOM, a flight recorder for agent reasoning.
- Call axiom_log before each tool call and after significant decisions.
- Call axiom_drift when you suspect repetition or looping.
- Call axiom_postmortem at the end of failed runs.
- Call axiom_export with format="html" or format="card" for shareable output.
- Call axiom_arena to compare prompt or agent variants on the same task.
```

## Example Workflows

### Export a session as HTML

```json
{
  "session_id": "current",
  "format": "html"
}
```

### Generate a roast-style postmortem

```json
{
  "session_id": "current",
  "style": "roast",
  "format": "markdown"
}
```

### Compare two sessions in the arena

```json
{
  "session_a": "abc123",
  "session_b": "def456",
  "format": "html"
}
```

### Visualize a session as Mermaid

```json
{
  "session_id": "current",
  "format": "mermaid"
}
```

### Add a persistent guard policy

```json
{
  "op": "add",
  "name": "Stop high drift early",
  "scope": "global",
  "condition": "drift",
  "action": "stop",
  "threshold": 0.35
}
```

### Ask AXIOM what to do next

```json
{
  "session_id": "current",
  "format": "text"
}
```

### Gate a proposed tool call before using it

```json
{
  "session_id": "current",
  "tool": "search",
  "intent": "search again",
  "enforce": true,
  "format": "text"
}
```

### Resume a blocked session

```json
{
  "session_id": "current",
  "note": "Human reviewed and replanned"
}
```

### Open the browser dashboard

```text
http://localhost:3456/dashboard
```

### Open the gallery

```text
http://localhost:3456/gallery
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `AXIOM_WEBHOOK_URL` | empty | POST target for drift alerts and session completion events |
| `AXIOM_WEBHOOK_THRESHOLD` | `0.5` | Drift score that triggers webhook delivery |
| `AXIOM_PORT` | `3456` | Port for HTTP/SSE transport |

## Current Positioning

The most useful mental model is:

> AXIOM is a black box recorder and postmortem engine for AI agents.
