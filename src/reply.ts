/**
 * Send a reply to a WeChat user and exit.
 * Usage: bun run src/reply.ts <userId> <contextToken> <text>
 */

import { loadConfig } from "./config.js";
import { sendReply } from "./send.js";

const args = process.argv.slice(2);
const userId = args[0];
const contextToken = args[1];
const text = args[2];

if (!userId || !contextToken || !text) {
  console.error("用法: bun run src/reply.ts <userId> <contextToken> <text>");
  process.exit(1);
}

const config = loadConfig();
if (!config?.bot_token) {
  console.error("请先运行 login 命令");
  process.exit(1);
}

await sendReply({ toUserId: userId, contextToken, text, config });
console.log("已发送");
