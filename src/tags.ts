/**
 * AXIOM — Auto-tagging engine
 * Infers semantic tags from decision text without any external model.
 */

interface TagRule { tag: string; patterns: RegExp[] }

const RULES: TagRule[] = [
  { tag: "search",      patterns: [/search|lookup|find|query|google|web|research/i] },
  { tag: "read",        patterns: [/read|fetch|scrape|load|open|visit|navigate/i] },
  { tag: "write",       patterns: [/write|save|store|persist|output|export|create file/i] },
  { tag: "hypothesis",  patterns: [/think|believe|assume|hypothes|probably|likely|suspect/i] },
  { tag: "plan",        patterns: [/plan|strategy|approach|going to|will|step \d|first i|next i/i] },
  { tag: "error",       patterns: [/error|fail|exception|crash|invalid|broken|unexpected/i] },
  { tag: "retry",       patterns: [/retry|again|repeat|another attempt|try again/i] },
  { tag: "final",       patterns: [/final|done|complete|finish|summary|conclude|result/i] },
  { tag: "decision",    patterns: [/decided|chose|selected|picked|going with|will use/i] },
  { tag: "analysis",    patterns: [/analys|evaluat|assess|review|examin|inspect/i] },
  { tag: "code",        patterns: [/execut|run|code|script|function|class|import|compile/i] },
  { tag: "email",       patterns: [/email|send|message|notify|contact|mail/i] },
  { tag: "looping",     patterns: [/again|repeat|same as|already did|tried this/i] },
  { tag: "start",       patterns: [/start|begin|initializ|kick off|launch|deploy/i] },
];

export function autoTag(decision: string, context?: string): string[] {
  const text = `${decision} ${context ?? ""}`.toLowerCase();
  const tags: string[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some(p => p.test(text))) tags.push(rule.tag);
  }
  return [...new Set(tags)];
}

// ── Drift helpers ─────────────────────────────────────────────────────────────

export function calcDrift(toolHistory: string[]): number {
  if (toolHistory.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < toolHistory.length; i++) {
    if (toolHistory[i] === toolHistory[i - 1]) d += 0.35;
  }
  const unique = new Set(toolHistory).size;
  if (unique === 1 && toolHistory.length > 2) d += 0.2;
  return Math.min(parseFloat((d / toolHistory.length).toFixed(2)), 1.0);
}

export function driftLabel(drift: number): string {
  if (drift > 0.6) return "CRITICAL — agent is looping";
  if (drift > 0.4) return "HIGH — repetitive pattern detected";
  if (drift > 0.2) return "MODERATE — mild repetition";
  return "LOW — reasoning is on track";
}

export function driftEmit(drift: number, sessionId: string): void {
  if (drift > 0.6) process.stderr.write(`\n[AXIOM] 🔴 DRIFT CRITICAL (${drift.toFixed(2)}) session=${sessionId} — agent is looping\n`);
  else if (drift > 0.4) process.stderr.write(`\n[AXIOM] ⚠  DRIFT HIGH (${drift.toFixed(2)}) session=${sessionId}\n`);
}

export function simHash(input: string): string {
  let h = 0;
  const s = input.slice(0, 200);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16).padStart(8, "0").slice(0, 8);
}
