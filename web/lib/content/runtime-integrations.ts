import type { IconName } from "@/components/icon";
import { REPO_URL } from "@/lib/i18n/links";

export const REPO_BLOB_BASE = `${REPO_URL}/blob/main`;

interface Integration {
  name: string;
  icon: IconName;
  experimental?: boolean;
  desc: { en: string; zh: string };
  href: string;
}

export const INTEGRATIONS: Integration[] = [
  {
    name: "HTTP / SSE Runtime API",
    icon: "terminal",
    desc: {
      en: "Full local HTTP + Server-Sent Events runtime API on 127.0.0.1:7878. Create threads, stream turns, manage background jobs, and control approval decisions — all from any HTTP client or the bundled mobile page.",
      zh: "完整的本地 HTTP + Server-Sent Events Runtime API，监听 127.0.0.1:7878。创建线程、流式对话、管理后台任务、控制审批决策——任意 HTTP 客户端或内置手机页面皆可调用。",
    },
    href: `${REPO_BLOB_BASE}/docs/RUNTIME_API.md`,
  },
  {
    name: "ACP (Agent Client Protocol)",
    icon: "plug",
    desc: {
      en: "ACP stdio connects compatible editors to the existing Engine. It supports durable session creation, listing, loading, prompts, cancellation and model selection. Its local profile admits file/search/git/patch and foreground shell only with editor support and operator permission; MCP, dynamic tools and background jobs are unavailable.",
      zh: "ACP stdio 将兼容编辑器连接到现有 Engine，支持持久会话创建、列举、加载、提示、取消与模型选择。本地配置允许文件、搜索、git 和补丁；前台 shell 还需编辑器支持与操作者许可；MCP、动态工具与后台任务不可用。",
    },
    href: `${REPO_BLOB_BASE}/docs/RUNTIME_API.md`,
  },
  {
    name: "MCP (Model Context Protocol)",
    icon: "plug",
    desc: {
      en: "Connect Codewhale to external tools and services through configured MCP servers over stdio or HTTP/SSE, or expose read-only file_read and search to another MCP client by default.",
      zh: "通过已配置的 MCP 服务器（stdio 或 HTTP/SSE）将 Codewhale 连接到外部工具和服务，或默认向其他 MCP 客户端提供只读 file_read 与 search。",
    },
    href: `${REPO_BLOB_BASE}/docs/MCP.md`,
  },
  {
    name: "VS Code Extension",
    icon: "monitor",
    desc: {
      en: "Early companion for the local runtime. It can open Codewhale in a terminal, start and check the Runtime API, and show read-only thread summaries and restore points. It does not yet provide full chat, inline edits, or editor actions.",
      zh: "本地 Runtime 的早期配套扩展。它可以在终端中打开 Codewhale、启动并检查 Runtime API，以及显示只读线程摘要和还原点；目前尚不提供完整聊天、内联编辑或编辑器操作。",
    },
    href: "https://github.com/codewhale-hq/CodeWhale/tree/main/extensions/vscode",
  },
  {
    name: "CodeWhale GUI (VS Code)",
    icon: "monitor",
    desc: {
      en: "The community-maintained graphical frontend, in a separate repository: chat, threads, live file changes, and task tracking in a VS Code sidebar over this Runtime API. Install it from the VS Code Marketplace; the source is on GitHub.",
      zh: "社区维护的图形前端，位于独立仓库：在 VS Code 侧边栏中基于此 Runtime API 进行对话、管理线程、查看实时文件变更与任务进度。可从 VS Code Marketplace 安装；源码见 GitHub。",
    },
    href: "https://marketplace.visualstudio.com/items?itemName=HengQuWorld.brotherwhale-vscode",
  },
  {
    name: "Telegram Bridge",
    icon: "message",
    desc: {
      en: "First-party Telegram bot bridge. Start a headless Codewhale session, then chat with it from any Telegram client — approvals, tool results, and completions surface inline.",
      zh: "官方 Telegram 机器人桥接。启动无头 Codewhale 会话，在任何 Telegram 客户端中与之对话——审批、工具结果和完成状态内联展示。",
    },
    href: "https://github.com/codewhale-hq/CodeWhale/tree/main/integrations/telegram-bridge",
  },
  {
    name: "Feishu / Lark Bridge",
    icon: "message",
    desc: {
      en: "First-party Feishu / Lark bot bridge. Chat-native agent loop inside your Feishu workspace with approval messages, session linking, and audit trail.",
      zh: "官方飞书 / Lark 机器人桥接。在飞书工作区内实现聊天原生 Agent 循环，支持审批消息、会话关联和审计日志。",
    },
    href: "https://github.com/codewhale-hq/CodeWhale/tree/main/integrations/feishu-bridge",
  },
  {
    name: "Weixin Bridge",
    icon: "message",
    experimental: true,
    desc: {
      en: "Experimental Weixin / WeChat bridge. Receive agent completions and approvals inside WeChat; early-stage and not recommended for production deployments.",
      zh: "实验性微信桥接。在微信中接收 Agent 完成通知和审批；早期阶段，不建议用于生产环境。",
    },
    href: "https://github.com/codewhale-hq/CodeWhale/tree/main/integrations/weixin-bridge",
  },
];

export const TRUST = [
  {
    title: { en: "Runs on your machine", zh: "本机运行" },
    body: {
      en: "The Runtime API binds 127.0.0.1 by default. The local runtime does not require a Codewhale account or hosted relay.",
      zh: "Runtime API 默认仅监听 127.0.0.1。本地运行时不需要 Codewhale 账户或托管中继。",
    },
  },
  {
    title: { en: "Auth required", zh: "认证必需" },
    body: {
      en: "Runtime API routes (/v1/*) require a Bearer token. Pass --auth-token at startup or set CODEWHALE_RUNTIME_TOKEN. Only a loopback bind can turn this off, with --insecure-no-auth.",
      zh: "Runtime API 路由（/v1/*）需要 Bearer Token。启动时传入 --auth-token，或设置 CODEWHALE_RUNTIME_TOKEN 环境变量。仅在回环地址上可用 --insecure-no-auth 关闭认证。",
    },
  },
  {
    title: { en: "Permissions user-controlled", zh: "权限用户控制" },
    body: {
      en: "Remote clients submit requests and approval decisions through the authenticated Runtime API. Local mode, permission posture, and sandbox policy still apply.",
      zh: "远程客户端通过经过认证的 Runtime API 提交请求与审批决定。本地模式、权限姿态和沙箱策略仍然生效。",
    },
  },
  {
    title: { en: "Open protocols", zh: "开放协议" },
    body: {
      en: "The HTTP/SSE Runtime API, MCP surface, and ACP stdio transport serve different integration needs; choose the interface your compatible client supports.",
      zh: "HTTP/SSE Runtime API、MCP 和ACP stdio 传输分别服务于不同集成场景；请根据客户端需要选择对应接口。",
    },
  },
];

