/**
 * QR code login flow for WeChat iLink Bot API.
 */

import { log } from "./util.js";

const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH = 3;

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

export interface LoginResult {
  success: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  message: string;
}

async function fetchQRCode(apiBaseUrl: string): Promise<QRCodeResponse> {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = `${base}ilink/bot/get_bot_qrcode?bot_type=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch QR code: ${res.status}`);
  return (await res.json()) as QRCodeResponse;
}

async function pollQRStatus(apiBaseUrl: string, qrcode: string): Promise<StatusResponse> {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = `${base}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`QR status poll failed: ${res.status}`);
    return (await res.json()) as StatusResponse;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" };
    }
    throw err;
  }
}

export async function login(apiBaseUrl: string): Promise<LoginResult> {
  log("正在获取二维码...");
  let qr = await fetchQRCode(apiBaseUrl);
  let refreshCount = 1;

  console.log(`\n请用微信扫描以下链接中的二维码：\n${qr.qrcode_img_content}\n`);

  const deadline = Date.now() + 5 * 60_000;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(apiBaseUrl, qr.qrcode);

    switch (status.status) {
      case "wait":
        break;
      case "scaned":
        if (!scannedPrinted) {
          log("已扫码，请在微信上确认...");
          scannedPrinted = true;
        }
        break;
      case "expired":
        refreshCount++;
        if (refreshCount > MAX_QR_REFRESH) {
          return { success: false, message: "二维码多次过期，请重试。" };
        }
        log(`二维码已过期，正在刷新 (${refreshCount}/${MAX_QR_REFRESH})...`);
        qr = await fetchQRCode(apiBaseUrl);
        console.log(`\n新二维码：\n${qr.qrcode_img_content}\n`);
        scannedPrinted = false;
        break;
      case "confirmed":
        if (!status.bot_token) {
          return { success: false, message: "登录失败：服务器未返回 token。" };
        }
        return {
          success: true,
          botToken: status.bot_token,
          accountId: status.ilink_bot_id,
          baseUrl: status.baseurl,
          userId: status.ilink_user_id,
          message: "登录成功！",
        };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { success: false, message: "登录超时，请重试。" };
}
