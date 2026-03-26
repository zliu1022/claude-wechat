/**
 * Call Claude Code CLI as a subprocess with session persistence and streaming.
 */

import crypto from "node:crypto";
import { log } from "./util.js";

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

/** Streaming callback: called with accumulated text chunks. */
export type OnChunk = (text: string, isFinal: boolean) => Promise<void>;

export async function callClaude(params: {
  prompt: string;
  sessionId?: string;
  isNewSession?: boolean;
  timeoutMs?: number;
  onChunk?: OnChunk;
}): Promise<string> {
  const { prompt, sessionId, isNewSession, timeoutMs, onChunk } = params;
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const streaming = !!onChunk;

  const args = [
    "claude", "-p",
    "--output-format", streaming ? "stream-json" : "json",
    "--allowedTools", "WebSearch,WebFetch",
  ];

  if (streaming) args.push("--verbose");

  if (sessionId) {
    if (isNewSession) {
      args.push("--session-id", sessionId);
      log(`新建会话 ${sessionId.slice(0, 8)}...`);
    } else {
      args.push("--resume", sessionId);
      log(`继续会话 ${sessionId.slice(0, 8)}...`);
    }
  }

  log(`调用 Claude Code (最长 ${Math.round(timeout / 1000)}s, ${streaming ? "流式" : "普通"})...`);

  const proc = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });

  proc.stdin.write(prompt);
  proc.stdin.end();

  const timer = setTimeout(() => {
    log("Claude 超时，正在终止...");
    proc.kill();
  }, timeout);

  if (streaming) {
    return await readStream(proc, onChunk, timer);
  } else {
    return await readJson(proc, timer);
  }
}

/** Read stream-json output line by line, calling onChunk periodically. */
async function readStream(
  proc: ReturnType<typeof Bun.spawn>,
  onChunk: OnChunk,
  timer: ReturnType<typeof setTimeout>,
): Promise<string> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let lastSentLength = 0;

  // Send chunks every 1500ms or 500 chars
  const CHUNK_INTERVAL_MS = 5000;
  const CHUNK_CHAR_THRESHOLD = 800;
  let lastSendTime = Date.now();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);

          if (obj.type === "assistant" && obj.message?.content) {
            for (const c of obj.message.content) {
              if (c.type === "text" && c.text) {
                fullText += c.text;
              }
            }
          }

          if (obj.type === "result" && obj.result) {
            fullText = obj.result;
          }
        } catch {
          // skip unparseable lines
        }
      }

      // Send chunk if enough new text accumulated or enough time passed
      const newChars = fullText.length - lastSentLength;
      const elapsed = Date.now() - lastSendTime;
      if (newChars >= CHUNK_CHAR_THRESHOLD || (newChars > 0 && elapsed >= CHUNK_INTERVAL_MS)) {
        const chunk = fullText.slice(lastSentLength);
        await onChunk(chunk, false);
        lastSentLength = fullText.length;
        lastSendTime = Date.now();
      }
    }
  } finally {
    reader.releaseLock();
  }

  clearTimeout(timer);
  await proc.exited;

  // Send any remaining text as final chunk
  if (fullText.length > lastSentLength) {
    const remaining = fullText.slice(lastSentLength);
    await onChunk(remaining, true);
  } else if (lastSentLength > 0) {
    // Signal completion even if no new text
    await onChunk("", true);
  }

  const stderr = await new Response(proc.stderr).text();
  if (proc.exitCode !== 0 && !fullText) {
    throw new Error(`Claude 退出码 ${proc.exitCode}: ${stderr.slice(0, 500)}`);
  }

  return fullText;
}

/** Read regular JSON output (non-streaming). */
async function readJson(
  proc: ReturnType<typeof Bun.spawn>,
  timer: ReturnType<typeof setTimeout>,
): Promise<string> {
  const exitCode = await proc.exited;
  clearTimeout(timer);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    throw new Error(`Claude 退出码 ${exitCode}: ${stderr.slice(0, 500)}`);
  }

  try {
    const parsed = JSON.parse(stdout);
    if (parsed.result) return parsed.result;
    if (typeof parsed === "string") return parsed;
    return stdout.trim();
  } catch {
    return stdout.trim();
  }
}

/** Generate a new UUID for a Claude session. */
export function newSessionId(): string {
  return crypto.randomUUID();
}
