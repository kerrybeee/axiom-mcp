import type { ArenaComparison, SessionAnalysis } from "./analysis.js";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortId(value: string): string {
  return value.slice(0, 12);
}

function badgeTone(health: SessionAnalysis["health"]): string {
  if (health === "HEALTHY") return "good";
  if (health === "DEGRADED") return "warn";
  return "bad";
}

function renderUsageBars(data: Record<string, number>): string {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return entries
    .map(([label, count]) => {
      const width = Math.max(8, Math.round((count / max) * 100));
      return `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar"><i style="width:${width}%"></i></div><strong>${count}</strong></div>`;
    })
    .join("");
}

function renderFingerprintList(analysis: SessionAnalysis): string {
  if (analysis.fingerprints.length === 0) return "<p>No major fingerprints detected.</p>";
  return `<ul>${analysis.fingerprints
    .map(
      (fingerprint) =>
        `<li><strong>${escapeHtml(fingerprint.title)}</strong> (${fingerprint.severity}): ${escapeHtml(fingerprint.summary)}</li>`,
    )
    .join("")}</ul>`;
}

function renderSuggestionList(analysis: SessionAnalysis): string {
  return `<ul>${analysis.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderTimelineRows(analysis: SessionAnalysis): string {
  return analysis.receipts
    .map((receipt) => {
      const label = receipt.tool ? `${receipt.decision} [${receipt.tool}]` : receipt.decision;
      return `<tr><td>${receipt.id}</td><td>${escapeHtml(receipt.timestamp.slice(11, 19))}</td><td>${escapeHtml(label)}</td><td>${receipt.drift.toFixed(2)}</td></tr>`;
    })
    .join("");
}

export function renderSessionMarkdown(analysis: SessionAnalysis): string {
  const toolUsage = Object.entries(analysis.toolUsage)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => `- ${tool}: ${count}`)
    .join("\n") || "- none";

  const fingerprints = analysis.fingerprints
    .map((fingerprint) => `- ${fingerprint.title} (${fingerprint.severity}): ${fingerprint.summary}`)
    .join("\n") || "- none";

  const suggestions = analysis.suggestions.map((item) => `- ${item}`).join("\n");
  const timeline = analysis.receipts
    .map((receipt) => `- ${receipt.timestamp.slice(11, 19)} | step ${receipt.id} | drift ${receipt.drift.toFixed(2)} | ${receipt.decision}`)
    .join("\n");

  return `# AXIOM Casefile

- Session: \`${shortId(analysis.sessionId)}\`
- Mission: ${analysis.mission ?? "none"}
- Health: ${analysis.health}
- Drift: ${analysis.currentDrift.toFixed(2)} (${analysis.driftLabel})
- Score: ${analysis.score}
- DNA: ${analysis.dna}

## Tool Usage
${toolUsage}

## Fingerprints
${fingerprints}

## Suggestions
${suggestions}

## Timeline
${timeline}`;
}

export function renderSessionHtml(analysis: SessionAnalysis): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AXIOM Casefile ${escapeHtml(shortId(analysis.sessionId))}</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --card: #fffdf8;
      --ink: #1d1c1a;
      --muted: #5a5852;
      --line: #d8d0c0;
      --good: #2d6a4f;
      --warn: #b7791f;
      --bad: #b42318;
      --accent: #0b7285;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: linear-gradient(180deg, #efe4cf, var(--bg)); color: var(--ink); font: 16px/1.5 Georgia, "Times New Roman", serif; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 32px 20px 48px; }
    .hero { background: radial-gradient(circle at top left, #fff9ef, #f4efe4); border: 1px solid var(--line); border-radius: 22px; padding: 28px; box-shadow: 0 18px 45px rgba(0,0,0,0.08); }
    h1, h2 { margin: 0 0 12px; font-family: Georgia, "Times New Roman", serif; }
    .sub { color: var(--muted); margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-top: 20px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: 0 10px 24px rgba(0,0,0,0.05); }
    .kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .metric { font-size: 32px; font-weight: 700; }
    .tone-good { color: var(--good); }
    .tone-warn { color: var(--warn); }
    .tone-bad { color: var(--bad); }
    .section { margin-top: 22px; }
    .bar-row { display: grid; grid-template-columns: 150px 1fr 36px; gap: 10px; align-items: center; margin: 10px 0; }
    .bar { height: 12px; background: #ece3d4; border-radius: 999px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: linear-gradient(90deg, #0b7285, #74c0fc); }
    ul { padding-left: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; border-bottom: 1px solid var(--line); padding: 10px 8px; vertical-align: top; }
    .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; border: 1px solid currentColor; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <p class="kicker">AXIOM Casefile</p>
      <h1>Session ${escapeHtml(shortId(analysis.sessionId))}</h1>
      <p class="sub">${escapeHtml(analysis.mission ?? "No mission set")} | DNA: ${escapeHtml(analysis.dna)}</p>
      <div class="grid">
        <article class="card">
          <div class="kicker">Health</div>
          <div class="metric tone-${badgeTone(analysis.health)}">${escapeHtml(analysis.health)}</div>
          <span class="pill tone-${badgeTone(analysis.health)}">${escapeHtml(analysis.driftLabel)}</span>
        </article>
        <article class="card">
          <div class="kicker">Drift</div>
          <div class="metric">${analysis.currentDrift.toFixed(2)}</div>
          <div class="sub">peak ${analysis.peakDrift.toFixed(2)} | avg ${analysis.avgDrift.toFixed(2)}</div>
        </article>
        <article class="card">
          <div class="kicker">Score</div>
          <div class="metric">${analysis.score}</div>
          <div class="sub">${analysis.receiptCount} receipts | ${analysis.uniqueTools} tools</div>
        </article>
        <article class="card">
          <div class="kicker">Recovery</div>
          <div class="metric">${analysis.recoveries}</div>
          <div class="sub">${analysis.errorCount} errors | ${analysis.retryCount} retries</div>
        </article>
      </div>
    </section>

    <section class="section card">
      <h2>Tool Usage</h2>
      ${renderUsageBars(analysis.toolUsage)}
    </section>

    <section class="section grid">
      <article class="card">
        <h2>Fingerprints</h2>
        ${renderFingerprintList(analysis)}
      </article>
      <article class="card">
        <h2>Suggestions</h2>
        ${renderSuggestionList(analysis)}
      </article>
    </section>

    <section class="section card">
      <h2>Timeline</h2>
      <table>
        <thead><tr><th>Step</th><th>Time</th><th>Decision</th><th>Drift</th></tr></thead>
        <tbody>${renderTimelineRows(analysis)}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

export function renderSessionCard(analysis: SessionAnalysis): string {
  const winnerTone = analysis.health === "HEALTHY" ? "clean" : analysis.health === "DEGRADED" ? "wobbly" : "critical";
  return `AXIOM card
session : ${shortId(analysis.sessionId)}
mission : ${analysis.mission ?? "none"}
status  : ${analysis.health} (${winnerTone})
score   : ${analysis.score}
drift   : ${analysis.currentDrift.toFixed(2)}
dna     : ${analysis.dna}
hook    : ${analysis.fingerprints[0]?.title ?? "No major fingerprints"}`;
}

export function renderArenaMarkdown(comparison: ArenaComparison): string {
  return `# AXIOM Arena

- Winner: ${comparison.winner}
- Summary: ${comparison.summary}

| Metric | A | B |
| --- | ---: | ---: |
| Score | ${comparison.scoreA} | ${comparison.scoreB} |
| Drift | ${comparison.sessionA.currentDrift.toFixed(2)} | ${comparison.sessionB.currentDrift.toFixed(2)} |
| Peak drift | ${comparison.sessionA.peakDrift.toFixed(2)} | ${comparison.sessionB.peakDrift.toFixed(2)} |
| Errors | ${comparison.sessionA.errorCount} | ${comparison.sessionB.errorCount} |
| Retries | ${comparison.sessionA.retryCount} | ${comparison.sessionB.retryCount} |
| Receipts | ${comparison.sessionA.receiptCount} | ${comparison.sessionB.receiptCount} |
| Recoveries | ${comparison.sessionA.recoveries} | ${comparison.sessionB.recoveries} |

## Reasons
${comparison.reasons.map((reason) => `- ${reason}`).join("\n") || "- Both sessions were effectively tied."}`;
}

export function renderArenaHtml(comparison: ArenaComparison): string {
  const winnerLabel =
    comparison.winner === "TIE" ? "Tie" : `${comparison.winner} wins (${escapeHtml(shortId(comparison.winnerSessionId ?? ""))})`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AXIOM Arena</title>
  <style>
    body { margin: 0; font: 16px/1.5 "Segoe UI", sans-serif; background: linear-gradient(180deg, #081c15, #1b4332); color: #f1faee; }
    .wrap { max-width: 1000px; margin: 0 auto; padding: 28px 18px 40px; }
    .hero { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); border-radius: 24px; padding: 24px; backdrop-filter: blur(8px); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
    .card { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); border-radius: 20px; padding: 18px; }
    .score { font-size: 40px; font-weight: 700; margin: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border-bottom: 1px solid rgba(255,255,255,0.12); padding: 10px 8px; text-align: left; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <h1>AXIOM Arena</h1>
      <p>${escapeHtml(comparison.summary)}</p>
      <p><strong>${winnerLabel}</strong></p>
      <div class="grid">
        <article class="card">
          <h2>A</h2>
          <p class="score">${comparison.scoreA}</p>
          <p>${escapeHtml(shortId(comparison.sessionA.sessionId))} | drift ${comparison.sessionA.currentDrift.toFixed(2)} | errors ${comparison.sessionA.errorCount}</p>
        </article>
        <article class="card">
          <h2>B</h2>
          <p class="score">${comparison.scoreB}</p>
          <p>${escapeHtml(shortId(comparison.sessionB.sessionId))} | drift ${comparison.sessionB.currentDrift.toFixed(2)} | errors ${comparison.sessionB.errorCount}</p>
        </article>
      </div>
    </section>
    <section class="card" style="margin-top:18px;">
      <h2>Reasons</h2>
      <ul>${comparison.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("") || "<li>Both sessions were effectively tied.</li>"}</ul>
      <table>
        <thead><tr><th>Metric</th><th>A</th><th>B</th></tr></thead>
        <tbody>
          <tr><td>Score</td><td>${comparison.scoreA}</td><td>${comparison.scoreB}</td></tr>
          <tr><td>Drift</td><td>${comparison.sessionA.currentDrift.toFixed(2)}</td><td>${comparison.sessionB.currentDrift.toFixed(2)}</td></tr>
          <tr><td>Peak drift</td><td>${comparison.sessionA.peakDrift.toFixed(2)}</td><td>${comparison.sessionB.peakDrift.toFixed(2)}</td></tr>
          <tr><td>Errors</td><td>${comparison.sessionA.errorCount}</td><td>${comparison.sessionB.errorCount}</td></tr>
          <tr><td>Retries</td><td>${comparison.sessionA.retryCount}</td><td>${comparison.sessionB.retryCount}</td></tr>
          <tr><td>Receipts</td><td>${comparison.sessionA.receiptCount}</td><td>${comparison.sessionB.receiptCount}</td></tr>
          <tr><td>Recoveries</td><td>${comparison.sessionA.recoveries}</td><td>${comparison.sessionB.recoveries}</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

export function renderMermaid(analysis: SessionAnalysis): string {
  const lines = ["flowchart TD"];
  lines.push(`  S["Session ${shortId(analysis.sessionId)}"]`);
  let previous = "S";
  for (const receipt of analysis.receipts) {
    const nodeId = `N${receipt.id}`;
    const label = `${receipt.id}. ${receipt.decision.replace(/"/g, "'").slice(0, 72)}${receipt.tool ? `\\n[${receipt.tool}]` : ""}\\ndrift ${receipt.drift.toFixed(2)}`;
    lines.push(`  ${nodeId}["${label}"]`);
    lines.push(`  ${previous} --> ${nodeId}`);
    const tags = (receipt.tags ?? "").toLowerCase();
    if (tags.includes("error")) lines.push(`  class ${nodeId} error`);
    else if (tags.includes("final")) lines.push(`  class ${nodeId} final`);
    previous = nodeId;
  }
  lines.push("  classDef error fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d");
  lines.push("  classDef final fill:#dcfce7,stroke:#15803d,color:#14532d");
  return lines.join("\n");
}

export function renderPostmortemMarkdown(analysis: SessionAnalysis, style: "professional" | "roast"): string {
  const opener =
    style === "roast"
      ? `This run had ${analysis.receiptCount} receipts, drifted to ${analysis.currentDrift.toFixed(2)}, and occasionally behaved like it had misplaced its own plan.`
      : `This session ended with ${analysis.receiptCount} receipts, a final drift score of ${analysis.currentDrift.toFixed(2)}, and health rated ${analysis.health}.`;

  return `# AXIOM Postmortem

${opener}

## Fingerprints
${analysis.fingerprints.map((fingerprint) => `- ${fingerprint.title}: ${fingerprint.summary}`).join("\n") || "- No major fingerprints detected."}

## What to change next
${analysis.suggestions.map((item) => `- ${item}`).join("\n")}

## Agent DNA
- ${analysis.dna}

## Score drivers
${analysis.scoreReasons.map((item) => `- ${item}`).join("\n")}`;
}

export function renderPostmortemHtml(analysis: SessionAnalysis, style: "professional" | "roast"): string {
  const body =
    style === "roast"
      ? `This run looked talented, ambitious, and at several points deeply committed to repeating itself.`
      : `This report summarizes the dominant failure patterns and improvement opportunities for the session.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AXIOM Postmortem</title>
  <style>
    body { margin: 0; font: 16px/1.6 "Segoe UI", sans-serif; background: #101828; color: #f8fafc; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 32px 18px 44px; }
    .card { background: #182230; border: 1px solid #344054; border-radius: 20px; padding: 22px; margin-top: 18px; }
    h1, h2 { margin-top: 0; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <h1>AXIOM Postmortem</h1>
      <p>${escapeHtml(body)}</p>
      <p><strong>Session:</strong> ${escapeHtml(shortId(analysis.sessionId))} | <strong>Health:</strong> ${escapeHtml(analysis.health)} | <strong>Drift:</strong> ${analysis.currentDrift.toFixed(2)}</p>
    </section>
    <section class="card">
      <h2>Fingerprints</h2>
      ${renderFingerprintList(analysis)}
    </section>
    <section class="card">
      <h2>What to change next</h2>
      ${renderSuggestionList(analysis)}
    </section>
    <section class="card">
      <h2>Score drivers</h2>
      <ul>${analysis.scoreReasons.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  </main>
</body>
</html>`;
}
