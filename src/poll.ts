/**
 * Long-poll loop: getUpdates → filter → handle.
 */

import { getUpdates } from "./api.js";
import { loadSyncBuf, saveSyncBuf, loadContextTokens, loadSessions } from "./config.js";
import { handleMessage } from "./handler.js";
import type { Config } from "./types.js";
import { sleep, log } from "./util.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60_000; // 1 hour

export async function startPolling(config: Config, signal: AbortSignal): Promise<void> {
  let getUpdatesBuf = loadSyncBuf();
  const contextTokens = loadContextTokens();
  const sessions = loadSessions();

  if (getUpdatesBuf) {
    log(`恢复上次的同步状态 (${getUpdatesBuf.length} bytes)`);
  } else {
    log("首次启动，从头开始同步");
  }

  let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  while (!signal.aborted) {
    try {
      const resp = await getUpdates({
        baseUrl: config.base_url,
        token: config.bot_token,
        getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
      });

      // Update server-suggested timeout
      if (resp.longpolling_timeout_ms && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
      }

      // Handle API errors
      const isError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isError) {
        if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
          log(`会话过期 (errcode ${SESSION_EXPIRED_ERRCODE})，暂停 1 小时`);
          await sleep(SESSION_PAUSE_MS, signal);
          continue;
        }

        consecutiveFailures++;
        log(`getUpdates 失败: ret=${resp.ret} errcode=${resp.errcode} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log(`连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，等待 30s`);
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, signal);
        } else {
          await sleep(RETRY_DELAY_MS, signal);
        }
        continue;
      }

      consecutiveFailures = 0;

      // Save sync cursor
      if (resp.get_updates_buf) {
        saveSyncBuf(resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
      }

      // Process messages
      const msgs = resp.msgs ?? [];
      for (const msg of msgs) {
        const fromUser = msg.from_user_id ?? "";

        // Allowlist check
        if (config.allowed_users.length > 0 && !config.allowed_users.includes(fromUser)) {
          log(`消息被过滤: ${fromUser.slice(0, 8)}... 不在白名单中`);
          continue;
        }

        // Skip bot's own messages
        if (msg.message_type === 2) continue;

        await handleMessage(msg, config, contextTokens, sessions);
      }
    } catch (err) {
      if (signal.aborted) return;

      consecutiveFailures++;
      log(`轮询错误 (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err instanceof Error ? err.message : String(err)}`);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_DELAY_MS, signal);
      } else {
        await sleep(RETRY_DELAY_MS, signal);
      }
    }
  }
  log("轮询已停止");
}
