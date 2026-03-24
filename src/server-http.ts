#!/usr/bin/env node
/**
 * AXIOM MCP Server - HTTP/SSE transport
 * Lets multiple agents on different machines log to the same ledger
 * while also exposing browser-friendly dashboards and shareable reports.
 *
 * Usage: AXIOM_PORT=3456 node dist/server-http.js
 *
 * MCP config for remote hosts:
 *   { "url": "http://your-server:3456/sse" }
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express from "express";
import { analyzeSession, compareAnalyses, type SessionAnalysis } from "./analysis.js";
import { findSession, getReceipts, getSessions, initDb } from "./db.js";
import { subscribeAxiomEvents, type AxiomEvent } from "./event-bus.js";
import {
  renderArenaHtml,
  renderMermaid,
  renderPostmortemHtml,
  renderSessionHtml,
} from "./reports.js";
import { getCurrentSession, handleTool, initSession, TOOL_DEFS } from "./tools.js";

const PORT = parseInt(process.env.AXIOM_PORT ?? "3456", 10);

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

function resolveAnalysis(idOrCurrent?: string): SessionAnalysis {
  const current = getCurrentSession();
  if (!idOrCurrent || idOrCurrent === "current") {
    return analyzeSession(current.id, getReceipts(current.id), {
      id: current.id,
      started_at: current.startedAt,
      mission: current.mission ?? null,
      ended_at: null,
    });
  }

  const session = findSession(idOrCurrent);
  if (!session) {
    throw new Error(`Session not found: ${idOrCurrent}`);
  }
  return analyzeSession(session.id, getReceipts(session.id), session);
}

function listAnalyses(limit = 12): SessionAnalysis[] {
  return getSessions(limit).map((session) => analyzeSession(session.id, getReceipts(session.id), session));
}

function leaderboard(limit = 8): SessionAnalysis[] {
  return listAnalyses(Math.max(limit, 20))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function sessionCardMarkup(analysis: SessionAnalysis, href: string, active = false): string {
  const tone = analysis.health === "HEALTHY" ? "good" : analysis.health === "DEGRADED" ? "warn" : "bad";
  return `<a href="${escapeHtml(href)}" class="session-card${active ? " active" : ""}">
    <span class="card-top">
      <strong>${escapeHtml(shortId(analysis.sessionId))}</strong>
      <em class="tone-${tone}">${escapeHtml(analysis.health)}</em>
    </span>
    <span class="card-mission">${escapeHtml(analysis.mission ?? "No mission")}</span>
    <span class="card-meta">score ${analysis.score} | drift ${analysis.currentDrift.toFixed(2)} | receipts ${analysis.receiptCount}</span>
  </a>`;
}

function renderDashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AXIOM Dashboard</title>
  <style>
    :root {
      --bg: #f4efe6;
      --ink: #1f2937;
      --muted: #6b7280;
      --card: rgba(255,255,255,0.88);
      --line: rgba(31,41,55,0.12);
      --good: #166534;
      --warn: #b45309;
      --bad: #b91c1c;
      --accent: #005f73;
      --accent-soft: #d9f0f4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font: 15px/1.5 Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, rgba(0,95,115,0.12), transparent 36%),
        radial-gradient(circle at bottom right, rgba(202,138,4,0.12), transparent 32%),
        linear-gradient(180deg, #f8f4ec, var(--bg));
    }
    a { color: var(--accent); }
    .wrap { max-width: 1240px; margin: 0 auto; padding: 26px 18px 42px; }
    .hero, .panel, .metric, .session-card {
      background: var(--card);
      border: 1px solid var(--line);
      box-shadow: 0 16px 35px rgba(17, 24, 39, 0.08);
      backdrop-filter: blur(6px);
    }
    .hero {
      border-radius: 28px;
      padding: 28px;
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
      align-items: start;
    }
    .eyebrow {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-size: 12px;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 { font-size: clamp(34px, 5vw, 58px); line-height: 0.95; margin-bottom: 12px; }
    .hero-copy p { color: #374151; max-width: 58ch; }
    .hero-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    .hero-links a {
      text-decoration: none;
      border-radius: 999px;
      padding: 10px 14px;
      background: #fff;
      border: 1px solid var(--line);
    }
    .hero-meta {
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-top: 18px;
    }
    .metric {
      border-radius: 22px;
      padding: 18px;
    }
    .metric strong {
      display: block;
      font-size: 30px;
      margin-top: 4px;
    }
    .tone-good { color: var(--good); }
    .tone-warn { color: var(--warn); }
    .tone-bad { color: var(--bad); }
    .layout {
      display: grid;
      grid-template-columns: 340px 1fr;
      gap: 18px;
      margin-top: 18px;
      align-items: start;
    }
    .panel {
      border-radius: 24px;
      padding: 18px;
    }
    .session-list {
      display: grid;
      gap: 10px;
      max-height: 640px;
      overflow: auto;
      padding-right: 4px;
    }
    .session-card {
      width: 100%;
      text-align: left;
      border-radius: 18px;
      padding: 14px;
      cursor: pointer;
    }
    .session-card.active {
      border-color: rgba(0,95,115,0.45);
      background: linear-gradient(180deg, #f8fffe, var(--accent-soft));
      transform: translateY(-1px);
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }
    .card-mission, .card-meta {
      display: block;
      color: #374151;
    }
    .card-meta {
      color: var(--muted);
      font-size: 13px;
      margin-top: 6px;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .detail-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
      background: #fffdfa;
    }
    .detail-card ul { padding-left: 18px; margin-bottom: 0; }
    .detail-card li { margin-bottom: 8px; }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }
    .actions a {
      text-decoration: none;
      border-radius: 999px;
      padding: 9px 12px;
      border: 1px solid var(--line);
      background: #fff;
    }
    .leaderboard {
      margin-top: 16px;
      display: grid;
      gap: 8px;
    }
    .leaderboard-row {
      display: grid;
      grid-template-columns: 32px 1fr auto;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 16px;
      background: rgba(255,255,255,0.66);
      border: 1px solid var(--line);
    }
    .empty {
      color: var(--muted);
      padding: 18px 0;
    }
    @media (max-width: 980px) {
      .hero, .layout { grid-template-columns: 1fr; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .detail-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">AXIOM Dashboard</p>
        <h1>Flight recorder for AI agents.</h1>
        <p>Inspect recent sessions, open polished casefiles, roast failures, compare runs head-to-head, and pull live health from the same ledger your MCP tools use.</p>
        <div class="hero-links">
          <a href="/health">Health</a>
          <a href="/api/sessions">Sessions API</a>
          <a href="/api/leaderboard">Leaderboard API</a>
          <a href="/gallery">Gallery</a>
        </div>
      </div>
      <div class="hero-meta">
        <div class="panel">
          <h3>Live Lens</h3>
          <p id="current-session-line" class="empty">Loading current session...</p>
          <p id="current-hook" class="empty"></p>
          <p id="stream-status" class="eyebrow">Live stream: connecting...</p>
        </div>
        <div class="panel">
          <h3>Best Runs</h3>
          <div id="leaderboard" class="leaderboard"></div>
        </div>
      </div>
    </section>

    <section id="metric-grid" class="metric-grid"></section>

    <section class="layout">
      <aside class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <h2 style="margin-bottom:0;">Recent Sessions</h2>
          <button id="refresh-button" class="session-card" style="width:auto;padding:10px 14px;">Refresh</button>
        </div>
        <p class="eyebrow" style="margin-top:10px;">Click any session to inspect it</p>
        <div id="session-list" class="session-list"></div>
      </aside>

      <section class="panel">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
          <div>
            <p class="eyebrow" id="detail-eyebrow">Session Detail</p>
            <h2 id="detail-title">Loading...</h2>
            <p id="detail-subtitle" class="empty"></p>
          </div>
          <div id="detail-actions" class="actions"></div>
        </div>
        <div id="detail-grid" class="detail-grid"></div>
      </section>
    </section>
  </main>

  <script>
    const state = { sessions: [], selectedId: "current", current: null, leaderboard: [], stream: null };

    function healthTone(health) {
      if (health === "HEALTHY") return "good";
      if (health === "DEGRADED") return "warn";
      return "bad";
    }

    function shortId(id) {
      return id.slice(0, 12);
    }

    function listHtml(items, emptyText) {
      if (!items || items.length === 0) return '<p class="empty">' + emptyText + '</p>';
      return '<ul>' + items.map((item) => '<li>' + item + '</li>').join('') + '</ul>';
    }

    function renderMetrics(current) {
      if (!current) return;
      const metrics = [
        { label: 'Current Drift', value: current.current_drift.toFixed(2), note: current.drift_label, tone: healthTone(current.health) },
        { label: 'Score', value: current.score, note: current.dna, tone: 'good' },
        { label: 'Receipts', value: current.receipt_count, note: current.unique_tools + ' tools used', tone: 'warn' },
        { label: 'Recoveries', value: current.recoveries, note: current.error_count + ' errors tagged', tone: current.recoveries > 0 ? 'good' : 'bad' },
      ];
      document.getElementById('metric-grid').innerHTML = metrics.map((metric) =>
        '<article class="metric">' +
          '<span class="eyebrow">' + metric.label + '</span>' +
          '<strong class="tone-' + metric.tone + '">' + metric.value + '</strong>' +
          '<span>' + metric.note + '</span>' +
        '</article>'
      ).join('');
      document.getElementById('current-session-line').textContent =
        'Current session ' + shortId(current.session_id) + ' | ' + (current.mission || 'No mission') + ' | ' + current.health;
      document.getElementById('current-hook').textContent =
        current.fingerprints.length > 0
          ? 'Top fingerprint: ' + current.fingerprints[0].title
          : 'No major fingerprints detected in the active run.';
    }

    function renderLeaderboard(entries) {
      const root = document.getElementById('leaderboard');
      if (!entries.length) {
        root.innerHTML = '<p class="empty">No completed sessions yet.</p>';
        return;
      }
      root.innerHTML = entries.map((entry, index) =>
        '<div class="leaderboard-row">' +
          '<strong>' + String(index + 1).padStart(2, '0') + '</strong>' +
          '<div>' +
            '<div>' + shortId(entry.session_id) + ' | ' + (entry.mission || 'No mission') + '</div>' +
            '<div class="card-meta">' + entry.health + ' | drift ' + entry.current_drift.toFixed(2) + '</div>' +
          '</div>' +
          '<strong>' + entry.score + '</strong>' +
        '</div>'
      ).join('');
    }

    function renderSessionList() {
      const root = document.getElementById('session-list');
      if (!state.sessions.length) {
        root.innerHTML = '<p class="empty">No sessions found yet.</p>';
        return;
      }
      root.innerHTML = state.sessions.map((session) =>
        '<button class="session-card ' + (state.selectedId === session.session_id ? 'active' : '') + '" data-session-id="' + session.session_id + '">' +
          '<span class="card-top">' +
            '<strong>' + shortId(session.session_id) + '</strong>' +
            '<em class="tone-' + healthTone(session.health) + '">' + session.health + '</em>' +
          '</span>' +
          '<span class="card-mission">' + (session.mission || 'No mission') + '</span>' +
          '<span class="card-meta">score ' + session.score + ' | drift ' + session.current_drift.toFixed(2) + ' | receipts ' + session.receipt_count + '</span>' +
        '</button>'
      ).join('');

      root.querySelectorAll('[data-session-id]').forEach((button) => {
        button.addEventListener('click', () => loadSession(button.getAttribute('data-session-id')));
      });
    }

    function detailCard(title, items, emptyText) {
      return '<article class="detail-card"><h3>' + title + '</h3>' + listHtml(items, emptyText) + '</article>';
    }

    function renderDetail(detail) {
      document.getElementById('detail-eyebrow').textContent = 'Session Detail';
      document.getElementById('detail-title').textContent = shortId(detail.session_id) + ' | ' + detail.health;
      document.getElementById('detail-subtitle').textContent =
        (detail.mission || 'No mission') + ' | score ' + detail.score + ' | drift ' + detail.current_drift.toFixed(2) + ' | DNA ' + detail.dna;

      document.getElementById('detail-actions').innerHTML =
        '<a href="/reports/' + detail.session_id + '">HTML report</a>' +
        '<a href="/postmortem/' + detail.session_id + '">Postmortem</a>' +
        '<a href="/postmortem/' + detail.session_id + '?style=roast">Roast mode</a>' +
        '<a href="/visualize/' + detail.session_id + '">Visualization</a>';

      const fingerprintItems = detail.fingerprints.map((fingerprint) =>
        '<strong>' + fingerprint.title + '</strong> (' + fingerprint.severity + '): ' + fingerprint.summary
      );
      const suggestionItems = detail.suggestions.map((item) => item);
      const timelineItems = detail.timeline.slice(0, 8).map((step) =>
        step.timestamp.slice(11, 19) + ' | step ' + step.id + ' | drift ' + step.drift.toFixed(2) + ' | ' + step.decision
      );
      const toolItems = Object.entries(detail.tool_usage)
        .sort((a, b) => b[1] - a[1])
        .map(([tool, count]) => tool + ': ' + count);

      document.getElementById('detail-grid').innerHTML =
        detailCard('Fingerprints', fingerprintItems, 'No major fingerprints detected.') +
        detailCard('Recommendations', suggestionItems, 'No immediate changes suggested.') +
        detailCard('Tool Usage', toolItems, 'No tool usage recorded.') +
        detailCard('Timeline Preview', timelineItems, 'No timeline available.');
    }

    async function loadOverview() {
      const [dashboardRes, sessionsRes, leaderboardRes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/sessions?limit=14'),
        fetch('/api/leaderboard?limit=6'),
      ]);
      const dashboard = await dashboardRes.json();
      state.current = dashboard.current;
      state.sessions = await sessionsRes.json();
      state.leaderboard = await leaderboardRes.json();
      if (!state.selectedId && state.sessions[0]) state.selectedId = state.sessions[0].session_id;
      if (state.selectedId === 'current' && dashboard.current) state.selectedId = dashboard.current.session_id;
      renderMetrics(state.current);
      renderLeaderboard(state.leaderboard);
      renderSessionList();
      if (state.selectedId) await loadSession(state.selectedId, false);
    }

    async function loadSession(id, rerenderList = true) {
      state.selectedId = id;
      if (rerenderList) renderSessionList();
      const response = await fetch('/api/sessions/' + encodeURIComponent(id));
      if (!response.ok) return;
      const detail = await response.json();
      renderDetail(detail);
    }

    function connectEvents() {
      if (state.stream) state.stream.close();
      const stream = new EventSource('/events');
      state.stream = stream;
      const status = document.getElementById('stream-status');
      status.textContent = 'Live stream: connecting...';

      stream.addEventListener('ready', () => {
        status.textContent = 'Live stream: connected';
      });

      stream.addEventListener('session_started', async () => {
        status.textContent = 'Live stream: session started';
        await loadOverview();
      });

      stream.addEventListener('session_updated', async (event) => {
        status.textContent = 'Live stream: update received';
        const payload = JSON.parse(event.data);
        if (payload.current) {
          state.current = payload.current;
          renderMetrics(state.current);
        }
        if (payload.leaderboard) {
          state.leaderboard = payload.leaderboard;
          renderLeaderboard(state.leaderboard);
        }
        await loadOverview();
      });

      stream.addEventListener('session_cleared', async () => {
        status.textContent = 'Live stream: session cleared';
        state.selectedId = 'current';
        await loadOverview();
      });

      stream.addEventListener('heartbeat', () => {
        status.textContent = 'Live stream: connected';
      });

      stream.onerror = () => {
        status.textContent = 'Live stream: reconnecting...';
      };
    }

    document.getElementById('refresh-button').addEventListener('click', () => loadOverview());
    loadOverview();
    connectEvents();
    setInterval(loadOverview, 30000);
  </script>
</body>
</html>`;
}

function apiSummary(analysis: SessionAnalysis) {
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
    error_count: analysis.errorCount,
    retry_count: analysis.retryCount,
    recoveries: analysis.recoveries,
    fingerprints: analysis.fingerprints,
    suggestions: analysis.suggestions,
    timeline: analysis.receipts.map((receipt) => ({
      id: receipt.id,
      timestamp: receipt.timestamp,
      decision: receipt.decision,
      tool: receipt.tool,
      drift: receipt.drift,
    })),
  };
}

function maybeApiSummary(idOrCurrent?: string) {
  try {
    return apiSummary(resolveAnalysis(idOrCurrent));
  } catch {
    return null;
  }
}

function streamPayload(event: AxiomEvent) {
  return {
    event,
    current: maybeApiSummary("current"),
    session: maybeApiSummary(event.sessionId),
    leaderboard: leaderboard(6).map(apiSummary),
  };
}

function renderGalleryPage(): string {
  const featured = leaderboard(6);
  const chaotic = listAnalyses(18)
    .slice()
    .sort((left, right) => right.peakDrift - left.peakDrift)
    .slice(0, 4);
  const recoveryStars = listAnalyses(18)
    .filter((analysis) => analysis.recoveries > 0)
    .sort((left, right) => right.recoveries - left.recoveries || right.score - left.score)
    .slice(0, 4);

  const featuredMarkup = featured.length > 0
    ? featured.map((analysis) => sessionCardMarkup(analysis, `/reports/${analysis.sessionId}`)).join("")
    : `<p class="empty">No gallery sessions yet.</p>`;

  const chaoticMarkup = chaotic.length > 0
    ? chaotic.map((analysis) => sessionCardMarkup(analysis, `/postmortem/${analysis.sessionId}?style=roast`)).join("")
    : `<p class="empty">No chaotic runs recorded yet.</p>`;

  const recoveryMarkup = recoveryStars.length > 0
    ? recoveryStars.map((analysis) => sessionCardMarkup(analysis, `/reports/${analysis.sessionId}`)).join("")
    : `<p class="empty">No recovery stories yet.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AXIOM Gallery</title>
  <style>
    :root {
      --bg: #fbf7ef;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: rgba(31,41,55,0.12);
      --card: rgba(255,255,255,0.9);
      --good: #166534;
      --warn: #b45309;
      --bad: #b91c1c;
      --accent: #7c2d12;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top, rgba(124,45,18,0.15), transparent 28%),
        radial-gradient(circle at bottom left, rgba(22,101,52,0.11), transparent 24%),
        linear-gradient(180deg, #fffaf1, var(--bg));
      font: 15px/1.55 Georgia, "Times New Roman", serif;
    }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 18px 40px; }
    .hero, .shelf, .session-card {
      background: var(--card);
      border: 1px solid var(--line);
      box-shadow: 0 14px 35px rgba(17,24,39,0.08);
    }
    .hero {
      border-radius: 28px;
      padding: 28px;
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
      align-items: center;
    }
    h1, h2, p { margin-top: 0; }
    h1 { font-size: clamp(34px, 5vw, 58px); line-height: 0.95; margin-bottom: 12px; }
    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 8px;
    }
    .nav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
    }
    .nav a {
      text-decoration: none;
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 10px 14px;
    }
    .shelves {
      display: grid;
      gap: 18px;
      margin-top: 18px;
    }
    .shelf {
      border-radius: 24px;
      padding: 18px;
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .session-card {
      display: block;
      text-decoration: none;
      color: var(--ink);
      border-radius: 18px;
      padding: 14px;
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }
    .card-mission, .card-meta {
      display: block;
      color: #374151;
    }
    .card-meta {
      color: var(--muted);
      font-size: 13px;
      margin-top: 6px;
    }
    .tone-good { color: var(--good); }
    .tone-warn { color: var(--warn); }
    .tone-bad { color: var(--bad); }
    .empty { color: var(--muted); }
    @media (max-width: 900px) {
      .hero { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div>
        <p class="eyebrow">AXIOM Gallery</p>
        <h1>Show the runs worth sharing.</h1>
        <p>This gallery turns ledger data into demo surfaces: top scores, dramatic failures, and the agents that managed to recover anyway.</p>
        <div class="nav">
          <a href="/dashboard">Dashboard</a>
          <a href="/api/gallery">Gallery API</a>
          <a href="/arena">Arena</a>
        </div>
      </div>
      <div>
        <p><strong>${featured.length}</strong> featured runs</p>
        <p><strong>${chaotic.length}</strong> chaos stories</p>
        <p><strong>${recoveryStars.length}</strong> recovery highlights</p>
      </div>
    </section>

    <section class="shelves">
      <article class="shelf">
        <p class="eyebrow">Leaderboard</p>
        <h2>Highest-scoring sessions</h2>
        <div class="card-grid">${featuredMarkup}</div>
      </article>

      <article class="shelf">
        <p class="eyebrow">Chaos Theater</p>
        <h2>Highest drift and weirdest energy</h2>
        <div class="card-grid">${chaoticMarkup}</div>
      </article>

      <article class="shelf">
        <p class="eyebrow">Recovery Stories</p>
        <h2>Runs that hit trouble and came back</h2>
        <div class="card-grid">${recoveryMarkup}</div>
      </article>
    </section>
  </main>
</body>
</html>`;
}

function renderVisualizationPage(analysis: SessionAnalysis): string {
  const diagram = escapeHtml(renderMermaid(analysis));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AXIOM Visualization</title>
  <style>
    body { margin: 0; background: #0f172a; color: #e2e8f0; font: 15px/1.55 "Segoe UI", sans-serif; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 26px 18px 38px; }
    .card { background: #111827; border: 1px solid rgba(226,232,240,0.12); border-radius: 24px; padding: 22px; margin-top: 18px; }
    pre { overflow: auto; white-space: pre-wrap; word-break: break-word; background: #020617; padding: 16px; border-radius: 18px; border: 1px solid rgba(226,232,240,0.12); }
    a { color: #7dd3fc; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <h1>AXIOM Visualization</h1>
      <p>Session ${escapeHtml(shortId(analysis.sessionId))} | ${escapeHtml(analysis.mission ?? "No mission")} | drift ${analysis.currentDrift.toFixed(2)}</p>
      <p>This route returns Mermaid source so you can paste it into GitHub, Mermaid Live, or other diagram tooling.</p>
      <p><a href="/reports/${escapeHtml(analysis.sessionId)}">Open HTML report</a></p>
    </section>
    <section class="card">
      <h2>Mermaid</h2>
      <pre>${diagram}</pre>
    </section>
  </main>
</body>
</html>`;
}

async function main() {
  await initDb();
  initSession();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/", (_req, res) => res.redirect("/dashboard"));

  app.get("/health", (_req, res) =>
    res.json({ status: "ok", version: "2.0.0", transport: "http-sse", dashboard: "/dashboard" }),
  );

  app.get("/dashboard", (_req, res) => {
    res.type("html").send(renderDashboardPage());
  });

  app.get("/gallery", (_req, res) => {
    res.type("html").send(renderGalleryPage());
  });

  app.get("/api/dashboard", (_req, res) => {
    const recent = listAnalyses(12);
    res.json({
      current: apiSummary(resolveAnalysis("current")),
      recent: recent.map(apiSummary),
      leaderboard: leaderboard(6).map(apiSummary),
    });
  });

  app.get("/api/sessions", (req, res) => {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit ?? 12) || 12));
    res.json(listAnalyses(limit).map(apiSummary));
  });

  app.get("/api/sessions/:id", (req, res) => {
    try {
      res.json(apiSummary(resolveAnalysis(req.params.id)));
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.get("/api/leaderboard", (req, res) => {
    const limit = Math.max(1, Math.min(20, Number(req.query.limit ?? 8) || 8));
    res.json(leaderboard(limit).map(apiSummary));
  });

  app.get("/api/gallery", (_req, res) => {
    const featured = leaderboard(6);
    const chaotic = listAnalyses(18)
      .slice()
      .sort((left, right) => right.peakDrift - left.peakDrift)
      .slice(0, 4);
    const recovery = listAnalyses(18)
      .filter((analysis) => analysis.recoveries > 0)
      .sort((left, right) => right.recoveries - left.recoveries || right.score - left.score)
      .slice(0, 4);

    res.json({
      featured: featured.map(apiSummary),
      chaotic: chaotic.map(apiSummary),
      recovery: recovery.map(apiSummary),
    });
  });

  app.get("/reports/:id", (req, res) => {
    try {
      res.type("html").send(renderSessionHtml(resolveAnalysis(req.params.id)));
    } catch (error) {
      res.status(404).type("text").send((error as Error).message);
    }
  });

  app.get("/postmortem/:id", (req, res) => {
    const style = req.query.style === "roast" ? "roast" : "professional";
    try {
      res.type("html").send(renderPostmortemHtml(resolveAnalysis(req.params.id), style));
    } catch (error) {
      res.status(404).type("text").send((error as Error).message);
    }
  });

  app.get("/visualize/:id", (req, res) => {
    try {
      res.type("html").send(renderVisualizationPage(resolveAnalysis(req.params.id)));
    } catch (error) {
      res.status(404).type("text").send((error as Error).message);
    }
  });

  app.get("/arena", (req, res) => {
    const sessionA = typeof req.query.session_a === "string" ? req.query.session_a : "current";
    const sessionB = typeof req.query.session_b === "string" ? req.query.session_b : null;
    if (!sessionB) {
      const sessions = listAnalyses(2);
      if (sessions.length < 2) {
        res.status(400).type("text").send("Need at least two sessions to render the arena.");
        return;
      }
      const comparison = compareAnalyses(sessions[0], sessions[1]);
      res.type("html").send(renderArenaHtml(comparison));
      return;
    }

    try {
      const comparison = compareAnalyses(resolveAnalysis(sessionA), resolveAnalysis(sessionB));
      res.type("html").send(renderArenaHtml(comparison));
    } catch (error) {
      res.status(404).type("text").send((error as Error).message);
    }
  });

  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const writeEvent = (name: string, payload: unknown) => {
      res.write(`event: ${name}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    writeEvent("ready", {
      timestamp: new Date().toISOString(),
      current: maybeApiSummary("current"),
    });

    const heartbeat = setInterval(() => {
      writeEvent("heartbeat", { timestamp: new Date().toISOString() });
    }, 15000);

    const unsubscribe = subscribeAxiomEvents((event) => {
      writeEvent(event.type, streamPayload(event));
    });

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  app.get("/sse", async (req, res) => {
    const clientIp = req.ip;
    process.stderr.write(`[AXIOM] SSE client connected: ${clientIp}\n`);

    const server = new Server(
      { name: "axiom-mcp", version: "2.0.0" },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const text = await handleTool(name, (args ?? {}) as Record<string, unknown>);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
      }
    });

    const transport = new SSEServerTransport("/message", res);
    await server.connect(transport);

    req.on("close", () => {
      process.stderr.write(`[AXIOM] SSE client disconnected: ${clientIp}\n`);
    });
  });

  app.post("/message", async (_req, res) => {
    res.json({ received: true });
  });

  app.listen(PORT, () => {
    process.stderr.write(`[AXIOM] HTTP/SSE server v2.0 running on :${PORT}\n`);
    process.stderr.write(`[AXIOM] Dashboard: http://localhost:${PORT}/dashboard\n`);
    process.stderr.write(`[AXIOM] SSE endpoint: http://localhost:${PORT}/sse\n`);
    process.stderr.write(`[AXIOM] Health check: http://localhost:${PORT}/health\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`[AXIOM] Fatal: ${error}\n`);
  process.exit(1);
});
