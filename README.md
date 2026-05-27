# DDJ Agent — Dream-Driven Journey

```
       ██████╗ ██████╗       ██╗
       ██╔══██╗██╔══██╗      ██║
       ██║  ██║██║  ██║      ██║
       ██║  ██║██║  ██║ ██   ██║
       ██████╔╝██████╔╝ ╚████╔╝
       ╚═════╝ ╚═════╝   ╚═══╝
```

A terminal-based AI coding agent with streaming thinking, multi-provider LLM support, and extensible tools. Built with TypeScript.

## Features

- **Multi-provider support** — DeepSeek V4, Claude, GPT-4o, Gemini, Groq, Ollama, and more
- **Streaming thinking** — see the model's reasoning process in real-time (DeepSeek/Claude)
- **Extensible tools** — built-in: bash, read, write, edit; add your own
- **Skill system** — load custom SKILL.md files for specialized behavior
- **Session persistence** — save and resume conversations
- **Cross-platform** — Windows, macOS, Linux

## Quick Start

### Prerequisites

- Node.js >= 18
- An API key from one of the supported providers

### Install

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/ddjs.git
cd ddjs

# Install & build
npm install
npm run build

# Link globally (so 'ddj' works from anywhere)
npm link -w @ddj-ai/cli
```

### Set API Key

```bash
# Option 1: Environment variable
export DEEPSEEK_API_KEY=sk-xxxxxxxx

# Option 2: Use the built-in /key command inside the CLI
/key deepseek sk-xxxxxxxx
```

### Run

```bash
ddj
```

On first launch, you'll see the welcome screen where you can select a provider and model.

## Usage

```
┃ ddj ❯ What files are in this directory?

  ╭─ Thinking…
  <reasoning process visible here>
  ╰─ (thinking done)

  Here are the files in your current directory:
  ...

┃ ddj ❯
```

### Commands

| Command | Description |
|---------|-------------|
| `/model` | Select a different AI model |
| `/think <level>` | Set thinking depth (off/minimal/low/medium/high) |
| `/new` | Start a new session |
| `/session` | Show current session info |
| `/save` | Save current session |
| `/load <id>` | Load a previous session |
| `/list` | List saved sessions |
| `/compact` | Compact conversation context |
| `/skills` | List loaded skills |
| `/key <provider> <key>` | Set API key for a provider |
| `/help` | Show help |
| `/quit` | Exit |

## Supported Providers

| Provider | Models |
|----------|--------|
| DeepSeek | V4 Pro, V4 Flash |
| Anthropic | Claude Sonnet 4, Claude 3.5 Sonnet/Haiku |
| OpenAI | GPT-4o, GPT-4o Mini, o4-mini |
| Google | Gemini 2.0 Flash, Gemini 2.5 Flash |
| Groq | Llama 3.3 70B, Mixtral 8x7B |
| Ollama | Llama 3.2, Qwen 2.5 (local) |
| MiniMax | MiniMax Text 01 |

## Custom Skills

Create markdown files in `~/.ddj/skills/<skill-name>/SKILL.md`:

```markdown
# My Skill

You are an expert in Python. Always use type hints and docstrings.
```

Skills are automatically loaded and injected into the system prompt on startup.

## Project Structure

```
packages/
├── ddj-ai/              # AI model abstraction layer
│   └── src/
│       ├── types.ts     # Core types (Message, ContentBlock, etc.)
│       ├── models.ts    # Provider/model registry
│       ├── stream.ts    # Unified streaming dispatcher
│       └── providers/
│           ├── anthropic.ts
│           └── openai-compatible.ts
├── ddj-agent-core/      # Agent loop & tool execution
│   └── src/
│       ├── agent.ts     # Main Agent class (ReAct loop)
│       ├── event-stream.ts
│       └── tools/       # bash, read, write, edit
└── ddj-agent-cli/       # Terminal UI
    └── src/main.ts      # CLI entry point
```

## License

MIT
