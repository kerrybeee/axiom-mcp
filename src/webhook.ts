/**
 * AXIOM — Webhook dispatcher
 * Fires a POST request when drift exceeds configured threshold.
 * Configure via env: AXIOM_WEBHOOK_URL, AXIOM_WEBHOOK_THRESHOLD (default 0.5)
 */

const WEBHOOK_URL = process.env.AXIOM_WEBHOOK_URL ?? "";
const THRESHOLD   = parseFloat(process.env.AXIOM_WEBHOOK_THRESHOLD ?? "0.5");

interface WebhookPayload {
  event: "drift_alert" | "session_complete";
  session_id: string;
  drift: number;
  threshold: number;
  receipt_count: number;
  timestamp: string;
  mission?: string | null;
  message: string;
}

export async function maybeFire(payload: WebhookPayload): Promise<void> {
  if (!WEBHOOK_URL) return;
  if (payload.event === "drift_alert" && payload.drift < THRESHOLD) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Axiom-Event": payload.event },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    process.stderr.write(`[AXIOM] webhook fired: ${payload.event} → ${WEBHOOK_URL}\n`);
  } catch (e) {
    process.stderr.write(`[AXIOM] webhook failed: ${(e as Error).message}\n`);
  }
}

export function driftPayload(sessionId: string, drift: number, receiptCount: number, mission?: string | null): WebhookPayload {
  return {
    event: "drift_alert",
    session_id: sessionId,
    drift,
    threshold: THRESHOLD,
    receipt_count: receiptCount,
    timestamp: new Date().toISOString(),
    mission,
    message: `AXIOM drift alert: ${drift.toFixed(2)} exceeds threshold ${THRESHOLD}`,
  };
}

export function completePayload(sessionId: string, drift: number, receiptCount: number, mission?: string | null): WebhookPayload {
  return {
    event: "session_complete",
    session_id: sessionId,
    drift,
    threshold: THRESHOLD,
    receipt_count: receiptCount,
    timestamp: new Date().toISOString(),
    mission,
    message: `AXIOM session complete. ${receiptCount} receipts, drift ${drift.toFixed(2)}`,
  };
}
