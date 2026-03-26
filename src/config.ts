import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Config } from "./types.js";

const STATE_DIR = path.join(os.homedir(), ".claude-channel");
const CONFIG_FILE = path.join(STATE_DIR, "config.json");
const SYNC_FILE = path.join(STATE_DIR, "sync.json");
const CONTEXT_FILE = path.join(STATE_DIR, "context-tokens.json");
const SESSIONS_FILE = path.join(STATE_DIR, "sessions.json");

function ensureDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): Config | null {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as Config;
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function loadSyncBuf(): string {
  try {
    const raw = fs.readFileSync(SYNC_FILE, "utf-8");
    return JSON.parse(raw).buf ?? "";
  } catch {
    return "";
  }
}

export function saveSyncBuf(buf: string): void {
  ensureDir();
  fs.writeFileSync(SYNC_FILE, JSON.stringify({ buf }), { mode: 0o600 });
}

/** Context token map: userId -> contextToken. */
export function loadContextTokens(): Map<string, string> {
  try {
    const raw = fs.readFileSync(CONTEXT_FILE, "utf-8");
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export function saveContextTokens(map: Map<string, string>): void {
  ensureDir();
  const obj = Object.fromEntries(map);
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(obj), { mode: 0o600 });
}

/** Session ID map: userId -> claude session UUID. */
export function loadSessions(): Map<string, string> {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export function saveSessions(map: Map<string, string>): void {
  ensureDir();
  const obj = Object.fromEntries(map);
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
}
