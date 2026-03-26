/**
 * Wait for ONE WeChat message, print it as JSON, then exit.
 * Designed to be run as a background task in Claude Code.
 */

import { getUpdates } from "./api.js";
import { loadConfig, loadSyncBuf, saveSyncBuf, loadContextTokens, saveContextTokens } from "./config.js";
import { MessageItemType } from "./types.js";
import type { WeixinMessage } from "./types.js";
import { sleep } from "./util.js";

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;

function extractText(msg: WeixinMessage): string {
  const items = msg.item_list ?? [];
  const parts: string[] = [];
  for (const item of items) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      parts.push(item.text_item.text);
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      parts.push(item.voice_item.text);
    }
    if (item.ref_msg?.title) {
      parts.push(`[引用] ${item.ref_msg.title}`);
    }
  }
  return parts.join("\n").trim();
}

async function main() {
  const config = loadConfig();
  if (!config?.bot_token) {
    console.error("请先运行 login 命令");
    process.exit(1);
  }

  let getUpdatesBuf = loadSyncBuf();
  const contextTokens = loadContextTokens();
  let consecutiveFailures = 0;

  while (true) {
    try {
      const resp = await getUpdates({
        baseUrl: config.base_url,
        token: config.bot_token,
        getUpdatesBuf,
      });

      const isError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isError) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS);
        } else {
          await sleep(RETRY_DELAY_MS);
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf) {
        saveSyncBuf(resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
      }

      const msgs = resp.msgs ?? [];
      for (const msg of msgs) {
        const fromUser = msg.from_user_id ?? "";
        // Skip bot's own messages
        if (msg.message_type === 2) continue;
        // Allowlist check
        if (config.allowed_users.length > 0 && !config.allowed_users.includes(fromUser)) continue;

        const text = extractText(msg);
        if (!text) continue;

        // Save context token
        if (msg.context_token) {
          contextTokens.set(fromUser, msg.context_token);
          saveContextTokens(contextTokens);
        }

        // Print message as JSON and exit
        console.log(JSON.stringify({
          from: fromUser,
          text,
          context_token: msg.context_token ?? "",
        }));
        process.exit(0);
      }
    } catch (err) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_DELAY_MS);
      } else {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
}

main();
