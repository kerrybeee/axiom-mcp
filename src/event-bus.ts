export type AxiomEventType =
  | "session_started"
  | "session_updated"
  | "session_cleared"
  | "heartbeat";

export interface AxiomEvent {
  type: AxiomEventType;
  sessionId: string;
  timestamp: string;
  mission?: string;
  receiptId?: number;
  previousSessionId?: string;
}

type Listener = (event: AxiomEvent) => void;

const listeners = new Set<Listener>();

export function publishAxiomEvent(event: AxiomEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeAxiomEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
