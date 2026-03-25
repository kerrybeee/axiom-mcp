# AXIOM MCP

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-339933.svg)
![Transport](https://img.shields.io/badge/MCP-stdio%20%7C%20http%2Fsse-0a7ea4.svg)
![Status](https://img.shields.io/badge/status-experimental-f59e0b.svg)

AXIOM is an MCP server for AI agent observability and control.

It started as a flight recorder for agent runs: logging reasoning steps, replaying sessions, detecting drift, and exporting shareable reports.

It now also acts as an early control layer:
- guardrails that evaluate a run in progress
- persistent policies that can warn, re-plan, or stop a session
- next-step recommendations
- alternate branch suggestions
- cross-session learning from past runs

If you are building or operating MCP agents, AXIOM gives you a way to inspect what happened and increasingly, to shape what happens next.

## In One Line

AXIOM is a black box recorder plus early control system for AI agents.

## What Makes It Different

Most agent tooling stops at logs.

AXIOM tries to close the loop:
- record what happened
- detect unhealthy trajectories
- recommend the next move
- gate bad actions before they waste more time or money
- learn from past runs

## Why Use It

Most agent runs are hard to debug once they go wrong.

AXIOM helps you answer:
- What did the agent actually do?
- When did it start looping?
- Which prompts, tools, or paths work better?
- Should this run continue, re-plan, or stop?

Practical uses:
- debugging unreliable agent runs
- comparing prompts, workflows, or agent variants
- generating postmortems and audit trails
- detecting repetition and wasted tool calls
- enforcing guardrails before a run gets more expensive

## Quickstart

```bash
npm install
npm run build
npm run start:http
```

Open:
- `http://localhost:3456/dashboard`
- `http://localhost:3456/gallery`

Or run the stdio server:

```bash
npm run start
```

## Core Features

- Reasoning ledger stored in SQLite
- Auto-tagged receipts and drift scoring
- Session replay, comparison, and search
- HTML/Markdown/JSON exports and share cards
- Browser dashboard, gallery, and report pages
- Guard evaluation and next-move recommendation
- Branch suggestions with predicted outcomes
- Persistent policy system for session control
- Gate checks that can allow, warn, or block proposed moves
- Resume flow for blocked sessions
- Historical learning across recent sessions

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

## Run

Stdio MCP server:

```bash
npm run start
```

HTTP/SSE server with browser UI:

```bash
AXIOM_PORT=3456 npm run start:http
```

Then open:
- `http://localhost:3456/dashboard`
- `http://localhost:3456/gallery`

## Browser Routes

- `/dashboard` - live browser dashboard for current and recent sessions
- `/gallery` - featured runs, chaotic failures, and recovery stories
- `/reports/:id` - polished HTML casefile for a session
- `/postmortem/:id?style=professional|roast` - HTML postmortem page
- `/visualize/:id` - Mermaid-ready visualization page
- `/arena?session_a=<id>&session_b=<id>` - head-to-head HTML arena
- `/events` - browser SSE stream for live updates

JSON APIs:
- `/api/dashboard`
- `/api/sessions`
- `/api/sessions/:id`
- `/api/leaderboard`
- `/api/gallery`

## Example Use Cases

- You are tuning an agent and want to compare two prompt or tool strategies.
- You need to know why an agent kept looping instead of shipping an answer.
- You want a postmortem or HTML report after a failed run.
- You want a policy like "stop if drift is too high" or "don't keep calling the same tool."
- You want to inspect and govern agent behavior across repeated runs, not just one transcript.

## Example Workflows

Export a session as HTML:

```json
{
  "session_id": "current",
  "format": "html"
}
```

Generate a roast-style postmortem:

```json
{
  "session_id": "current",
  "style": "roast",
  "format": "markdown"
}
```

Add a persistent guard policy:

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

Ask AXIOM what to do next:

```json
{
  "session_id": "current",
  "format": "text"
}
```

Gate a proposed tool call:

```json
{
  "session_id": "current",
  "tool": "search",
  "intent": "search again",
  "enforce": true,
  "format": "text"
}
```

Resume a blocked session:

```json
{
  "session_id": "current",
  "note": "Human reviewed and replanned"
}
```

## MCP Configuration

### Claude Desktop

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

### Codex

```bash
codex mcp add axiom -- node /absolute/path/to/axiom-mcp/dist/index.js
```

## Current State

AXIOM is experimental, but the core pieces are already usable:
- session logging and replay
- drift detection
- search and comparison
- browser dashboard and report pages
- policy-based guardrails
- next-step recommendation
- preflight action gating

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `AXIOM_WEBHOOK_URL` | empty | POST target for drift alerts and session completion events |
| `AXIOM_WEBHOOK_THRESHOLD` | `0.5` | Drift score that triggers webhook delivery |
| `AXIOM_PORT` | `3456` | Port for HTTP/SSE transport |

## Positioning

The shortest honest description is:

> AXIOM is a black box recorder and emerging control layer for AI agents.

## License

MIT
