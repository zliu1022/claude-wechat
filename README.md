# claude-channel

微信 - Claude Code 桥接插件。从微信发消息，Claude Code 在你的 Mac 上处理并回复。

## 功能

- 微信文字消息收发
- 微信图片接收与识别（自动解密 CDN 加密图片）
- 公众号文章链接抓取与分析
- Claude Code 全能力处理（联网搜索、文件操作、代码执行等）
- 生成 HTML 报告并作为文件附件发回微信
- 连续对话（有上下文记忆）

## 前提条件

- **macOS** + **Claude Code CLI**（需 Pro/Max/Team/Enterprise 订阅）
- **微信 iOS 8.0.70+**（设置 → 插件 → 已有"微信ClawBot"）
- **Bun** 运行时

## 安装

### 1. 安装 Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. 安装插件

```bash
# 在 Claude Code 里运行
/plugin marketplace add zliu1022/claude-wechat
/plugin install wechat@zliu-claude-channel
/reload-plugins
```

或本地开发模式：

```bash
git clone https://github.com/zliu1022/claude-wechat.git
claude --plugin-dir ./claude-channel
```

### 3. 扫码登录微信

```bash
cd claude-channel  # 或插件安装目录
bun run src/main.ts login
```

终端显示链接，浏览器打开后用微信扫码确认。凭证保存到 `~/.claude-channel/config.json`。

## 使用

在 Claude Code 里输入：

```
/wechat
```

Claude 会自动启动微信消息桥接。从微信发消息，Claude 收到后用全部能力处理并回复。

### 微信端命令

| 命令 | 说明 |
|------|------|
| `/new` | 开始新对话（清除上下文） |
| `/help` | 显示帮助 |

## 工作原理

```
微信 (iPhone)
    ↓ 发送消息
腾讯 iLink Bot API (官方)
    ↓ 长轮询
你的 Mac (wait.ts 后台等待)
    ↓ 收到消息，退出，通知 Claude Code
Claude Code (当前会话处理)
    ↓ 调用 reply.ts / send-file.ts
腾讯 iLink Bot API
    ↓
微信 (iPhone) 收到回复
```

核心机制：利用 Claude Code 的**后台任务完成通知**作为消息推送。`wait.ts` 在后台长轮询微信消息，收到一条后打印并退出，Claude Code 自动收到通知并处理。

## 安全

- 使用腾讯官方 iLink Bot API（非逆向协议）
- 微信扫码认证（非密码登录）
- 凭证文件 chmod 0600
- 白名单机制
- 零 npm 依赖
- 符合微信 ClawBot 使用条款

## 项目结构

```
claude-channel/
├── .claude-plugin/        # 插件元数据
├── skills/wechat/         # /wechat 技能定义
├── src/
│   ├── main.ts            # CLI: login / run / allow
│   ├── wait.ts            # 等待一条微信消息（后台任务模式）
│   ├── reply.ts           # 发送文字回复
│   ├── send-file.ts       # 发送文件附件
│   ├── api.ts             # iLink Bot HTTP 客户端
│   ├── login.ts           # 扫码登录
│   ├── poll.ts            # 长轮询循环（自动模式）
│   ├── handler.ts         # 消息处理管道（自动模式）
│   ├── claude.ts          # Claude CLI 调用（自动模式）
│   ├── article.ts         # 文章抓取
│   ├── send.ts            # 回复发送
│   ├── config.ts          # 凭证管理
│   ├── types.ts           # 协议类型
│   └── util.ts            # 工具函数
└── reports/               # 生成的报告输出目录
```

## 许可

MIT
