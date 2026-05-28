# DDJ Agent — Dream-Driven Journey

```
       ██████╗ ██████╗       ██╗
       ██╔══██╗██╔══██╗      ██║
       ██║  ██║██║  ██║      ██║
       ██║  ██║██║  ██║ ██   ██║
       ██████╔╝██████╔╝ ╚████╔╝
       ╚═════╝ ╚═════╝   ╚═══╝
```

**DeepSeek-first AI coding agent** — 专为 DeepSeek V4 深度优化的终端 AI 编程助手。1M 上下文、流式思考、MCP 协议、智能权限控制。

## 亮点

- **DeepSeek 深度适配** — 独立 Provider，完整支持 reasoning_content、reasoning_effort (high/max)、1M 上下文
- **流式思考可见** — 实时展示 DeepSeek 推理过程，不再是黑盒
- **MCP 协议** — 兼容 Claude Code 生态，一键接入社区几百个工具
- **Claude Code 风格动效** — 旋转动画、bash 流式输出、思考阶段边界
- **智能权限控制** — 工作区隔离 + 15 条危险命令检测 + cd 绕过拦截
- **自动上下文管理** — 项目扫描注入 + 智能压缩 + Token 实时追踪
- **多 Provider 兼容** — 同时支持 OpenAI、Anthropic、Groq、Ollama 等

## 快速开始

### 环境

- Node.js >= 18
- DeepSeek API Key（或其他 Provider Key）

### 安装

```bash
git clone https://github.com/Favorjj/DDJ-agent.git
cd DDJ-agent
npm install && npm run build
npm link -w @ddj-ai/cli
```

### 设置 API Key

```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxx
# 或者进入 CLI 后
/key deepseek sk-xxxxxxxx
```

### 启动

```bash
ddj
```

启动后自动扫描当前项目结构注入上下文，模型一上来就了解代码全貌。

## 使用

```
┃ ddj ❯ 帮我优化一下 agent.ts 的错误处理

  ╭─ Thinking…                    ← 思考过程实时可见
  需要分析当前的错误处理机制...
  ╰─ done

  ⠹ bash running… 12.3KB          ← 工具执行动画

  │ 优化完成，改动如下：            ← 结果
  ╰─ done
  ╺ turn: 4500↑ 1200↓ tokens | total: 5.7k
```

### 命令列表

| 命令 | 说明 |
|------|------|
| `/think <level>` | 思维深度：off/minimal/low/medium/high/xhigh |
| `/auto-think` | 智能自动选档（默认开启） |
| `/scan` | 扫描项目结构注入上下文 |
| `/model` | 切换 AI 模型 |
| `/mcp` | 查看 MCP Server 和工具 |
| `/new` | 新会话 |
| `/session` | 会话信息 |
| `/save` / `/load` | 保存/加载会话 |
| `/compact` | 压缩上下文 |
| `/skills` | 已加载技能 |
| `/key <p> <k>` | 设置 API Key |
| `/help` | 帮助 |
| `/quit` | 退出 |

## 支持的 Provider

| Provider | 模型 | 适配深度 |
|----------|------|---------|
| **DeepSeek** | V4 Pro, V4 Flash | **头等公民** — 独立 Provider，思考/1M 上下文/MCP 全适配 |
| Anthropic | Claude Sonnet 4, 3.5 Sonnet/Haiku | 完整支持（含 thinking） |
| OpenAI | GPT-4o, GPT-4o Mini, o4-mini | OpenAI 兼容协议 |
| Google | Gemini 2.0 Flash, 2.5 Flash | OpenAI 兼容协议 |
| Groq | Llama 3.3 70B, Mixtral 8x7B | OpenAI 兼容协议 |
| Ollama | Llama 3.2, Qwen 2.5 | 本地模型，OpenAI 兼容协议 |
| MiniMax | MiniMax Text 01 | OpenAI 兼容协议 |

## MCP 工具生态

编辑 `~/.ddj/mcp.json`（标准 MCP 配置格式）：

```json
{
  "mcpServers": {
    "calculator": {
      "command": "node",
      "args": ["D:/DDJ-agent/scripts/calculator-mcp-server.cjs"]
    },
    "docx": {
      "command": "node",
      "args": ["D:/DDJ-agent/scripts/docx-mcp-server.cjs"]
    }
  }
}
```

重启 `ddj`，`/mcp` 查看已连接工具。内置 7 个工具 + MCP 可无限扩展。

## 内置工具

| 工具 | 功能 |
|------|------|
| read | 读文件（支持行范围） |
| write | 写文件（自动建目录） |
| edit | 搜索替换编辑 |
| bash | Shell 命令（流式输出 + 权限控制） |
| glob | 文件模式匹配 |
| grep | 正则搜索（ripgrep 加速，自动回退） |
| webfetch | 网页抓取 |

## 项目结构

```
packages/
├── ddj-ai/                 # AI 模型抽象层
│   └── src/
│       ├── types.ts        # 核心类型
│       ├── models.ts       # Provider/模型注册
│       ├── stream.ts       # 统一流式分发
│       └── providers/
│           ├── deepseek.ts  # DeepSeek 独立优化
│           ├── anthropic.ts # Claude
│           └── openai-compatible.ts # OpenAI/others
├── ddj-agent-core/         # Agent 核心
│   └── src/
│       ├── agent.ts        # ReAct 循环
│       ├── event-stream.ts
│       ├── mcp/            # MCP 客户端/桥接
│       └── tools/          # 7 个内置工具
├── ddj-agent-cli/          # 终端 UI
│   └── src/main.ts
└── scripts/                # MCP Server 示例
    ├── calculator-mcp-server.cjs
    └── docx-mcp-server.cjs
```

## License

MIT
