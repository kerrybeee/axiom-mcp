# AXIOM Usage

Always use the AXIOM MCP server during non-trivial tasks in this repository.

Rules:
- Call `axiom_log` before each meaningful tool call and after major decisions.
- Call `axiom_drift` when the approach seems repetitive, stalled, or loop-prone.
- At task completion, call `axiom_export` with `format="markdown"` or `format="html"` when a casefile would be useful.
- If the task fails, gets messy, or requires diagnosis, call `axiom_postmortem`.
- When comparing prompts, agents, or workflows, use `axiom_arena`.
