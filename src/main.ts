#!/usr/bin/env bun
/**
 * claude-channel: WeChat ↔ Claude Code bridge.
 *
 * Usage:
 *   bun run src/main.ts login          — 扫码登录微信
 *   bun run src/main.ts                — 启动桥接服务
 *   bun run src/main.ts allow <userId> — 添加用户到白名单
 */

import { loadConfig, saveConfig } from "./config.js";
import { login } from "./login.js";
import { startPolling } from "./poll.js";
import { log } from "./util.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

const args = process.argv.slice(2);
const command = args[0] ?? "run";

async function doLogin(): Promise<void> {
  const existing = loadConfig();
  const baseUrl = existing?.base_url ?? DEFAULT_BASE_URL;

  const result = await login(baseUrl);
  console.log(result.message);

  if (result.success && result.botToken) {
    const config = existing ?? {
      bot_token: "",
      base_url: DEFAULT_BASE_URL,
      allowed_users: [],
    };
    config.bot_token = result.botToken;
    if (result.baseUrl) config.base_url = result.baseUrl;
    if (result.userId && !config.allowed_users.includes(result.userId)) {
      config.allowed_users.push(result.userId);
      log(`已自动将扫码用户添加到白名单: ${result.userId}`);
    }
    saveConfig(config);
    log(`凭证已保存到 ~/.claude-channel/config.json`);
  }
}

async function doAllow(userId: string): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error("请先运行 login 命令。");
    process.exit(1);
  }
  if (config.allowed_users.includes(userId)) {
    console.log(`${userId} 已经在白名单中。`);
    return;
  }
  config.allowed_users.push(userId);
  saveConfig(config);
  console.log(`已添加 ${userId} 到白名单。`);
}

async function doRun(): Promise<void> {
  const config = loadConfig();
  if (!config?.bot_token) {
    console.error("请先运行 login 命令：bun run src/main.ts login");
    process.exit(1);
  }

  log("claude-channel 启动中...");
  log(`API: ${config.base_url}`);
  log(`白名单: ${config.allowed_users.length} 个用户`);
  console.log("\n按 Ctrl+C 停止\n");

  const controller = new AbortController();
  process.on("SIGINT", () => {
    log("收到 SIGINT，正在停止...");
    controller.abort();
  });
  process.on("SIGTERM", () => {
    log("收到 SIGTERM，正在停止...");
    controller.abort();
  });

  try {
    await startPolling(config, controller.signal);
  } catch (err) {
    if (err instanceof Error && err.message === "aborted") {
      log("已停止。");
    } else {
      throw err;
    }
  }
}

switch (command) {
  case "login":
    await doLogin();
    break;
  case "allow":
    if (!args[1]) {
      console.error("用法: bun run src/main.ts allow <userId>");
      process.exit(1);
    }
    await doAllow(args[1]);
    break;
  case "run":
    await doRun();
    break;
  default:
    console.error(`未知命令: ${command}`);
    console.error("可用命令: login, run, allow <userId>");
    process.exit(1);
}
