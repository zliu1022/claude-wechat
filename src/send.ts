/**
 * Send reply messages back to WeChat.
 */

import { sendMessage } from "./api.js";
import { MessageType, MessageState, MessageItemType } from "./types.js";
import type { Config } from "./types.js";
import { generateClientId, chunkText, log } from "./util.js";

const TEXT_CHUNK_LIMIT = 4000;

export async function sendReply(params: {
  toUserId: string;
  contextToken: string;
  text: string;
  config: Config;
}): Promise<void> {
  const { toUserId, contextToken, text, config } = params;
  const chunks = chunkText(text, TEXT_CHUNK_LIMIT);

  for (const chunk of chunks) {
    await sendMessage({
      baseUrl: config.base_url,
      token: config.bot_token,
      body: {
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: generateClientId(),
          message_type: MessageType.BOT,
          message_state: MessageState.FINISH,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text: chunk } }],
          context_token: contextToken,
        },
      },
    });
  }
  log(`回复已发送给 ${toUserId.slice(0, 8)}... (${chunks.length} 条)`);
}
