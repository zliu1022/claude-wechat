/**
 * Message processing: extract text/URL from WeChat message → call Claude (streaming) → reply.
 */

import type { WeixinMessage, Config } from "./types.js";
import { MessageItemType } from "./types.js";
import { fetchArticle, extractUrl } from "./article.js";
import { callClaude, newSessionId } from "./claude.js";
import { sendReply } from "./send.js";
import { saveContextTokens, saveSessions } from "./config.js";
import { log } from "./util.js";

/** Extract text body from a WeChat message's item_list. */
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

/** Handle slash commands. Returns true if the message was a command. */
function handleCommand(
  text: string,
  fromUser: string,
  sessions: Map<string, string>,
): { isCommand: boolean; reply?: string } {
  const cmd = text.trim().toLowerCase();

  if (cmd === "/new" || cmd === "/reset") {
    sessions.delete(fromUser);
    saveSessions(sessions);
    return { isCommand: true, reply: "已开始新对话，之前的上下文已清除。" };
  }

  if (cmd === "/session") {
    const sid = sessions.get(fromUser);
    if (sid) {
      return { isCommand: true, reply: `当前会话: ${sid}` };
    }
    return { isCommand: true, reply: "当前没有活跃会话，发消息即可开始。" };
  }

  if (cmd === "/help") {
    return {
      isCommand: true,
      reply: [
        "可用命令:",
        "/new — 开始新对话（清除历史）",
        "/session — 查看当前会话 ID",
        "/help — 显示此帮助",
        "",
        "直接发文字或文章链接即可对话，支持连续上下文。",
      ].join("\n"),
    };
  }

  return { isCommand: false };
}

export async function handleMessage(
  msg: WeixinMessage,
  config: Config,
  contextTokens: Map<string, string>,
  sessions: Map<string, string>,
): Promise<void> {
  const fromUser = msg.from_user_id ?? "";
  const contextToken = msg.context_token ?? "";
  const text = extractText(msg);

  if (!text) {
    log(`收到非文本消息，跳过 (from: ${fromUser.slice(0, 8)}...)`);
    return;
  }

  // Persist context token
  if (contextToken) {
    contextTokens.set(fromUser, contextToken);
    saveContextTokens(contextTokens);
  }

  log(`收到消息 (from: ${fromUser.slice(0, 8)}...): ${text.slice(0, 80)}...`);

  // Check for slash commands
  const { isCommand, reply: cmdReply } = handleCommand(text, fromUser, sessions);
  if (isCommand) {
    const ct = contextTokens.get(fromUser) ?? contextToken;
    if (cmdReply) {
      await sendReply({ toUserId: fromUser, contextToken: ct, text: cmdReply, config });
    }
    return;
  }

  try {
    // Check for URL → fetch article content
    const url = extractUrl(text);
    let prompt: string;

    if (url) {
      try {
        const article = await fetchArticle(url);
        const userText = text.replace(url, "").trim();
        if (userText) {
          prompt = `用户发来了一篇文章，并附带指示："${userText}"\n\n文章内容如下：\n\n${article}`;
        } else {
          prompt = `用户发来了一篇文章，请阅读并生成一份简要分析报告，包括：主要观点、关键信息、以及你的评价。\n\n文章内容如下：\n\n${article}`;
        }
      } catch (err) {
        prompt = text;
        log(`文章抓取失败，使用原始文本: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      prompt = text;
    }

    // Resolve or create session for this user
    let sessionId = sessions.get(fromUser);
    let isNewSession = false;
    if (!sessionId) {
      sessionId = newSessionId();
      isNewSession = true;
      sessions.set(fromUser, sessionId);
      saveSessions(sessions);
    }

    const ct = contextTokens.get(fromUser) ?? contextToken;
    let chunkIndex = 0;

    const response = await callClaude({
      prompt,
      sessionId,
      isNewSession,
      onChunk: async (chunk, isFinal) => {
        if (!chunk && isFinal) return; // no-op completion signal
        chunkIndex++;
        log(`流式片段 #${chunkIndex} (${chunk.length} 字符, final=${isFinal})`);
        await sendReply({
          toUserId: fromUser,
          contextToken: ct,
          text: chunk,
          config,
        });
      },
    });

    // If no chunks were sent (e.g. short response), send the full result
    if (chunkIndex === 0 && response) {
      await sendReply({
        toUserId: fromUser,
        contextToken: ct,
        text: response,
        config,
      });
    }
  } catch (err) {
    const errMsg = `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`;
    log(errMsg);
    try {
      const ct = contextTokens.get(fromUser) ?? contextToken;
      await sendReply({
        toUserId: fromUser,
        contextToken: ct,
        text: `⚠️ ${errMsg}`,
        config,
      });
    } catch {
      log("发送错误消息也失败了");
    }
  }
}
