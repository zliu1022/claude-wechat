/**
 * WeChat iLink Bot API protocol types.
 * Adapted from @tencent-weixin/openclaw-weixin.
 */

export interface BaseInfo {
  channel_version?: string;
}

export const MessageType = {
  USER: 1,
  BOT: 2,
} as const;

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export interface TextItem {
  text?: string;
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  len?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  // Some API responses may include a direct CDN URL
  url?: string;
  width?: number;
  height?: number;
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  voice_item?: { text?: string };
  image_item?: ImageItem;
  file_item?: FileItem;
  ref_msg?: { title?: string; message_item?: MessageItem };
}

export interface WeixinMessage {
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface Config {
  bot_token: string;
  base_url: string;
  allowed_users: string[];
}
