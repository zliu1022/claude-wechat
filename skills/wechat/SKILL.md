---
name: wechat
description: "Start WeChat message bridge — receive messages from WeChat and reply. Use when the user says /wechat, 'start wechat', '启动微信', '微信消息', or wants to receive/reply to WeChat messages."
---

# WeChat Message Bridge

You are managing a WeChat-to-Claude Code bridge. This allows the user to send messages from their phone (WeChat) and have you process them with your full capabilities.

## Prerequisites

Before starting, verify:
1. Bun is installed: run `which bun`
2. WeChat login exists: check if `~/.claude-channel/config.json` exists
3. If not logged in, tell the user to run `bun run src/main.ts login` in the plugin directory first

## How It Works

The bridge uses a background task notification mechanism:
- `src/wait.ts` long-polls WeChat for messages, prints the first message as JSON, then exits
- When it exits, you get notified automatically
- You read the message, process it, reply, then start waiting again

## Starting the Bridge

Run this command in the background:

```
bun run ${CLAUDE_PLUGIN_ROOT}/src/wait.ts
```

Tell the user: "微信桥接已启动，等待消息中。你可以从微信发消息给我了。"

## When You Receive a Message

The background task will complete and you'll be notified. Read the output file — it contains one line of JSON:

```json
{"from": "user_id@im.wechat", "text": "message content", "context_token": "..."}
```

For image messages, `image_paths` is also included:

```json
{"from": "user_id@im.wechat", "text": "[图片]", "context_token": "...", "image_paths": ["/Users/xxx/.claude-channel/images/img_1234.jpg"]}
```

### Processing Steps

1. **Read the message** from the output file
2. **Check for commands**:
   - `/new` or `/reset` → reply "已开始新对话" (no processing needed)
   - `/help` → reply with help text
3. **Check for images**: If `image_paths` is present, use the Read tool to view each image file path. You are a multimodal model and can analyze images directly.
4. **Check for URLs** in the text:
   - If the message contains a URL, fetch the article content and analyze it
   - For WeChat article URLs (`mp.weixin.qq.com`), the content is usually in `<div id="js_content">`
5. **Process the message** using your full capabilities (search, read files, write code, generate reports, etc.)
6. **Reply** to WeChat using the reply command
7. **Restart** the wait loop

## Replying to Messages

### Text Reply

```
bun run ${CLAUDE_PLUGIN_ROOT}/src/reply.ts "<from>" "<context_token>" "<your reply text>"
```

All three arguments are required:
- `from`: the user ID from the received message
- `context_token`: the context_token from the received message (MUST be echoed back)
- Text: your reply (will be auto-chunked if > 4000 chars)

### File Attachment

To send a file (HTML report, etc.):

```
bun run ${CLAUDE_PLUGIN_ROOT}/src/send-file.ts "<from>" "<context_token>" "<file_path>"
```

## Restarting the Wait Loop

After replying, ALWAYS restart the background wait:

```
bun run ${CLAUDE_PLUGIN_ROOT}/src/wait.ts
```

Run this in the background so you get notified when the next message arrives.

## Important Notes

- **Always reply before restarting wait** — the user is waiting for your response
- **Always restart wait after replying** — otherwise you'll miss the next message
- **context_token is required** — WeChat API requires it for routing; always pass it from the received message
- **Text limit is 4000 chars** per message — the reply script handles chunking automatically
- **You have full capabilities** — unlike `claude -p`, you can search the web, read/write files, execute code, generate reports, etc.
- **Run wait.ts and reply/send-file in the project directory or use absolute paths**

## Example Flow

1. User types `/wechat`
2. You run `bun run ${CLAUDE_PLUGIN_ROOT}/src/wait.ts` in background
3. User sends "帮我分析这篇文章 https://mp.weixin.qq.com/s/xxx" from WeChat
4. Background task completes, you read the output
5. You fetch the article URL, analyze it, maybe generate an HTML report
6. You run `bun run ${CLAUDE_PLUGIN_ROOT}/src/reply.ts "userId" "token" "分析结果..."`
7. Optionally: `bun run ${CLAUDE_PLUGIN_ROOT}/src/send-file.ts "userId" "token" "report.html"`
8. You run `bun run ${CLAUDE_PLUGIN_ROOT}/src/wait.ts` in background again
9. Repeat
