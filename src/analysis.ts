import type { ReceiptRow, SessionRow } from "./db.js";
import { calcDrift, driftLabel } from "./tags.js";

export interface Fingerprint {
  key: string;
  title: string;
  severity: "low" | "medium" | "high";
  summary: string;
}

export interface SessionAnalysis {
  sessionId: string;
  mission: string | null;
  startedAt: string | null;
  endedAt: string | null;
  receipts: ReceiptRow[];
  receiptCount: number;
  chainDepth: number;
  uniqueTools: number;
  toolHistory: string[];
  toolUsage: Record<string, number>;
  tagUsage: Record<string, number>;
  currentDrift: number;
  peakDrift: number;
  avgDrift: number;
  health: "HEALTHY" | "DEGRADED" | "CRITICAL";
  driftLabel: string;
  errorCount: number;
  retryCount: number;
  finalCount: number;
  writeCount: number;
  searchCount: number;
  readCount: number;
  codeCount: number;
  recoveries: number;
  longestRepeatRun: number;
  dna: string;
  fingerprints: Fingerprint[];
  suggestions: string[];
  score: number;
  scoreReasons: string[];
}

export interface ArenaComparison {
  sessionA: SessionAnalysis;
  sessionB: SessionAnalysis;
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | "TIE";
  winnerSessionId: string | null;
  reasons: string[];
  summary: string;
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

function healthFromDrift(drift: number): "HEALTHY" | "DEGRADED" | "CRITICAL" {
  if (drift < 0.2) return "HEALTHY";
  if (drift < 0.5) return "DEGRADED";
  return "CRITICAL";
}

function longestRepeatRun(toolHistory: string[]): number {
  if (toolHistory.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < toolHistory.length; i++) {
    if (toolHistory[i] === toolHistory[i - 1]) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

function buildDna(tagUsage: Record<string, number>, drift: number, recoveries: number, uniqueTools: number, chainDepth: number): string {
  const role =
    (tagUsage.write ?? 0) + (tagUsage.code ?? 0) > (tagUsage.search ?? 0) + (tagUsage.read ?? 0)
      ? "builder"
      : (tagUsage.search ?? 0) + (tagUsage.read ?? 0) >= 3
        ? "explorer"
        : "operator";

  const stability = drift > 0.5 ? "loopy" : drift > 0.25 ? "wobbly" : "steady";
  const resilience = recoveries > 0 ? "self-recovering" : (tagUsage.error ?? 0) > 0 ? "brittle" : "clean";
  const range = uniqueTools >= 5 ? "broad-tooling" : chainDepth >= 5 ? "focused-tooling" : "light-touch";
  return [stability, resilience, role, range].join(", ");
}

function addFingerprint(list: Fingerprint[], key: string, title: string, severity: Fingerprint["severity"], summary: string): void {
  list.push({ key, title, severity, summary });
}

export function analyzeSession(sessionId: string, receipts: ReceiptRow[], session?: SessionRow | null): SessionAnalysis {
  const toolHistory = receipts.filter((r) => r.tool).map((r) => r.tool as string);
  const toolUsage: Record<string, number> = {};
  const tagUsage: Record<string, number> = {};

  for (const tool of toolHistory) {
    toolUsage[tool] = (toolUsage[tool] ?? 0) + 1;
  }

  for (const receipt of receipts) {
    for (const tag of parseTags(receipt.tags)) {
      tagUsage[tag] = (tagUsage[tag] ?? 0) + 1;
    }
  }

  const drifts = receipts.map((receipt) => receipt.drift);
  const currentDrift = calcDrift(toolHistory);
  const peakDrift = drifts.length > 0 ? Math.max(...drifts) : 0;
  const avgDrift = drifts.length > 0 ? drifts.reduce((sum, value) => sum + value, 0) / drifts.length : 0;
  const recoveries = receipts.reduce((count, receipt, index) => {
    if (index === 0) return count;
    const previousTags = parseTags(receipts[index - 1].tags);
    const currentTags = parseTags(receipt.tags);
    if (previousTags.includes("error") && !currentTags.includes("error")) return count + 1;
    return count;
  }, 0);

  const fingerprints: Fingerprint[] = [];
  const repeatRun = longestRepeatRun(toolHistory);
  const errorCount = tagUsage.error ?? 0;
  const retryCount = tagUsage.retry ?? 0;
  const finalCount = tagUsage.final ?? 0;
  const writeCount = tagUsage.write ?? 0;
  const searchCount = tagUsage.search ?? 0;
  const readCount = tagUsage.read ?? 0;
  const codeCount = tagUsage.code ?? 0;

  if (repeatRun >= 3) {
    addFingerprint(
      fingerprints,
      "tool-loop",
      "Tool loop",
      repeatRun >= 5 ? "high" : "medium",
      `The same tool was used ${repeatRun} times in a row, which is a strong loop signal.`,
    );
  }

  if (searchCount + readCount >= 4 && writeCount === 0) {
    addFingerprint(
      fingerprints,
      "research-spiral",
      "Research spiral",
      "medium",
      "The session kept gathering context without producing a write or output checkpoint.",
    );
  }

  if (errorCount >= 2 && recoveries === 0) {
    addFingerprint(
      fingerprints,
      "unrecovered-failure",
      "Unrecovered failure",
      "high",
      "Errors accumulated without any clear recovery step afterward.",
    );
  }

  if (retryCount >= 2) {
    addFingerprint(
      fingerprints,
      "retry-storm",
      "Retry storm",
      "medium",
      "The agent retried multiple times, which usually means missing fallback rules or validation.",
    );
  }

  if (toolHistory.length >= 3 && new Set(toolHistory).size === 1) {
    addFingerprint(
      fingerprints,
      "single-tool-obsession",
      "Single-tool obsession",
      "high",
      "The entire chain depended on one tool, making the run brittle and repetitive.",
    );
  }

  if (receipts.length >= 10 && finalCount === 0) {
    addFingerprint(
      fingerprints,
      "no-finish-signal",
      "No finish signal",
      "low",
      "The run is long enough that it should have emitted a final or summary-style step.",
    );
  }

  if (recoveries > 0) {
    addFingerprint(
      fingerprints,
      "recovered",
      "Recovered after failure",
      "low",
      `The agent recovered from at least ${recoveries} error transition${recoveries === 1 ? "" : "s"}.`,
    );
  }

  const suggestions: string[] = [];
  if (repeatRun >= 3) suggestions.push("Add a stop rule that forces a different tool or a written summary after 2 repeated calls.");
  if (searchCount + readCount >= 4 && writeCount === 0) suggestions.push("Insert a mandatory synthesis step so the agent must produce a concrete output before gathering more context.");
  if (errorCount >= 2 && recoveries === 0) suggestions.push("Require validation after each failing step and define a fallback branch instead of retrying the same path.");
  if (retryCount >= 2) suggestions.push("Cap retries per tool and force a re-plan when the retry budget is exhausted.");
  if (finalCount === 0 && receipts.length >= 10) suggestions.push("Add an explicit finalization checkpoint every 5-7 steps so long sessions terminate cleanly.");
  if (suggestions.length === 0) suggestions.push("This session is fairly healthy; focus on polishing outputs and shortening the path to completion.");

  const dna = buildDna(tagUsage, currentDrift, recoveries, Object.keys(toolUsage).length, toolHistory.length);
  const health = healthFromDrift(currentDrift);

  let score = 100;
  const scoreReasons: string[] = [];

  score -= currentDrift * 40;
  scoreReasons.push(`-${(currentDrift * 40).toFixed(1)} for current drift`);

  score -= peakDrift * 20;
  scoreReasons.push(`-${(peakDrift * 20).toFixed(1)} for peak drift`);

  score -= Math.max(0, receipts.length - 8) * 1.5;
  if (receipts.length > 8) scoreReasons.push(`-${((receipts.length - 8) * 1.5).toFixed(1)} for long path length`);

  score -= errorCount * 6;
  if (errorCount > 0) scoreReasons.push(`-${(errorCount * 6).toFixed(1)} for error-tagged steps`);

  score -= retryCount * 4;
  if (retryCount > 0) scoreReasons.push(`-${(retryCount * 4).toFixed(1)} for retries`);

  score += Object.keys(toolUsage).length * 2;
  if (Object.keys(toolUsage).length > 0) scoreReasons.push(`+${(Object.keys(toolUsage).length * 2).toFixed(1)} for tool breadth`);

  score += recoveries * 4;
  if (recoveries > 0) scoreReasons.push(`+${(recoveries * 4).toFixed(1)} for recoveries`);

  if (finalCount > 0) {
    score += 5;
    scoreReasons.push("+5.0 for explicit finalization");
  }

  if (writeCount > 0) {
    score += 3;
    scoreReasons.push("+3.0 for producing output");
  }

  score = Math.max(0, Math.min(100, Number(score.toFixed(1))));

  return {
    sessionId,
    mission: session?.mission ?? null,
    startedAt: session?.started_at ?? null,
    endedAt: session?.ended_at ?? null,
    receipts,
    receiptCount: receipts.length,
    chainDepth: toolHistory.length,
    uniqueTools: Object.keys(toolUsage).length,
    toolHistory,
    toolUsage,
    tagUsage,
    currentDrift: Number(currentDrift.toFixed(2)),
    peakDrift: Number(peakDrift.toFixed(2)),
    avgDrift: Number(avgDrift.toFixed(2)),
    health,
    driftLabel: driftLabel(currentDrift),
    errorCount,
    retryCount,
    finalCount,
    writeCount,
    searchCount,
    readCount,
    codeCount,
    recoveries,
    longestRepeatRun: repeatRun,
    dna,
    fingerprints,
    suggestions,
    score,
    scoreReasons,
  };
}

export function compareAnalyses(sessionA: SessionAnalysis, sessionB: SessionAnalysis): ArenaComparison {
  let winner: "A" | "B" | "TIE" = "TIE";
  if (Math.abs(sessionA.score - sessionB.score) > 2) {
    winner = sessionA.score > sessionB.score ? "A" : "B";
  }

  const reasons: string[] = [];
  if (sessionA.currentDrift !== sessionB.currentDrift) {
    reasons.push(
      `${sessionA.currentDrift < sessionB.currentDrift ? "A" : "B"} kept lower drift (${sessionA.currentDrift.toFixed(2)} vs ${sessionB.currentDrift.toFixed(2)}).`,
    );
  }
  if (sessionA.errorCount !== sessionB.errorCount) {
    reasons.push(
      `${sessionA.errorCount < sessionB.errorCount ? "A" : "B"} hit fewer errors (${sessionA.errorCount} vs ${sessionB.errorCount}).`,
    );
  }
  if (sessionA.receiptCount !== sessionB.receiptCount) {
    reasons.push(
      `${sessionA.receiptCount < sessionB.receiptCount ? "A" : "B"} reached a result with fewer steps (${sessionA.receiptCount} vs ${sessionB.receiptCount}).`,
    );
  }
  if (sessionA.recoveries !== sessionB.recoveries) {
    reasons.push(
      `${sessionA.recoveries > sessionB.recoveries ? "A" : "B"} showed better recovery after failure (${sessionA.recoveries} vs ${sessionB.recoveries}).`,
    );
  }

  let summary = "Both sessions performed similarly.";
  if (winner === "A") summary = `Session A wins with a stronger overall score (${sessionA.score} vs ${sessionB.score}).`;
  if (winner === "B") summary = `Session B wins with a stronger overall score (${sessionB.score} vs ${sessionA.score}).`;

  return {
    sessionA,
    sessionB,
    scoreA: sessionA.score,
    scoreB: sessionB.score,
    winner,
    winnerSessionId: winner === "A" ? sessionA.sessionId : winner === "B" ? sessionB.sessionId : null,
    reasons,
    summary,
  };
}
