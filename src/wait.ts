/**
 * Wait for ONE WeChat message, print it as JSON, then exit.
 * Designed to be run as a background task in Claude Code.
 *
 * Output JSON:
 *   { from, text, context_token, image_paths? }
 * image_paths: array of local file paths for downloaded images (if any)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getUpdates } from "./api.js";
import { loadConfig, loadSyncBuf, saveSyncBuf, loadContextTokens, saveContextTokens } from "./config.js";
import { MessageItemType } from "./types.js";
import type { WeixinMessage, CDNMedia } from "./types.js";
import { sleep } from "./util.js";

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const IMAGE_DIR = path.join(os.homedir(), ".claude-channel", "images");

/** Decrypt AES-128-ECB. aes_key is base64(hexString). */
function decryptAesEcb(data: Buffer, aesKeyB64: string): Buffer {
  const hexKey = Buffer.from(aesKeyB64, "base64").toString("ascii");
  const key = Buffer.from(hexKey, "hex");
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Download and decrypt a CDN media item. Returns local file path, or null on failure. */
async function downloadCdnMedia(media: CDNMedia, suffix = ".bin"): Promise<string | null> {
  const param = media.encrypt_query_param;
  if (!param) return null;

  try {
    const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(param)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;

    let data = Buffer.from(await res.arrayBuffer());

    if (media.encrypt_type === 1 && media.aes_key) {
      data = decryptAesEcb(data, media.aes_key);
    }

    fs.mkdirSync(IMAGE_DIR, { recursive: true, mode: 0o700 });
    const filePath = path.join(IMAGE_DIR, `img_${Date.now()}${suffix}`);
    fs.writeFileSync(filePath, data, { mode: 0o600 });
    return filePath;
  } catch {
    return null;
  }
}

/** Extract image paths from a message. Returns array of local file paths. */
async function extractImages(msg: WeixinMessage): Promise<string[]> {
  const items = msg.item_list ?? [];
  const paths: string[] = [];

  for (const item of items) {
    if (item.type !== MessageItemType.IMAGE) continue;

    // Try image_item first, then fall back to file_item (some API versions use file_item for images)
    const media = item.image_item?.media ?? item.file_item?.media;

    // Try direct URL (if API provides one)
    const directUrl = item.image_item?.url;
    if (directUrl) {
      try {
        const res = await fetch(directUrl, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          const data = Buffer.from(await res.arrayBuffer());
          fs.mkdirSync(IMAGE_DIR, { recursive: true, mode: 0o700 });
          const filePath = path.join(IMAGE_DIR, `img_${Date.now()}.jpg`);
          fs.writeFileSync(filePath, data, { mode: 0o600 });
          paths.push(filePath);
          continue;
        }
      } catch {
        // fall through to CDN method
      }
    }

    if (media) {
      const p = await downloadCdnMedia(media, ".jpg");
      if (p) paths.push(p);
    }
  }

  return paths;
}

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

function hasImages(msg: WeixinMessage): boolean {
  return (msg.item_list ?? []).some((item) => item.type === MessageItemType.IMAGE);
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
        const containsImages = hasImages(msg);

        // Skip if neither text nor images
        if (!text && !containsImages) continue;

        // Save context token
        if (msg.context_token) {
          contextTokens.set(fromUser, msg.context_token);
          saveContextTokens(contextTokens);
        }

        // Download images (async, best-effort)
        const imagePaths = containsImages ? await extractImages(msg) : [];

        // Build output
        const output: Record<string, unknown> = {
          from: fromUser,
          text: text || "[图片]",
          context_token: msg.context_token ?? "",
        };
        if (imagePaths.length > 0) {
          output.image_paths = imagePaths;
        } else if (containsImages) {
          // Images detected but download failed — still notify Claude
          output.text = text ? `${text}\n[图片消息，下载失败]` : "[图片消息，下载失败]";
        }

        console.log(JSON.stringify(output));
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
