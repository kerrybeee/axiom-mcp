import type { PolicyRow, ReceiptRow, SessionRow } from "./db.js";
import { analyzeSession, type Fingerprint, type SessionAnalysis } from "./analysis.js";

export type PolicyCondition =
  | "repeat_tool"
  | "drift"
  | "research_spiral"
  | "retry_storm"
  | "missing_final"
  | "error_streak";

export type PolicyAction =
  | "warn"
  | "replan"
  | "switch_tool"
  | "summarize"
  | "stop";

export interface GuardTrigger {
  policyId: number | null;
  source: "builtin" | "custom";
  name: string;
  condition: PolicyCondition;
  action: PolicyAction;
  severity: "low" | "medium" | "high";
  triggered: boolean;
  threshold: number | null;
  reason: string;
  recommendation: string;
}

export interface GuardReport {
  sessionId: string;
  status: "clear" | "watch" | "intervene" | "stop";
  triggers: GuardTrigger[];
  summary: string;
}

export interface NextMove {
  title: string;
  action: PolicyAction | "validate" | "continue";
  rationale: string;
  recommendedTool: string | null;
  confidence: number;
}

export interface BranchOption {
  title: string;
  tactic: string;
  rationale: string;
  predictedOutcome: string;
  score: number;
}

export interface LearningInsight {
  title: string;
  summary: string;
  confidence: number;
}

export interface LearningReport {
  sessionCount: number;
  healthyCount: number;
  criticalCount: number;
  topHealthyTransitions: Array<{ transition: string; count: number }>;
  topRiskyTransitions: Array<{ transition: string; count: number }>;
  commonFingerprints: Array<{ key: string; title: string; count: number }>;
  insights: LearningInsight[];
}

export interface GateDecision {
  sessionId: string;
  status: "allow" | "warn" | "block";
  proposedTool: string | null;
  proposedIntent: string | null;
  reason: string;
  requiredAction: PolicyAction | "resume" | "continue" | "validate";
  suggestedTool: string | null;
}

interface PolicyTemplate {
  name: string;
  condition: PolicyCondition;
  action: PolicyAction;
  threshold: number | null;
}

const BUILTIN_POLICIES: PolicyTemplate[] = [
  { name: "Break repeated tool loops", condition: "repeat_tool", action: "switch_tool", threshold: 3 },
  { name: "Intervene on high drift", condition: "drift", action: "replan", threshold: 0.45 },
  { name: "Force synthesis after over-research", condition: "research_spiral", action: "summarize", threshold: 4 },
  { name: "Cap retry storms", condition: "retry_storm", action: "replan", threshold: 2 },
  { name: "Stop long runs with no finish signal", condition: "missing_final", action: "stop", threshold: 10 },
  { name: "Escalate unresolved failures", condition: "error_streak", action: "stop", threshold: 2 },
];

function lastTags(receipts: ReceiptRow[], count = 2): string[] {
  return receipts
    .slice(-count)
    .flatMap((receipt) => {
      if (!receipt.tags) return [];
      try {
        const parsed = JSON.parse(receipt.tags);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    });
}

function evaluateCondition(
  analysis: SessionAnalysis,
  condition: PolicyCondition,
  threshold: number | null,
): { triggered: boolean; severity: GuardTrigger["severity"]; reason: string; recommendation: string } {
  switch (condition) {
    case "repeat_tool": {
      const limit = threshold ?? 3;
      const triggered = analysis.longestRepeatRun >= limit;
      return {
        triggered,
        severity: analysis.longestRepeatRun >= limit + 2 ? "high" : "medium",
        reason: `The longest repeated-tool streak is ${analysis.longestRepeatRun}, against a limit of ${limit}.`,
        recommendation: "Switch to a different tool or insert a synthesis step before continuing.",
      };
    }
    case "drift": {
      const limit = threshold ?? 0.45;
      const triggered = analysis.currentDrift >= limit;
      return {
        triggered,
        severity: analysis.currentDrift >= 0.65 ? "high" : analysis.currentDrift >= limit ? "medium" : "low",
        reason: `Current drift is ${analysis.currentDrift.toFixed(2)}, against a limit of ${limit.toFixed(2)}.`,
        recommendation: "Re-plan from the current state and choose a materially different path.",
      };
    }
    case "research_spiral": {
      const limit = threshold ?? 4;
      const researchDepth = analysis.searchCount + analysis.readCount;
      const triggered = researchDepth >= limit && analysis.writeCount === 0;
      return {
        triggered,
        severity: researchDepth >= limit + 2 ? "high" : "medium",
        reason: `The session has ${researchDepth} search/read steps and no write checkpoint.`,
        recommendation: "Summarize what is already known and produce a concrete output before gathering more context.",
      };
    }
    case "retry_storm": {
      const limit = threshold ?? 2;
      const triggered = analysis.retryCount >= limit;
      return {
        triggered,
        severity: analysis.retryCount >= limit + 1 ? "high" : "medium",
        reason: `Retry count is ${analysis.retryCount}, against a limit of ${limit}.`,
        recommendation: "Stop retrying the same tactic. Validate assumptions and pick a fallback path.",
      };
    }
    case "missing_final": {
      const limit = threshold ?? 10;
      const triggered = analysis.receiptCount >= limit && analysis.finalCount === 0;
      return {
        triggered,
        severity: triggered ? "medium" : "low",
        reason: `The run has ${analysis.receiptCount} receipts and ${analysis.finalCount} final-style steps.`,
        recommendation: "Either finalize now or explicitly checkpoint why more work is still required.",
      };
    }
    case "error_streak": {
      const limit = threshold ?? 2;
      const recentErrors = lastTags(analysis.receipts, limit).filter((tag) => tag === "error").length;
      const triggered = recentErrors >= limit && analysis.recoveries === 0;
      return {
        triggered,
        severity: triggered ? "high" : "low",
        reason: `Recent error-tagged steps counted ${recentErrors} against a limit of ${limit}.`,
        recommendation: "Pause the run, explain the failure clearly, and escalate or re-plan before any more tool calls.",
      };
    }
  }
}

function actionSeverity(action: PolicyAction): GuardReport["status"] {
  if (action === "stop") return "stop";
  if (action === "replan" || action === "switch_tool" || action === "summarize") return "intervene";
  return "watch";
}

function builtInTriggers(analysis: SessionAnalysis): GuardTrigger[] {
  return BUILTIN_POLICIES.map((policy) => {
    const result = evaluateCondition(analysis, policy.condition, policy.threshold);
    return {
      policyId: null,
      source: "builtin",
      name: policy.name,
      condition: policy.condition,
      action: policy.action,
      severity: result.severity,
      triggered: result.triggered,
      threshold: policy.threshold,
      reason: result.reason,
      recommendation: result.recommendation,
    };
  });
}

export function evaluateGuard(analysis: SessionAnalysis, customPolicies: PolicyRow[] = []): GuardReport {
  const triggers: GuardTrigger[] = [
    ...builtInTriggers(analysis),
    ...customPolicies.map((policy) => {
      const result = evaluateCondition(analysis, policy.condition as PolicyCondition, policy.threshold);
      return {
        policyId: policy.id,
        source: "custom" as const,
        name: policy.name,
        condition: policy.condition as PolicyCondition,
        action: policy.action as PolicyAction,
        severity: result.severity,
        triggered: result.triggered,
        threshold: policy.threshold,
        reason: result.reason,
        recommendation: result.recommendation,
      };
    }),
  ];

  const active = triggers.filter((trigger) => trigger.triggered);
  let status: GuardReport["status"] = "clear";
  for (const trigger of active) {
    const candidate = actionSeverity(trigger.action);
    if (candidate === "stop") {
      status = "stop";
      break;
    }
    if (candidate === "intervene") {
      status = "intervene";
    } else if (candidate === "watch" && status === "clear") {
      status = "watch";
    }
  }

  let summary = "No intervention needed.";
  if (status === "watch") summary = "The run is still viable, but at least one policy is warning about emerging risk.";
  if (status === "intervene") summary = "The run should change course now; at least one guard recommends a different tactic.";
  if (status === "stop") summary = "The run should stop and re-plan before any more tool calls.";

  return { sessionId: analysis.sessionId, status, triggers, summary };
}

export function recommendNextMove(analysis: SessionAnalysis, guard: GuardReport): NextMove {
  const active = guard.triggers.filter((trigger) => trigger.triggered);
  const top = active[0];
  if (guard.status === "stop" && top) {
    return {
      title: "Pause and re-plan",
      action: "stop",
      rationale: top.recommendation,
      recommendedTool: null,
      confidence: 0.9,
    };
  }

  if (guard.status === "intervene") {
    const switchLoop = active.find((trigger) => trigger.action === "switch_tool");
    if (switchLoop) {
      const repeatedTool = analysis.toolHistory.at(-1) ?? null;
      return {
        title: "Break the loop with a contrasting move",
        action: "switch_tool",
        rationale: switchLoop.recommendation,
        recommendedTool: repeatedTool === "search" || repeatedTool === "web" ? "editor" : "summarizer",
        confidence: 0.82,
      };
    }

    const summarize = active.find((trigger) => trigger.action === "summarize");
    if (summarize) {
      return {
        title: "Synthesize before more context gathering",
        action: "summarize",
        rationale: summarize.recommendation,
        recommendedTool: "report",
        confidence: 0.84,
      };
    }

    return {
      title: "Re-plan from the current state",
      action: "replan",
      rationale: active[0]?.recommendation ?? "The run needs a cleaner path to completion.",
      recommendedTool: null,
      confidence: 0.78,
    };
  }

  if (analysis.receiptCount === 0) {
    return {
      title: "Create a concrete execution plan",
      action: "continue",
      rationale: "The session has not started yet; define the first high-value action before calling tools.",
      recommendedTool: "planner",
      confidence: 0.72,
    };
  }

  if (analysis.writeCount > 0 && analysis.finalCount === 0 && analysis.receiptCount >= 3) {
    return {
      title: "Validate and finalize",
      action: "validate",
      rationale: "The run has produced output. The fastest safe next step is checking it and closing cleanly.",
      recommendedTool: "validator",
      confidence: 0.74,
    };
  }

  if (analysis.errorCount > 0 && analysis.recoveries === 0) {
    return {
      title: "Inspect the last failure before moving",
      action: "replan",
      rationale: "There is at least one error without a recovery. Continuing blindly is likely to waste more steps.",
      recommendedTool: "debugger",
      confidence: 0.76,
    };
  }

  return {
    title: "Continue with the current plan, but checkpoint after the next step",
    action: "continue",
    rationale: "The run is currently healthy. Preserve momentum, but log a checkpoint after the next meaningful action.",
    recommendedTool: null,
    confidence: 0.68,
  };
}

export function gateProposedAction(
  analysis: SessionAnalysis,
  guard: GuardReport,
  proposedTool?: string,
  proposedIntent?: string,
  controlState: "active" | "watch" | "blocked" = "active",
  controlReason?: string | null,
): GateDecision {
  if (controlState === "blocked") {
    return {
      sessionId: analysis.sessionId,
      status: "block",
      proposedTool: proposedTool ?? null,
      proposedIntent: proposedIntent ?? null,
      reason: controlReason ?? "The session is currently blocked and must be resumed explicitly.",
      requiredAction: "resume",
      suggestedTool: null,
    };
  }

  const next = recommendNextMove(analysis, guard);
  const lastTool = analysis.toolHistory.at(-1) ?? null;
  const activeTriggers = guard.triggers.filter((trigger) => trigger.triggered);
  const repeatedToolBlocked = activeTriggers.some((trigger) => trigger.condition === "repeat_tool");
  const researchBlocked = activeTriggers.some((trigger) => trigger.condition === "research_spiral");

  if (guard.status === "stop") {
    return {
      sessionId: analysis.sessionId,
      status: "block",
      proposedTool: proposedTool ?? null,
      proposedIntent: proposedIntent ?? null,
      reason: activeTriggers[0]?.recommendation ?? "The run should stop and re-plan before proceeding.",
      requiredAction: "stop",
      suggestedTool: null,
    };
  }

  if (repeatedToolBlocked && proposedTool && lastTool && proposedTool === lastTool) {
    return {
      sessionId: analysis.sessionId,
      status: "block",
      proposedTool,
      proposedIntent: proposedIntent ?? null,
      reason: `The last tool was ${lastTool} and the current guard wants a different move.`,
      requiredAction: "switch_tool",
      suggestedTool: next.recommendedTool,
    };
  }

  if (researchBlocked && proposedTool && /search|read|web|fetch/i.test(proposedTool)) {
    return {
      sessionId: analysis.sessionId,
      status: "block",
      proposedTool,
      proposedIntent: proposedIntent ?? null,
      reason: "AXIOM detected over-research without synthesis, so more context gathering is blocked for now.",
      requiredAction: "summarize",
      suggestedTool: next.recommendedTool ?? "report",
    };
  }

  if (guard.status === "intervene") {
    return {
      sessionId: analysis.sessionId,
      status: "warn",
      proposedTool: proposedTool ?? null,
      proposedIntent: proposedIntent ?? null,
      reason: activeTriggers[0]?.recommendation ?? "Proceed only if you intentionally accept the current risk.",
      requiredAction: next.action,
      suggestedTool: next.recommendedTool,
    };
  }

  return {
    sessionId: analysis.sessionId,
    status: controlState === "watch" ? "warn" : "allow",
    proposedTool: proposedTool ?? null,
    proposedIntent: proposedIntent ?? null,
    reason: controlState === "watch"
      ? controlReason ?? "The session is in watch mode; continue carefully and checkpoint soon."
      : "No active guardrail is blocking this move.",
    requiredAction: "continue",
    suggestedTool: null,
  };
}

export function branchOptions(analysis: SessionAnalysis, next: NextMove): BranchOption[] {
  const options: BranchOption[] = [];

  options.push({
    title: "Synthesize and checkpoint",
    tactic: "Convert the current state into a concise written summary before any further exploration.",
    rationale: "This reduces ambiguity and exposes whether the run already has enough information.",
    predictedOutcome: analysis.writeCount === 0 ? "Likely to improve clarity and lower future drift." : "Likely to speed up validation and finishing.",
    score: Math.max(60, 86 - analysis.currentDrift * 20),
  });

  options.push({
    title: "Try a contrasting tool path",
    tactic: `Use a different tool family than the recent dominant path${analysis.toolHistory.at(-1) ? ` instead of ${analysis.toolHistory.at(-1)}` : ""}.`,
    rationale: "Changing the modality is the quickest way to break repetition and test a new hypothesis.",
    predictedOutcome: analysis.longestRepeatRun >= 2 ? "Good chance of escaping a loop." : "Useful if the current path feels stale.",
    score: Math.max(55, 80 - analysis.errorCount * 4 + analysis.uniqueTools * 2),
  });

  options.push({
    title: next.title,
    tactic: next.rationale,
    rationale: "This is the current best single-step move from AXIOM's guard and scoring layer.",
    predictedOutcome: guardOutcomeLabel(next.action),
    score: Math.round(70 + next.confidence * 20),
  });

  return options.sort((left, right) => right.score - left.score);
}

function guardOutcomeLabel(action: NextMove["action"]): string {
  switch (action) {
    case "stop":
      return "Protects the run from further wasted steps and forces a cleaner restart.";
    case "replan":
      return "Should improve the chance of a successful recovery.";
    case "switch_tool":
      return "Should reduce repetition by changing the execution surface.";
    case "summarize":
      return "Should compress context into something actionable.";
    case "validate":
      return "Should convert current work into a trustworthy finish.";
    default:
      return "Keeps momentum while preserving optionality.";
  }
}

function countTransitions(analyses: SessionAnalysis[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const analysis of analyses) {
    for (let i = 1; i < analysis.toolHistory.length; i++) {
      const transition = `${analysis.toolHistory[i - 1]} -> ${analysis.toolHistory[i]}`;
      counts.set(transition, (counts.get(transition) ?? 0) + 1);
    }
  }
  return counts;
}

function topEntries(map: Map<string, number>, limit = 5): Array<{ transition: string; count: number }> {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([transition, count]) => ({ transition, count }));
}

function fingerprintCounts(analyses: SessionAnalysis[]): Array<{ key: string; title: string; count: number }> {
  const counts = new Map<string, { title: string; count: number }>();
  for (const analysis of analyses) {
    for (const fingerprint of analysis.fingerprints) {
      const current = counts.get(fingerprint.key) ?? { title: fingerprint.title, count: 0 };
      current.count += 1;
      counts.set(fingerprint.key, current);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 6)
    .map(([key, value]) => ({ key, title: value.title, count: value.count }));
}

export function learnFromHistory(sessions: Array<{ session: SessionRow; receipts: ReceiptRow[] }>): LearningReport {
  const analyses = sessions.map(({ session, receipts }) => analyzeSession(session.id, receipts, session));
  const healthy = analyses.filter((analysis) => analysis.health === "HEALTHY" && analysis.score >= 85);
  const critical = analyses.filter((analysis) => analysis.health === "CRITICAL" || analysis.currentDrift >= 0.45);

  const healthyTransitions = topEntries(countTransitions(healthy));
  const riskyTransitions = topEntries(countTransitions(critical));
  const commonFingerprints = fingerprintCounts(analyses);

  const insights: LearningInsight[] = [];
  if (healthyTransitions.length > 0) {
    insights.push({
      title: "Healthy runs show repeatable tool choreography",
      summary: `The strongest healthy transition is ${healthyTransitions[0].transition} (${healthyTransitions[0].count} times).`,
      confidence: 0.67,
    });
  }
  if (riskyTransitions.length > 0) {
    insights.push({
      title: "Risky runs have recognizable failure motion",
      summary: `The most common risky transition is ${riskyTransitions[0].transition} (${riskyTransitions[0].count} times).`,
      confidence: 0.69,
    });
  }
  if (commonFingerprints.length > 0) {
    insights.push({
      title: "One failure fingerprint keeps recurring",
      summary: `${commonFingerprints[0].title} appeared ${commonFingerprints[0].count} times across the sampled sessions.`,
      confidence: 0.72,
    });
  }
  if (healthy.length > 0 && critical.length > 0) {
    insights.push({
      title: "Good and bad runs now separate cleanly",
      summary: `AXIOM can compare ${healthy.length} healthy sessions against ${critical.length} risky ones for future guidance.`,
      confidence: 0.61,
    });
  }

  return {
    sessionCount: analyses.length,
    healthyCount: healthy.length,
    criticalCount: critical.length,
    topHealthyTransitions: healthyTransitions,
    topRiskyTransitions: riskyTransitions,
    commonFingerprints,
    insights,
  };
}
