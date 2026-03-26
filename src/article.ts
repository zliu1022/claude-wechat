/**
 * Fetch and extract article content from URLs (especially WeChat articles).
 */

import { log } from "./util.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_LENGTH = 30_000;

/** Extract readable text from HTML. */
function htmlToText(html: string): string {
  let text = html;
  // Remove script, style, nav, header, footer tags and their content
  text = text.replace(/<(script|style|nav|header|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Replace br and p tags with newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");
  text = text.replace(/<\/li>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Try to extract WeChat article content from the js_content div. */
function extractWechatArticle(html: string): string | null {
  // WeChat articles have content in <div id="js_content">
  const match = html.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (match) return htmlToText(match[1]);

  // Fallback: try class="rich_media_content"
  const match2 = html.match(/<div[^>]*class="rich_media_content"[^>]*>([\s\S]*?)<\/div>/i);
  if (match2) return htmlToText(match2[1]);

  return null;
}

/** Extract article title from HTML. */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]).trim() : "";
}

export async function fetchArticle(url: string): Promise<string> {
  log(`正在抓取文章: ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const title = extractTitle(html);
    const isWechat = url.includes("mp.weixin.qq.com");

    let content: string;
    if (isWechat) {
      content = extractWechatArticle(html) ?? htmlToText(html);
    } else {
      content = htmlToText(html);
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[内容已截断]";
    }

    const result = title ? `标题: ${title}\n\n${content}` : content;
    log(`文章抓取完成 (${result.length} 字符)`);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`抓取文章失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Check if a string contains a URL. */
export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/);
  return match ? match[0] : null;
}
