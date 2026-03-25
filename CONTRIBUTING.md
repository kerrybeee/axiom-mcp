# Contributing to AXIOM MCP

Thanks for contributing.

AXIOM is still experimental, so the best contributions are the ones that make agent runs more observable, more steerable, or easier to debug.

## Local Setup

```bash
npm install
npm run build
```

Run the stdio server:

```bash
npm run start
```

Run the HTTP/SSE server with dashboard:

```bash
npm run start:http
```

## What To Work On

High-value areas:
- stronger drift and failure detection
- better control and intervention logic
- better branching and next-step recommendations
- dashboard and report UX
- safer remote deployment patterns
- tests for analysis, guardrails, and policy behavior

## Development Notes

- The project is TypeScript-first and builds to `dist/`.
- SQLite persistence is handled through `sql.js`.
- Keep outputs easy to scan from both MCP clients and the browser UI.
- Prefer changes that improve real agent reliability over cosmetic complexity.

## Before Opening a PR

- Make sure `npm run build` passes.
- Keep the README aligned with any new public feature.
- If you add a new MCP tool, document it in the tools table.
- If you change behavior around guardrails or enforcement, include a short example in the PR description.

## Design Direction

The long-term direction is not just "agent logging."

AXIOM is trying to become:
- a black box recorder
- a postmortem engine
- a guardrail layer
- an execution governor for MCP agents

Contributions that move it toward that direction are especially welcome.
