/**
 * Upload a file to WeChat CDN and send as file attachment.
 * Usage: bun run src/send-file.ts <userId> <contextToken> <filePath>
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { sendMessage } from "./api.js";
import { MessageType, MessageState, MessageItemType } from "./types.js";
import { generateClientId, log } from "./util.js";

const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

/** AES-128-ECB encrypt with PKCS7 padding. */
function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** Compute ciphertext size (PKCS7 padding to 16-byte boundary). */
function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

/** Get pre-signed upload URL from WeChat API. */
async function getUploadUrl(params: {
  baseUrl: string;
  token: string;
  filekey: string;
  toUserId: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  aeskey: string;
}): Promise<{ upload_param?: string }> {
  const base = params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`;
  const url = `${base}ilink/bot/getuploadurl`;
  const body = JSON.stringify({
    filekey: params.filekey,
    media_type: 3, // FILE
    to_user_id: params.toUserId,
    rawsize: params.rawsize,
    rawfilemd5: params.rawfilemd5,
    filesize: params.filesize,
    no_need_thumb: true,
    aeskey: params.aeskey,
    base_info: { channel_version: "1.0.0" },
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${params.token}`,
    "X-WECHAT-UIN": Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0))).toString("base64"),
  };

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`getUploadUrl failed: ${res.status}`);
  return (await res.json()) as { upload_param?: string };
}

async function main() {
  const args = process.argv.slice(2);
  const userId = args[0];
  const contextToken = args[1];
  const filePath = args[2];

  if (!userId || !contextToken || !filePath) {
    console.error("用法: bun run src/send-file.ts <userId> <contextToken> <filePath>");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config?.bot_token) {
    console.error("请先运行 login");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`文件不存在: ${absPath}`);
    process.exit(1);
  }

  const fileName = path.basename(absPath);
  const plaintext = fs.readFileSync(absPath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  log(`上传文件: ${fileName} (${rawsize} bytes)`);

  // 1. Get upload URL
  const uploadResp = await getUploadUrl({
    baseUrl: config.base_url,
    token: config.bot_token,
    filekey,
    toUserId: userId,
    rawsize,
    rawfilemd5,
    filesize,
    aeskey: aeskey.toString("hex"),
  });

  if (!uploadResp.upload_param) {
    throw new Error("getUploadUrl 未返回 upload_param");
  }

  // 2. Encrypt and upload to CDN
  const ciphertext = encryptAesEcb(plaintext, aeskey);
  const cdnUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadResp.upload_param)}&filekey=${encodeURIComponent(filekey)}`;

  log(`上传到 CDN (${ciphertext.length} bytes)...`);
  const cdnRes = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(ciphertext),
  });

  if (!cdnRes.ok) {
    throw new Error(`CDN 上传失败: ${cdnRes.status}`);
  }

  const downloadParam = cdnRes.headers.get("x-encrypted-param");
  if (!downloadParam) {
    throw new Error("CDN 响应缺少 x-encrypted-param");
  }

  // 3. Send file message
  log("发送文件消息...");
  await sendMessage({
    baseUrl: config.base_url,
    token: config.bot_token,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: userId,
        client_id: generateClientId(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{
          type: MessageItemType.FILE,
          file_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: Buffer.from(aeskey.toString("hex")).toString("base64"),
              encrypt_type: 1,
            },
            file_name: fileName,
            len: String(rawsize),
          },
        }],
        context_token: contextToken,
      },
    },
  });

  console.log(`已发送文件: ${fileName}`);
}

main().catch((err) => {
  console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
