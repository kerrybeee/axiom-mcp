import {
  countReceipts,
  deletePolicy,
  endSession,
  findPolicy,
  findSession,
  getPolicies,
  getReceipts,
  getSessionControl,
  getSessions,
  getToolHistory,
  insertPolicy,
  insertReceipt,
  insertSession,
  searchReceipts,
  setSessionControl,
  setPolicyEnabled,
  type ReceiptRow,
  type PolicyRow,
  type SessionRow,
} from "./db.js";
import { analyzeSession, compareAnalyses, type SessionAnalysis } from "./analysis.js";
import { branchOptions, evaluateGuard, gateProposedAction, learnFromHistory, recommendNextMove } from "./intelligence.js";
import {
  renderArenaHtml,
  renderArenaMarkdown,
  renderMermaid,
  renderPostmortemHtml,
  renderPostmortemMarkdown,
  renderSessionCard,
  renderSessionHtml,
  renderSessionMarkdown,
} from "./reports.js";
import { publishAxiomEvent } from "./event-bus.js";
import { autoTag, calcDrift, driftEmit, driftLabel, simHash } from "./tags.js";
import { completePayload, driftPayload, maybeFire } from "./webhook.js";

export interface ActiveSession {
  id: string;
  startedAt: string;
  mission?: string;
}

let current: ActiveSession = {
  id: simHash(`${Date.now()}${Math.random()}`),
  startedAt: new Date().toISOString(),
};

export function initSession(mission?: string) {
  current = {
    id: simHash(`${Date.now()}${Math.random()}`),
    startedAt: new Date().toISOString(),
    mission,
  };
  insertSession(current.id, current.startedAt, mission);
  setSessionControl(current.id, "active", null);
  publishAxiomEvent({
    type: "session_started",
    sessionId: current.id,
    timestamp: current.startedAt,
    mission,
  });
}

export function getCurrentSession() {
  return current;
}

function currentSessionRow(): SessionRow {
  return {
    id: current.id,
    started_at: current.startedAt,
    mission: current.mission ?? null,
    ended_at: null,
  };
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function fmtReceipt(receipt: ReceiptRow): string {
  const flag = receipt.drift > 0.5 ? " !" : receipt.drift > 0.2 ? " ~" : " +";
  const tags = parseTags(receipt.tags);
  const tagText = tags.length > 0 ? ` #${tags.join(" #")}` : "";
  let line = `[${String(receipt.id).padStart(3, "0")}]${flag} ${receipt.timestamp.slice(11, 19)}  ${receipt.decision}`;
  if (receipt.tool) line += `  [${receipt.tool}]`;
  line += tagText;
  line += `\n       ctx:${receipt.ctx_hash}  out:${receipt.out_hash}  drift:${receipt.drift.toFixed(2)}`;
  return line;
}

function resolveSessionRow(sessionId?: string): SessionRow {
  if (!sessionId || sessionId === "current") return currentSessionRow();
  const found = findSession(sessionId);
  if (!found) throw new Error(`Session not found: ${sessionId}`);
  return found;
}

function getAnalysis(sessionId?: string): SessionAnalysis {
  const session = resolveSessionRow(sessionId);
  const receipts = getReceipts(session.id);
  return analyzeSession(session.id, receipts, session);
}

function getActivePolicies(sessionId: string): PolicyRow[] {
  return getPolicies({ sessionId, enabledOnly: true });
}

function getGuardBundle(sessionId?: string) {
  const analysis = getAnalysis(sessionId);
  const guard = evaluateGuard(analysis, getActivePolicies(analysis.sessionId));
  const next = recommendNextMove(analysis, guard);
  const control = getSessionControl(analysis.sessionId);
  return { analysis, guard, next, control };
}

function formatGuardText(bundle: ReturnType<typeof getGuardBundle>): string {
  const active = bundle.guard.triggers.filter((trigger) => trigger.triggered);
  let out = `AXIOM Guard - ${bundle.analysis.sessionId.slice(0, 12)}\n`;
  out += `${"-".repeat(60)}\n`;
  out += `status : ${bundle.guard.status}\n`;
  out += `control: ${bundle.control.state}\n`;
  out += `summary: ${bundle.guard.summary}\n`;
  out += `next   : ${bundle.next.title}\n`;
  if (active.length === 0) {
    out += "\nNo guard triggers are active.";
    return out;
  }
  out += "\n\nTriggers:\n";
  out += active
    .map((trigger) => `- [${trigger.source}] ${trigger.name}: ${trigger.reason} -> ${trigger.recommendation}`)
    .join("\n");
  return out;
}

function formatNextText(bundle: ReturnType<typeof getGuardBundle>): string {
  return [
    `AXIOM Next - ${bundle.analysis.sessionId.slice(0, 12)}`,
    `${"-".repeat(60)}`,
    `control    : ${bundle.control.state}`,
    `title      : ${bundle.next.title}`,
    `action     : ${bundle.next.action}`,
    `confidence : ${bundle.next.confidence.toFixed(2)}`,
    `tool       : ${bundle.next.recommendedTool ?? "none"}`,
    `rationale  : ${bundle.next.rationale}`,
  ].join("\n");
}

function formatPolicyList(sessionId?: string): string {
  const policies = sessionId ? getPolicies({ sessionId }) : getPolicies();
  if (policies.length === 0) return "// No policies configured yet.";
  return `AXIOM Policies\n${"-".repeat(72)}\n${policies
    .map((policy) =>
      `#${String(policy.id).padStart(2, "0")} ${policy.enabled ? "on " : "off"} ${policy.scope.padEnd(7)} ${policy.condition.padEnd(16)} -> ${policy.action.padEnd(11)} ${policy.name}${policy.threshold !== null ? ` (threshold ${policy.threshold})` : ""}`,
    )
    .join("\n")}`;
}

function summaryPayload(analysis: SessionAnalysis) {
  const guard = evaluateGuard(analysis, getActivePolicies(analysis.sessionId));
  const next = recommendNextMove(analysis, guard);
  return {
    session_id: analysis.sessionId,
    mission: analysis.mission,
    started_at: analysis.startedAt,
    ended_at: analysis.endedAt,
    receipt_count: analysis.receiptCount,
    chain_depth: analysis.chainDepth,
    unique_tools: analysis.uniqueTools,
    tool_usage: analysis.toolUsage,
    tag_usage: analysis.tagUsage,
    current_drift: analysis.currentDrift,
    peak_drift: analysis.peakDrift,
    avg_drift: analysis.avgDrift,
    health: analysis.health,
    drift_label: analysis.driftLabel,
    dna: analysis.dna,
    score: analysis.score,
    control_state: getSessionControl(analysis.sessionId).state,
    control_reason: getSessionControl(analysis.sessionId).reason,
    guard_status: guard.status,
    next_move: next,
    fingerprints: analysis.fingerprints,
    suggestions: analysis.suggestions,
    timeline: analysis.receipts.map((receipt) => ({
      id: receipt.id,
      timestamp: receipt.timestamp,
      decision: receipt.decision,
      tool: receipt.tool,
      drift: receipt.drift,
      tags: parseTags(receipt.tags),
    })),
  };
}

function formatComparisonText(a: SessionAnalysis, b: SessionAnalysis): string {
  const comparison = compareAnalyses(a, b);
  const row = (label: string, left: string | number, right: string | number) =>
    `${label.padEnd(16)} ${String(left).padEnd(18)} ${String(right).padEnd(18)}`;

  let out = "AXIOM Arena\n";
  out += `${"=".repeat(58)}\n`;
  out += `${"".padEnd(16)} ${"A".padEnd(18)} ${"B".padEnd(18)}\n`;
  out += `${"-".repeat(58)}\n`;
  out += `${row("session", a.sessionId.slice(0, 12), b.sessionId.slice(0, 12))}\n`;
  out += `${row("score", comparison.scoreA, comparison.scoreB)}\n`;
  out += `${row("drift", a.currentDrift.toFixed(2), b.currentDrift.toFixed(2))}\n`;
  out += `${row("peak drift", a.peakDrift.toFixed(2), b.peakDrift.toFixed(2))}\n`;
  out += `${row("receipts", a.receiptCount, b.receiptCount)}\n`;
  out += `${row("errors", a.errorCount, b.errorCount)}\n`;
  out += `${row("recoveries", a.recoveries, b.recoveries)}\n`;
  out += `${row("health", a.health, b.health)}\n\n`;
  out += `Winner : ${comparison.winner}\n`;
  out += `Summary: ${comparison.summary}\n`;
  if (comparison.reasons.length > 0) {
    out += "\nReasons:\n";
    out += comparison.reasons.map((reason) => `- ${reason}`).join("\n");
  }
  return out;
}

function formatReplayTimeline(analysis: SessionAnalysis): string {
  let out = `AXIOM Timeline - ${analysis.sessionId.slice(0, 12)}\n`;
  if (analysis.mission) out += `Mission: ${analysis.mission}\n`;
  out += `${"-".repeat(58)}\n`;
  for (const receipt of analysis.receipts) {
    const tags = parseTags(receipt.tags);
    out += `${receipt.timestamp.slice(11, 19)} | step ${receipt.id} | drift:${receipt.drift.toFixed(2)}`;
    if (receipt.tool) out += ` | [${receipt.tool}]`;
    out += `\n  ${receipt.decision}\n`;
    if (tags.length > 0) out += `  tags: ${tags.join(", ")}\n`;
    out += "\n";
  }
  return out.trimEnd();
}

function formatReplayNarrative(analysis: SessionAnalysis): string {
  let out = `AXIOM Replay - ${analysis.sessionId.slice(0, 12)}\n`;
  if (analysis.mission) out += `Mission: "${analysis.mission}"\n`;
  out += `${"-".repeat(58)}\n\n`;
  for (const receipt of analysis.receipts) {
    const tags = parseTags(receipt.tags);
    out += `Step ${receipt.id} [${receipt.timestamp.slice(11, 19)}]\n`;
    out += `  The agent ${receipt.decision.toLowerCase().startsWith("i ") ? receipt.decision : `decided to ${receipt.decision}`}\n`;
    if (receipt.tool) out += `  -> Called tool: ${receipt.tool}\n`;
    if (receipt.context) out += `  Context: ${receipt.context}\n`;
    if (tags.length > 0) out += `  Tags: ${tags.join(", ")}\n`;
    if (receipt.drift > 0.4) out += `  Warning: drift ${receipt.drift.toFixed(2)}\n`;
    out += "\n";
  }
  out += `${"-".repeat(58)}\n${analysis.receiptCount} steps | drift ${analysis.currentDrift.toFixed(2)} | ${analysis.driftLabel}`;
  return out;
}

function formatSessions(limit = 10): string {
  const sessions = getSessions(limit);
  if (sessions.length === 0) return "// No sessions recorded yet.";
  const lines = sessions.map((session) => {
    const analysis = analyzeSession(session.id, getReceipts(session.id), session);
    const marker = session.id === current.id ? "*" : " ";
    return `${marker} ${session.id.slice(0, 12)}  score:${String(analysis.score).padStart(5)}  drift:${analysis.currentDrift.toFixed(2)}  receipts:${String(analysis.receiptCount).padStart(3)}  ${session.mission ?? "no mission"}`;
  });
  return `AXIOM Sessions\n${"-".repeat(70)}\n${lines.join("\n")}`;
}

function formatLeaderboard(limit = 10): string {
  const ranked = getSessions(Math.max(limit, 20))
    .map((session) => analyzeSession(session.id, getReceipts(session.id), session))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  if (ranked.length === 0) return "// No sessions recorded yet.";

  const lines = ranked.map((analysis, index) =>
    `${String(index + 1).padStart(2, "0")}. ${analysis.sessionId.slice(0, 12)}  score:${String(analysis.score).padStart(5)}  drift:${analysis.currentDrift.toFixed(2)}  errors:${analysis.errorCount}  ${analysis.mission ?? "no mission"}`,
  );
  return `AXIOM Leaderboard\n${"-".repeat(72)}\n${lines.join("\n")}`;
}

export const TOOL_DEFS = [
  {
    name: "axiom_log",
    description: "Record a reasoning step or decision to the AXIOM ledger. Auto-tags the step, hashes it, stores it, and updates drift.",
    inputSchema: {
      type: "object",
      properties: {
        decision: { type: "string" },
        tool: { type: "string" },
        context: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["decision"],
    },
  },
  {
    name: "axiom_receipts",
    description: "Retrieve reasoning receipts from the current session, optionally filtered by drift.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        min_drift: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "axiom_drift",
    description: "Get the current drift score and tool usage breakdown for the active session.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "axiom_clear",
    description: "End the current session, persist it, and start a fresh one.",
    inputSchema: {
      type: "object",
      properties: { mission: { type: "string" } },
      required: [],
    },
  },
  {
    name: "axiom_summary",
    description: "Return a JSON health report for a session including score, DNA, fingerprints, and timeline.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: [],
    },
  },
  {
    name: "axiom_search",
    description: "Search across all historical receipts by keyword, tag, tool, session, drift threshold, or date.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        tag: { type: "string" },
        tool: { type: "string" },
        session_id: { type: "string" },
        min_drift: { type: "number" },
        since: { type: "string" },
        limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "axiom_compare",
    description: "Compare two sessions side by side and show which one looks healthier.",
    inputSchema: {
      type: "object",
      properties: {
        session_a: { type: "string" },
        session_b: { type: "string" },
      },
      required: ["session_a", "session_b"],
    },
  },
  {
    name: "axiom_replay",
    description: "Replay a session as a narrative, timeline, or markdown report.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        format: { type: "string", enum: ["narrative", "timeline", "report"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_sessions",
    description: "List recent sessions with health, drift, score, and mission.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
      required: [],
    },
  },
  {
    name: "axiom_export",
    description: "Export a session as JSON, Markdown, HTML, or a compact share card.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        format: { type: "string", enum: ["json", "markdown", "html", "card"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_arena",
    description: "Run an arena comparison between two sessions and return a text, markdown, html, or json scorecard.",
    inputSchema: {
      type: "object",
      properties: {
        session_a: { type: "string" },
        session_b: { type: "string" },
        format: { type: "string", enum: ["text", "markdown", "html", "json"] },
      },
      required: ["session_a", "session_b"],
    },
  },
  {
    name: "axiom_postmortem",
    description: "Generate a postmortem for a session, with either professional or roast tone.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        style: { type: "string", enum: ["professional", "roast"] },
        format: { type: "string", enum: ["text", "markdown", "html", "json"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_visualize",
    description: "Visualize a session as Mermaid or HTML-friendly markdown.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        format: { type: "string", enum: ["mermaid", "markdown"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_fingerprint",
    description: "Show failure fingerprints, agent DNA, and next-step recommendations for a session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        format: { type: "string", enum: ["text", "json"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_leaderboard",
    description: "Rank recent sessions by overall score for demos and benchmarking.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
      required: [],
    },
  },
  {
    name: "axiom_policy",
    description: "Manage persistent control policies that can warn, re-plan, switch tools, summarize, or stop runs.",
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["list", "add", "enable", "disable", "remove"] },
        id: { type: "number" },
        name: { type: "string" },
        scope: { type: "string", enum: ["global", "session"] },
        session_id: { type: "string" },
        condition: { type: "string", enum: ["repeat_tool", "drift", "research_spiral", "retry_storm", "missing_final", "error_streak"] },
        action: { type: "string", enum: ["warn", "replan", "switch_tool", "summarize", "stop"] },
        threshold: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "axiom_guard",
    description: "Evaluate built-in and custom policies against a session and return intervention guidance.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        format: { type: "string", enum: ["text", "json"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_next",
    description: "Recommend the best next move for the current session based on guard logic and session state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        format: { type: "string", enum: ["text", "json"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_branch",
    description: "Propose alternate next branches with predicted outcomes and scores.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        format: { type: "string", enum: ["text", "json"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_learn",
    description: "Learn from recent historical sessions and surface recurring healthy and risky patterns.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        format: { type: "string", enum: ["text", "json"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_gate",
    description: "Preflight-check a proposed next move and allow, warn, or block it based on current guardrails and control state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        tool: { type: "string" },
        intent: { type: "string" },
        enforce: { type: "boolean" },
        format: { type: "string", enum: ["text", "json"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_intervene",
    description: "Persist an intervention state for the session when a run should be watched or blocked.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        mode: { type: "string", enum: ["watch", "block", "auto"] },
        reason: { type: "string" },
        format: { type: "string", enum: ["text", "json"] },
      },
      required: [],
    },
  },
  {
    name: "axiom_resume",
    description: "Resume a watched or blocked session after a re-plan or human review.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        note: { type: "string" },
      },
      required: [],
    },
  },
];

export async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "axiom_log") {
    const { decision, tool, context, tags: manualTags } = args as {
      decision: string;
      tool?: string;
      context?: string;
      tags?: string[];
    };

    const toolHistory = getToolHistory(current.id);
    if (tool) toolHistory.push(tool);
    const drift = calcDrift(toolHistory);
    const inferredTags = autoTag(decision, context);
    const allTags = [...new Set([...(manualTags ?? []), ...inferredTags])];
    const receiptCount = countReceipts(current.id);
    const receipt = {
      id: receiptCount + 1,
      timestamp: new Date().toISOString(),
      decision,
      tool,
      context,
      tags: allTags,
      ctxHash: simHash(`${current.id}${receiptCount}${decision}`),
      outHash: simHash(`${decision}${tool ?? ""}${context ?? ""}`),
      drift,
    };

    insertReceipt(current.id, receipt);
    driftEmit(drift, current.id);
    await maybeFire(driftPayload(current.id, drift, receipt.id, current.mission));
    publishAxiomEvent({
      type: "session_updated",
      sessionId: current.id,
      timestamp: receipt.timestamp,
      mission: current.mission,
      receiptId: receipt.id,
    });

    let out = `Receipt #${receipt.id} logged\n`;
    out += `decision : ${decision}\n`;
    if (tool) out += `tool     : ${tool}\n`;
    if (allTags.length > 0) out += `tags     : ${allTags.join(", ")}\n`;
    out += `ctx_hash : ${receipt.ctxHash}\n`;
    out += `out_hash : ${receipt.outHash}\n`;
    out += `drift    : ${drift.toFixed(2)} - ${driftLabel(drift)}\n`;
    out += `session  : ${current.id}`;
    const bundle = getGuardBundle("current");
    if (bundle.guard.status !== "clear") {
      out += `\n\nguard    : ${bundle.guard.status}`;
      out += `\nnext     : ${bundle.next.title}`;
    }
    if (drift > 0.5) out += `\n\nWarning: drift is high. Consider changing approach.`;
    return out;
  }

  if (name === "axiom_receipts") {
    const { limit, min_drift } = args as { limit?: number; min_drift?: number };
    const receipts = getReceipts(current.id, { limit, minDrift: min_drift });
    if (receipts.length === 0) return "// Ledger is empty.";
    const header = `AXIOM Ledger - ${current.id}\nStarted: ${current.startedAt}${current.mission ? `\nMission: ${current.mission}` : ""}\nShowing ${receipts.length} receipts\n${"-".repeat(60)}\n`;
    return header + receipts.map(fmtReceipt).join("\n\n");
  }

  if (name === "axiom_drift") {
    const toolHistory = getToolHistory(current.id);
    const drift = calcDrift(toolHistory);
    const counts: Record<string, number> = {};
    for (const tool of toolHistory) counts[tool] = (counts[tool] ?? 0) + 1;

    let out = "AXIOM Drift Report\n";
    out += `${"-".repeat(40)}\n`;
    out += `score       : ${drift.toFixed(2)} / 1.00\n`;
    out += `status      : ${driftLabel(drift)}\n`;
    out += `chain depth : ${toolHistory.length}\n`;
    out += `unique tools: ${Object.keys(counts).length}`;
    if (toolHistory.length > 0) {
      out += "\n\ntool usage:\n";
      out += Object.entries(counts)
        .sort((left, right) => right[1] - left[1])
        .map(([tool, count]) => `  ${tool}: ${count}x`)
        .join("\n");
    }
    return out;
  }

  if (name === "axiom_clear") {
    const { mission } = args as { mission?: string };
    const oldId = current.id;
    const oldCount = countReceipts(current.id);
    const drift = calcDrift(getToolHistory(current.id));
    await maybeFire(completePayload(oldId, drift, oldCount, current.mission));
    endSession(oldId);
    initSession(mission);
    publishAxiomEvent({
      type: "session_cleared",
      sessionId: current.id,
      previousSessionId: oldId,
      timestamp: new Date().toISOString(),
      mission,
    });
    let out = `Cleared. Session ${oldId} persisted (${oldCount} receipts).\nNew session: ${current.id}`;
    if (mission) out += `\nMission: ${mission}`;
    return out;
  }

  if (name === "axiom_summary") {
    const { session_id } = args as { session_id?: string };
    return JSON.stringify(summaryPayload(getAnalysis(session_id)), null, 2);
  }

  if (name === "axiom_search") {
    const { keyword, tag, tool, session_id, min_drift, since, limit } = args as {
      keyword?: string;
      tag?: string;
      tool?: string;
      session_id?: string;
      min_drift?: number;
      since?: string;
      limit?: number;
    };
    const resolvedSession = session_id && session_id !== "current" ? resolveSessionRow(session_id).id : session_id === "current" ? current.id : undefined;
    const results = searchReceipts({
      keyword,
      tag,
      tool,
      sessionId: resolvedSession,
      minDrift: min_drift,
      since,
      limit: limit ?? 20,
    });
    if (results.length === 0) return "// No matching receipts found.";
    return `AXIOM Search Results (${results.length} matches)\n${"-".repeat(60)}\n${results
      .map((receipt) => `[session:${receipt.session_id.slice(0, 8)}] ${fmtReceipt(receipt)}`)
      .join("\n\n")}`;
  }

  if (name === "axiom_compare") {
    const { session_a, session_b } = args as { session_a: string; session_b: string };
    return formatComparisonText(getAnalysis(session_a), getAnalysis(session_b));
  }

  if (name === "axiom_replay") {
    const { session_id, format = "narrative" } = args as { session_id?: string; format?: string };
    const analysis = getAnalysis(session_id);
    if (analysis.receiptCount === 0) return "// No receipts found for this session.";
    if (format === "timeline") return formatReplayTimeline(analysis);
    if (format === "report") return renderSessionMarkdown(analysis);
    return formatReplayNarrative(analysis);
  }

  if (name === "axiom_sessions") {
    const { limit = 10 } = args as { limit?: number };
    return formatSessions(limit);
  }

  if (name === "axiom_export") {
    const { session_id, format = "json" } = args as {
      session_id?: string;
      format?: "json" | "markdown" | "html" | "card";
    };
    const analysis = getAnalysis(session_id);
    if (format === "markdown") return renderSessionMarkdown(analysis);
    if (format === "html") return renderSessionHtml(analysis);
    if (format === "card") return renderSessionCard(analysis);
    return JSON.stringify(summaryPayload(analysis), null, 2);
  }

  if (name === "axiom_arena") {
    const { session_a, session_b, format = "text" } = args as {
      session_a: string;
      session_b: string;
      format?: "text" | "markdown" | "html" | "json";
    };
    const comparison = compareAnalyses(getAnalysis(session_a), getAnalysis(session_b));
    if (format === "markdown") return renderArenaMarkdown(comparison);
    if (format === "html") return renderArenaHtml(comparison);
    if (format === "json") return JSON.stringify(comparison, null, 2);
    return formatComparisonText(comparison.sessionA, comparison.sessionB);
  }

  if (name === "axiom_postmortem") {
    const { session_id, style = "professional", format = "text" } = args as {
      session_id?: string;
      style?: "professional" | "roast";
      format?: "text" | "markdown" | "html" | "json";
    };
    const analysis = getAnalysis(session_id);
    if (format === "markdown") return renderPostmortemMarkdown(analysis, style);
    if (format === "html") return renderPostmortemHtml(analysis, style);
    if (format === "json") {
      return JSON.stringify(
        {
          session_id: analysis.sessionId,
          style,
          dna: analysis.dna,
          score: analysis.score,
          fingerprints: analysis.fingerprints,
          suggestions: analysis.suggestions,
          score_reasons: analysis.scoreReasons,
        },
        null,
        2,
      );
    }

    let out = `AXIOM Postmortem - ${analysis.sessionId.slice(0, 12)}\n`;
    out += `${"-".repeat(60)}\n`;
    out += style === "roast"
      ? `This run reached drift ${analysis.currentDrift.toFixed(2)} and spent parts of its life making some adventurous decisions.\n`
      : `Health: ${analysis.health} | drift ${analysis.currentDrift.toFixed(2)} | score ${analysis.score}\n`;
    out += `DNA: ${analysis.dna}\n\n`;
    out += "Fingerprints:\n";
    out += analysis.fingerprints.length > 0
      ? analysis.fingerprints.map((fingerprint) => `- ${fingerprint.title} (${fingerprint.severity}): ${fingerprint.summary}`).join("\n")
      : "- No major fingerprints detected.";
    out += "\n\nWhat to change next:\n";
    out += analysis.suggestions.map((item) => `- ${item}`).join("\n");
    return out;
  }

  if (name === "axiom_visualize") {
    const { session_id, format = "mermaid" } = args as { session_id?: string; format?: "mermaid" | "markdown" };
    const analysis = getAnalysis(session_id);
    if (format === "markdown") return renderSessionMarkdown(analysis);
    return renderMermaid(analysis);
  }

  if (name === "axiom_fingerprint") {
    const { session_id, format = "text" } = args as { session_id?: string; format?: "text" | "json" };
    const analysis = getAnalysis(session_id);
    if (format === "json") {
      return JSON.stringify(
        {
          session_id: analysis.sessionId,
          dna: analysis.dna,
          score: analysis.score,
          fingerprints: analysis.fingerprints,
          suggestions: analysis.suggestions,
        },
        null,
        2,
      );
    }

    let out = `AXIOM Fingerprints - ${analysis.sessionId.slice(0, 12)}\n`;
    out += `${"-".repeat(60)}\n`;
    out += `DNA   : ${analysis.dna}\n`;
    out += `Score : ${analysis.score}\n`;
    out += `Drift : ${analysis.currentDrift.toFixed(2)} (${analysis.driftLabel})\n\n`;
    out += "Patterns:\n";
    out += analysis.fingerprints.length > 0
      ? analysis.fingerprints.map((fingerprint) => `- ${fingerprint.title} (${fingerprint.severity}): ${fingerprint.summary}`).join("\n")
      : "- No major fingerprints detected.";
    out += "\n\nRecommendations:\n";
    out += analysis.suggestions.map((item) => `- ${item}`).join("\n");
    return out;
  }

  if (name === "axiom_leaderboard") {
    const { limit = 10 } = args as { limit?: number };
    return formatLeaderboard(limit);
  }

  if (name === "axiom_policy") {
    const { op = "list", id, name: policyName, scope = "global", session_id, condition, action, threshold } = args as {
      op?: "list" | "add" | "enable" | "disable" | "remove";
      id?: number;
      name?: string;
      scope?: "global" | "session";
      session_id?: string;
      condition?: "repeat_tool" | "drift" | "research_spiral" | "retry_storm" | "missing_final" | "error_streak";
      action?: "warn" | "replan" | "switch_tool" | "summarize" | "stop";
      threshold?: number;
    };

    if (op === "list") {
      const resolved = session_id && session_id !== "current" ? resolveSessionRow(session_id).id : session_id === "current" ? current.id : undefined;
      return formatPolicyList(resolved);
    }

    if (op === "add") {
      if (!policyName || !condition || !action) throw new Error("Policy add requires name, condition, and action.");
      const resolvedSessionId = scope === "session"
        ? session_id === "current" || !session_id
          ? current.id
          : resolveSessionRow(session_id).id
        : undefined;
      const newId = insertPolicy({
        name: policyName,
        scope,
        sessionId: resolvedSessionId,
        condition,
        action,
        threshold,
      });
      return `Policy #${newId} added.\n${formatPolicyList(resolvedSessionId)}`;
    }

    if (!id) throw new Error("Policy operation requires id.");
    const existing = findPolicy(id);
    if (!existing) throw new Error(`Policy not found: ${id}`);

    if (op === "enable") {
      setPolicyEnabled(id, true);
      return `Policy #${id} enabled.`;
    }

    if (op === "disable") {
      setPolicyEnabled(id, false);
      return `Policy #${id} disabled.`;
    }

    if (op === "remove") {
      deletePolicy(id);
      return `Policy #${id} removed.`;
    }
  }

  if (name === "axiom_guard") {
    const { session_id, format = "text" } = args as { session_id?: string; format?: "text" | "json" };
    const bundle = getGuardBundle(session_id);
    if (format === "json") {
      return JSON.stringify(
        {
          session_id: bundle.analysis.sessionId,
          status: bundle.guard.status,
          summary: bundle.guard.summary,
          next_move: bundle.next,
          triggers: bundle.guard.triggers,
        },
        null,
        2,
      );
    }
    return formatGuardText(bundle);
  }

  if (name === "axiom_next") {
    const { session_id, format = "text" } = args as { session_id?: string; format?: "text" | "json" };
    const bundle = getGuardBundle(session_id);
    const branches = branchOptions(bundle.analysis, bundle.next);
    if (format === "json") {
      return JSON.stringify(
        {
          session_id: bundle.analysis.sessionId,
          guard_status: bundle.guard.status,
          next_move: bundle.next,
          top_branches: branches,
        },
        null,
        2,
      );
    }
    return `${formatNextText(bundle)}\n\nTop branches:\n${branches
      .slice(0, 3)
      .map((branch, index) => `${index + 1}. ${branch.title} (${branch.score}) - ${branch.predictedOutcome}`)
      .join("\n")}`;
  }

  if (name === "axiom_branch") {
    const { session_id, format = "text" } = args as { session_id?: string; format?: "text" | "json" };
    const bundle = getGuardBundle(session_id);
    const branches = branchOptions(bundle.analysis, bundle.next);
    if (format === "json") {
      return JSON.stringify(
        {
          session_id: bundle.analysis.sessionId,
          branches,
        },
        null,
        2,
      );
    }
    return `AXIOM Branches - ${bundle.analysis.sessionId.slice(0, 12)}\n${"-".repeat(60)}\n${branches
      .map(
        (branch, index) =>
          `${index + 1}. ${branch.title}\n   score     : ${branch.score}\n   tactic    : ${branch.tactic}\n   rationale : ${branch.rationale}\n   outcome   : ${branch.predictedOutcome}`,
      )
      .join("\n\n")}`;
  }

  if (name === "axiom_learn") {
    const { limit = 30, format = "text" } = args as { limit?: number; format?: "text" | "json" };
    const sessions = getSessions(Math.max(1, Math.min(limit, 100))).map((session) => ({
      session,
      receipts: getReceipts(session.id),
    }));
    const learning = learnFromHistory(sessions);
    if (format === "json") return JSON.stringify(learning, null, 2);
    let out = `AXIOM Learn\n${"-".repeat(60)}\n`;
    out += `sessions          : ${learning.sessionCount}\n`;
    out += `healthy sessions  : ${learning.healthyCount}\n`;
    out += `risky sessions    : ${learning.criticalCount}\n`;
    out += `\nInsights:\n`;
    out += learning.insights.length > 0
      ? learning.insights.map((insight) => `- ${insight.title}: ${insight.summary} (confidence ${insight.confidence.toFixed(2)})`).join("\n")
      : "- Not enough historical data yet.";
    out += `\n\nTop healthy transitions:\n`;
    out += learning.topHealthyTransitions.length > 0
      ? learning.topHealthyTransitions.map((entry) => `- ${entry.transition}: ${entry.count}`).join("\n")
      : "- none";
    out += `\n\nTop risky transitions:\n`;
    out += learning.topRiskyTransitions.length > 0
      ? learning.topRiskyTransitions.map((entry) => `- ${entry.transition}: ${entry.count}`).join("\n")
      : "- none";
    return out;
  }

  if (name === "axiom_gate") {
    const { session_id, tool, intent, enforce = true, format = "text" } = args as {
      session_id?: string;
      tool?: string;
      intent?: string;
      enforce?: boolean;
      format?: "text" | "json";
    };
    const bundle = getGuardBundle(session_id);
    const decision = gateProposedAction(
      bundle.analysis,
      bundle.guard,
      tool,
      intent,
      bundle.control.state,
      bundle.control.reason,
    );

    if (enforce) {
      if (decision.status === "block") {
        setSessionControl(bundle.analysis.sessionId, "blocked", decision.reason);
      } else if (decision.status === "warn") {
        setSessionControl(bundle.analysis.sessionId, "watch", decision.reason);
      }
    }

    if (format === "json") {
      return JSON.stringify(
        {
          ...decision,
          enforced: enforce,
          resulting_control_state: getSessionControl(bundle.analysis.sessionId).state,
        },
        null,
        2,
      );
    }

    return [
      `AXIOM Gate - ${bundle.analysis.sessionId.slice(0, 12)}`,
      `${"-".repeat(60)}`,
      `status     : ${decision.status}`,
      `tool       : ${decision.proposedTool ?? "none"}`,
      `intent     : ${decision.proposedIntent ?? "none"}`,
      `action     : ${decision.requiredAction}`,
      `suggested  : ${decision.suggestedTool ?? "none"}`,
      `reason     : ${decision.reason}`,
      `enforced   : ${enforce ? "yes" : "no"}`,
      `control    : ${getSessionControl(bundle.analysis.sessionId).state}`,
    ].join("\n");
  }

  if (name === "axiom_intervene") {
    const { session_id, mode = "auto", reason, format = "text" } = args as {
      session_id?: string;
      mode?: "watch" | "block" | "auto";
      reason?: string;
      format?: "text" | "json";
    };
    const bundle = getGuardBundle(session_id);
    const targetState =
      mode === "auto"
        ? bundle.guard.status === "stop"
          ? "blocked"
          : "watch"
        : mode === "block"
          ? "blocked"
          : "watch";
    const finalReason = reason ?? bundle.guard.summary ?? bundle.next.rationale;
    setSessionControl(bundle.analysis.sessionId, targetState, finalReason);

    const payload = {
      session_id: bundle.analysis.sessionId,
      control_state: targetState,
      reason: finalReason,
      next_move: bundle.next,
      guard_status: bundle.guard.status,
    };
    if (format === "json") return JSON.stringify(payload, null, 2);
    return [
      `AXIOM Intervene - ${bundle.analysis.sessionId.slice(0, 12)}`,
      `${"-".repeat(60)}`,
      `control : ${targetState}`,
      `guard   : ${bundle.guard.status}`,
      `reason  : ${finalReason}`,
      `next    : ${bundle.next.title}`,
    ].join("\n");
  }

  if (name === "axiom_resume") {
    const { session_id, note } = args as { session_id?: string; note?: string };
    const analysis = getAnalysis(session_id);
    setSessionControl(analysis.sessionId, "active", note ?? "Resumed after re-plan.");
    return `Session ${analysis.sessionId} resumed.\ncontrol : active\nnote    : ${note ?? "Resumed after re-plan."}`;
  }

  return `Unknown tool: ${name}`;
}
