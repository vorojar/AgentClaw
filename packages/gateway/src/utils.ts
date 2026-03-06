/**
 * Shared utility functions used across gateway modules.
 * Extracted from telegram.ts, whatsapp.ts, dingtalk.ts, feishu.ts, ws.ts
 * to eliminate cross-file duplication.
 */
import type { ContentBlock } from "@agentclaw/types";
import { getWsClients } from "./ws.js";

/** Extract plain text from a Message content (string or ContentBlock[]) */
export function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Strip markdown image/link references to /files/ (already delivered via send_file) */
export function stripFileMarkdown(text: string): string {
  return text.replace(/!?\[[^\]]*\]\([^)]*\/files\/[^)]+\)\n?/g, "");
}

/**
 * Split a long message into chunks that fit a platform's character limit.
 * Tries to split at newline boundaries, then spaces, then hard-cuts.
 */
export function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(" ", maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/** Notify all Web UI WebSocket clients that a session was updated from another channel */
export function broadcastSessionActivity(
  sessionId: string,
  channel: string,
): void {
  const msg = JSON.stringify({
    type: "session_activity",
    sessionId,
    channel,
  });
  for (const ws of getWsClients()) {
    try {
      ws.send(msg);
    } catch {}
  }
}

/** Format error message from unknown error value */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run a prompt through the orchestrator and collect the accumulated response text.
 * Used by scheduler, heartbeat, task runner, and other background processes.
 */
export async function collectResponse(
  orchestrator: {
    createSession: () => Promise<{ id: string }>;
    processInputStream: (
      id: string,
      input: string,
    ) => AsyncIterable<{ type: string; data: unknown }>;
  },
  prompt: string,
): Promise<string> {
  const session = await orchestrator.createSession();
  let text = "";
  for await (const event of orchestrator.processInputStream(
    session.id,
    prompt,
  )) {
    if (event.type === "response_chunk") {
      text += (event.data as { text: string }).text;
    }
  }
  return text;
}
