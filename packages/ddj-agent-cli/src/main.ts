#!/usr/bin/env node

/**
 * DDJ Agent CLI - Interactive coding agent
 *
 * A terminal-based coding agent with tool calling, skills, sessions,
 * and multi-provider LLM support.
 */

import { Agent, builtinTools, connectMCPServers, disconnectMCPServers } from "@ddj-ai/agent-core";
import type { MCPConfig } from "@ddj-ai/agent-core";
import type {
  AgentEvent,
  AgentMessage,
  AgentAssistantMessage,
  AgentToolResultMessage,
  AgentTool,
} from "@ddj-ai/agent-core";
import { getModel, listProviders, listModels, getProviderApiKey, getProviderBaseUrl } from "@ddj-ai/core";
import type { ContentBlock, Model } from "@ddj-ai/core";

import { createInterface } from "node:readline/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import { exit } from "node:process";

/* ============================================================
 * Config paths
 * ============================================================ */

const HOME = process.env["HOME"] || process.env["USERPROFILE"] || ".";
const CONFIG_DIR = path.join(HOME, ".ddj");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");
const SKILLS_DIR = path.join(CONFIG_DIR, "skills");
const MCP_CONFIG_PATH = path.join(CONFIG_DIR, "mcp.json");

interface CliConfig {
  defaultProvider?: string;
  defaultModel?: string;
  sessionId?: string;
  /** API keys stored in config instead of env vars */
  apiKeys?: Record<string, string>;
}

function loadConfig(): CliConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function loadMCPConfig(): MCPConfig {
  try {
    if (fs.existsSync(MCP_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return { mcpServers: {} };
}

function saveConfig(config: CliConfig): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {}
}

/**
 * Merge API keys from config file into process.env.
 * Config keys take priority over existing env vars.
 */
function applyConfigApiKeys(config: CliConfig): void {
  const keyMap: Record<string, string> = {
    deepseek: "DEEPSEEK_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    minimax: "MINIMAX_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
  };

  if (!config.apiKeys) return;
  for (const [provider, key] of Object.entries(config.apiKeys)) {
    const envName = keyMap[provider];
    if (envName && key) {
      process.env[envName] = key;
    }
  }
}

/** Environment variable name for a given provider */
function getProviderEnvName(providerId: string): string {
  const map: Record<string, string> = {
    deepseek: "DEEPSEEK_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    minimax: "MINIMAX_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
  };
  return map[providerId] || `${providerId.toUpperCase()}_API_KEY`;
}

/* ============================================================
 * Colors
 * ============================================================ */

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

/* ============================================================
 * Skill loading
 * ============================================================ */

interface SkillInfo {
  name: string;
  description: string;
  content: string;
}

function loadSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];
  try {
    if (!fs.existsSync(SKILLS_DIR)) return skills;
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
        if (fs.existsSync(skillPath)) {
          const content = fs.readFileSync(skillPath, "utf-8");
          // Extract name and description from first line
          const firstLine = content.split("\n")[0] || entry.name;
          const name = firstLine.replace(/^#\s*/, "").trim() || entry.name;
          const description = content.split("\n").slice(1).find((l) => l.trim()) || "";
          skills.push({ name, description: description.replace(/^#+\s*/, "").trim(), content });
        }
      }
    }
  } catch {}
  return skills;
}

/* ============================================================
 * System prompt builder
 * ============================================================ */

function buildSystemPrompt(skills: SkillInfo[], workspaceRoot: string, mcpTools: AgentTool[] = []): string {
  const osInfo = process.platform === "win32"
    ? `Windows ${process.arch}`
    : `${process.platform} ${process.arch}`;

  const parts: string[] = [
    "You are DDJ, a fast AI coding agent. Tools: read, write, edit, bash, glob, grep.",
    "",
    `Workspace: ${workspaceRoot}`,
    `Platform: ${osInfo}`,
    "",
    "RULES:",
    "1. Act directly. Call tools immediately — never explain what you'll do before doing it.",
    "2. Prefer glob/grep to find files. Use bash for git, npm, and build commands.",
    "3. Write/edit files directly inside the workspace. Create parent directories as needed.",
    "4. Keep text responses short — brief summary after tools finish.",
    "5. When editing, use exact text match — verify uniqueness.",
  ];

  // Add MCP tool listing
  if (mcpTools.length > 0) {
    parts.push("");
    parts.push("## Available MCP Tools");
    for (const t of mcpTools) {
      parts.push(`- ${t.name}: ${t.description}`);
    }
  }

  // Add skill instructions
  if (skills.length > 0) {
    parts.push("");
    parts.push("## Loaded Skills");
    for (const skill of skills) {
      parts.push(`\n### ${skill.name}`);
      parts.push(skill.description || "(no description)");
      parts.push("```");
      parts.push(skill.content);
      parts.push("```");
    }
  }

  return parts.join("\n");
}

/* ============================================================
 * Display helpers
 * ============================================================ */

function write(text: string): void {
  process.stdout.write(text);
}

function writeln(text: string = ""): void {
  process.stdout.write(text + "\n");
}

function renderContent(content: ContentBlock[] | string): string {
  if (typeof content === "string") return content;
  return content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "toolCall") {
        return `\n${colors.dim}[Tool: ${b.name}]${colors.reset}\n${JSON.stringify(b.arguments, null, 2)}`;
      }
      return "";
    })
    .join("");
}

function renderToolResult(toolName: string, content: ContentBlock[]): string {
  const text = renderContent(content);
  const preview = text.length > 200 ? text.slice(0, 200) + "..." : text;
  return `${colors.dim}[Tool Result: ${toolName}]${colors.reset}\n${preview}`;
}

/* ============================================================
 * Session management
 * ============================================================ */

interface SessionData {
  id: string;
  modelId: string;
  provider: string;
  messages: AgentMessage[];
  startedAt: string;
  systemPrompt: string;
}

function listSessions(): SessionData[] {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    return files.map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8"));
        return {
          id: f.replace(".json", ""),
          modelId: data.modelId || "unknown",
          provider: data.provider || "unknown",
          messages: data.messages || [],
          startedAt: data.startedAt || "",
          systemPrompt: data.systemPrompt || "",
        };
      } catch {
        return {
          id: f.replace(".json", ""),
          modelId: "unknown",
          provider: "unknown",
          messages: [],
          startedAt: "",
          systemPrompt: "",
        };
      }
    });
  } catch {
    return [];
  }
}

function saveSession(
  id: string,
  model: Model,
  messages: AgentMessage[],
  systemPrompt: string
): void {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const data = {
      id,
      modelId: model.id,
      provider: model.provider,
      messages,
      startedAt: new Date().toISOString(),
      systemPrompt,
    };
    fs.writeFileSync(
      path.join(SESSIONS_DIR, `${id}.json`),
      JSON.stringify(data, null, 2)
    );
  } catch {}
}

function loadSession(id: string): SessionData | null {
  try {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/* ============================================================
 * Model selection UI
 * ============================================================ */

async function selectModel(rl: ReturnType<typeof createInterface>): Promise<Model | null> {
  const providers = listProviders();

  writeln(`\n${colors.bold}Available providers:${colors.reset}`);
  for (let i = 0; i < providers.length; i++) {
    writeln(`  ${colors.cyan}${i + 1}${colors.reset}. ${providers[i].label} (${providers[i].id})`);
  }

  const answer = await rl.question(`\nSelect provider (1-${providers.length}): `);
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= providers.length) {
    writeln(`${colors.red}Invalid selection${colors.reset}`);
    return null;
  }

  const providerId = providers[idx].id;
  const models = listModels(providerId);

  if (models.length === 0) {
    writeln(`${colors.red}No models available for ${providerId}${colors.reset}`);
    return null;
  }

  writeln(`\n${colors.bold}Available models for ${providerId}:${colors.reset}`);
  for (let i = 0; i < models.length; i++) {
    writeln(
      `  ${colors.cyan}${i + 1}${colors.reset}. ${models[i].label} ${models[i].supportsTools ? colors.green + "(tools)" + colors.reset : ""}`
    );
  }

  const modelAnswer = await rl.question(`\nSelect model (1-${models.length}): `);
  const modelIdx = parseInt(modelAnswer, 10) - 1;
  if (isNaN(modelIdx) || modelIdx < 0 || modelIdx >= models.length) {
    writeln(`${colors.red}Invalid selection${colors.reset}`);
    return null;
  }

  try {
    return getModel(providerId, models[modelIdx].id);
  } catch (err) {
    writeln(`${colors.red}${(err as Error).message}${colors.reset}`);
    return null;
  }
}

/* ============================================================
 * Display agent events (streaming) with Claude Code-style animations
 * ============================================================ */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerIdx = 0;
let currentSpinnerLabel = "";

// Track thinking state
let inThinkingBlock = false;
let thinkingHasContent = false;

// Track bash execution for summary display
let bashOutputSize = 0;
let bashStderrSize = 0;
let bashLastLines: string[] = [];

function startSpinner(label: string): void {
  stopSpinner();
  currentSpinnerLabel = label;
  spinnerIdx = 0;
  const frame = SPINNER_FRAMES[0];
  write(`  ${colors.cyan}${frame}${colors.reset} ${currentSpinnerLabel}`);
  spinnerTimer = setInterval(() => {
    const frame = SPINNER_FRAMES[spinnerIdx];
    process.stdout.write(
      `\r\x1b[0K  ${colors.cyan}${frame}${colors.reset} ${currentSpinnerLabel}`
    );
    spinnerIdx = (spinnerIdx + 1) % SPINNER_FRAMES.length;
  }, 100);
}

function stopSpinner(): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stdout.write(`\r\x1b[0K`);
  }
}

function displayEvent(event: AgentEvent): void {
  switch (event.type) {
    case "message_update": {
      const ev = event.assistantMessageEvent;
      if (ev.type === "thinking_start") {
        if (!inThinkingBlock) {
          inThinkingBlock = true;
          thinkingHasContent = false;
          writeln(`\n${colors.dim}  ╭─ Thinking…${colors.reset}`);
        }
      }
      if (ev.type === "thinking_delta") {
        thinkingHasContent = true;
        write(`${colors.dim}${ev.delta}${colors.reset}`);
      }
      if (ev.type === "thinking_end") {
        if (inThinkingBlock) {
          inThinkingBlock = false;
          if (thinkingHasContent) {
            writeln(`\n${colors.dim}  ╰─ done${colors.reset}\n`);
          }
        }
      }
      if (ev.type === "toolcall_start") {
        // Model is generating tool arguments — brief spinner
        startSpinner("Preparing…");
      }
      if (ev.type === "toolcall_end") {
        stopSpinner();
      }
      if (ev.type === "text_delta") {
        write(ev.delta);
      }
      break;
    }
    case "tool_execution_start": {
      bashOutputSize = 0;
      bashStderrSize = 0;
      bashLastLines = [];
      if (event.toolName === "bash") {
        startSpinner("bash running…");
      } else {
        startSpinner(`${event.toolName}…`);
      }
      break;
    }
    case "tool_execution_update": {
      const update = event.partialResult as { type?: string; text?: string } | undefined;
      if (update?.type === "stdout") {
        bashOutputSize += (update.text || "").length;
        // Keep last few lines for summary
        const lines = (update.text || "").split("\n").filter(Boolean);
        bashLastLines.push(...lines);
        if (bashLastLines.length > 6) bashLastLines = bashLastLines.slice(-6);
        // Update spinner label with progress
        currentSpinnerLabel = `bash running… ${(bashOutputSize / 1024).toFixed(1)}KB`;
      } else if (update?.type === "stderr") {
        bashStderrSize += (update.text || "").length;
      }
      break;
    }
    case "tool_execution_end": {
      stopSpinner();
      // Show bash summary
      if (event.toolName === "bash") {
        // Show last few lines of bash output as summary
        if (bashLastLines.length > 0) {
          const preview = bashLastLines.slice(-4).map((l) => l.slice(0, 120)).join("\n");
          writeln(`${colors.dim}  │${colors.reset} ${preview}`);
        }
        const sizeInfo = bashOutputSize > 0 ? ` ${(bashOutputSize / 1024).toFixed(1)}KB stdout` : "";
        const errInfo = bashStderrSize > 0 ? ` ${bashStderrSize}B stderr` : "";
        writeln(
          `${colors.dim}  ╰─${colors.reset}${colors.green} done${colors.reset}${colors.dim}${sizeInfo}${errInfo}${colors.reset}`
        );
      }
      break;
    }
    case "error": {
      stopSpinner();
      inThinkingBlock = false;
      bashOutputSize = 0;
      const msg = String(event.error);
      if (msg.includes("aborted") || msg.includes("timeout")) {
        writeln(`\n${colors.yellow}  ⚠ Request timed out. Try a simpler prompt or fewer tools.${colors.reset}`);
      } else {
        writeln(`\n${colors.red}  ✗ Error: ${msg.slice(0, 200)}${colors.reset}`);
      }
      break;
    }
    case "turn_end": {
      if (event.cumulativeUsage) {
        const u = event.cumulativeUsage;
        const totalK = (u.total / 1000).toFixed(1);
        writeln(`${colors.dim}  ╺ turn: ${u.input}↑ ${u.output}↓ tokens | total: ${totalK}k${colors.reset}`);
      }
      break;
    }
  }
}

/* ============================================================
 * Main CLI loop
 * ============================================================ */

async function main() {
  const config = loadConfig();

  // Apply API keys from config file (overrides env vars)
  applyConfigApiKeys(config);

  // Ensure directories exist
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  // Create skills directory with example if it doesn't exist
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    // Create example skill
    const exampleSkillDir = path.join(SKILLS_DIR, "example-skill");
    fs.mkdirSync(exampleSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(exampleSkillDir, "SKILL.md"),
      `# Example Skill\n\nThis is an example skill. Create skills by placing SKILL.md files in ~/.ddj/skills/<skill-name>/.\n`
    );
  }

  // Load skills
  const skills = loadSkills();

  // Workspace root for permission checks (captured before anything else)
  const workspaceRoot = path.resolve(process.cwd());

  // Connect MCP servers
  const mcpConfig = loadMCPConfig();
  let mcpState = await connectMCPServers(mcpConfig);
  if (mcpState.failures.length > 0) {
    for (const f of mcpState.failures) {
      writeln(`${colors.yellow}  ⚠ MCP: ${f}${colors.reset}`);
    }
  }

  // Build system prompt (with MCP tool info)
  let systemPrompt = buildSystemPrompt(skills, workspaceRoot, mcpState.tools);

  // Auto-scan project structure on startup
  let projectMap = "";  // from /scan
  const allFiles: string[] = [];
  function walkSync(dir: string) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walkSync(full);
      } else if (/\.(ts|js|json|md|html|css|py|rs|go|java|cpp|c|yaml|yml|toml|env)$/.test(e.name)) {
        allFiles.push(full);
      }
    }
  }
  walkSync(workspaceRoot);
  if (allFiles.length > 0) {
    const relFiles = allFiles.map(f => path.relative(workspaceRoot, f).replace(/\\/g, "/"));
    const allDirs = new Set(relFiles.map(f => f.split("/").slice(0, -1).join("/")).filter(Boolean));
    const pkgPath = path.join(workspaceRoot, "package.json");
    const pkgJson = (fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, "utf-8")) : null) as Record<string, unknown> | null;
    const projectName = pkgJson?.name || path.basename(workspaceRoot);
    projectMap = `Project: ${projectName}`;
    if (pkgJson?.version) projectMap += ` v${pkgJson.version}`;
    if (pkgJson?.description) projectMap += ` — ${pkgJson.description}`;
    projectMap += `\nRoot: ${workspaceRoot}`;
    const exts = new Map<string, number>();
    for (const f of relFiles) { const ext = f.split(".").pop() || "?"; exts.set(ext, (exts.get(ext) || 0) + 1); }
    const extInfo = [...exts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ext, n]) => `.${ext}:${n}`).join(" ");
    projectMap += `\nFiles: ${allFiles.length} (${extInfo}) in ${allDirs.size} dirs`;
    if (pkgJson?.dependencies) {
      projectMap += `\nDeps: ${Object.keys(pkgJson.dependencies as Record<string, unknown>).slice(0, 8).join(", ")}`;
    }
    systemPrompt = systemPrompt.replace("RULES:", `## Project Map\n${projectMap}\n\nRULES:`);
  }

  // Initial model selection
  let currentModel: Model;
  const savedProvider = config.defaultProvider || "deepseek";
  const savedModel = config.defaultModel || "deepseek-chat";

  // Check if saved model is available
  const availableModels = listModels(savedProvider);
  const modelExists = availableModels.some((m) => m.id === savedModel);

  // Check API key
  const apiKey = getProviderApiKey(savedProvider);
  if (!apiKey || apiKey === "") {
    writeln(`\n${colors.yellow}⚠ No API key found for ${savedProvider}${colors.reset}`);
    writeln(`  Set the ${getProviderEnvName(savedProvider)} environment variable.`);
    writeln(`  Alternatively, use /model to select a different provider.\n`);
  }

  if (modelExists && apiKey) {
    try {
      currentModel = getModel(savedProvider, savedModel);
      writeln(`\n${colors.green}✓${colors.reset} Using ${currentModel.label || currentModel.id}`);
    } catch {
      currentModel = getModel("deepseek", "deepseek-chat");
    }
  } else {
    try {
      currentModel = getModel("deepseek", "deepseek-chat");
    } catch {
      // Fallback - try first available model
      const providers = listProviders();
      if (providers.length > 0) {
        const models = listModels(providers[0].id);
        if (models.length > 0) {
          currentModel = getModel(providers[0].id, models[0].id);
        } else {
          throw new Error("No models available");
        }
      } else {
        throw new Error("No providers configured");
      }
    }
  }

  // Session tracking
  let sessionId = `session_${Date.now()}`;
  let autoSave = true;
  let thinkingLevel: import("@ddj-ai/core").ThinkingLevel = "low";
  let autoThink = true; // smart thinking scheduling

  // Smart thinking: analyze prompt and return best thinking level
  function analyzePromptComplexity(input: string): import("@ddj-ai/core").ThinkingLevel {
    const len = input.length;
    const hasChinese = /[一-鿿]/.test(input);

    // Keywords that signal high complexity
    const xhighKw = [/重构/, /架构/, /设计模式/, /深度分析/, /review/i, /安全漏洞/];
    const highKw = [/优化/, /改进/, /修复|bug|fix/i, /复杂/, /性能/, /并发/, /异步/];
    const mediumKw = [/多个文件/, /新建.*项目/, /创建.*应用/, /测试用例/, /部署/];

    for (const re of xhighKw) if (re.test(input)) return "xhigh";
    for (const re of highKw) if (re.test(input)) return "high";
    for (const re of mediumKw) if (re.test(input)) return "medium";

    // Long prompts (>200 chars) usually need more thinking
    if (len > 200) return "low";

    // Greetings and simple questions don't need thinking
    if (len < 15 && !/写|创建|生成|改|修|编|代码|文件|帮我/.test(input)) return "off";

    return "low";
  }

  // Welcome
  const c = colors;
  writeln(``);
  writeln(`${c.bold}${c.cyan}       ██████╗ ██████╗       ██╗${c.reset}`);
  writeln(`${c.bold}${c.cyan}       ██╔══██╗██╔══██╗      ██║${c.reset}`);
  writeln(`${c.bold}${c.cyan}       ██║  ██║██║  ██║      ██║${c.reset}`);
  writeln(`${c.bold}${c.cyan}       ██║  ██║██║  ██║ ██   ██║${c.reset}`);
  writeln(`${c.bold}${c.cyan}       ██████╔╝██████╔╝ ╚████╔╝${c.reset}`);
  writeln(`${c.bold}${c.cyan}       ╚═════╝ ╚═════╝   ╚═══╝ ${c.reset}`);
  writeln(``);
  writeln(`       ${c.bold}${c.magenta}Dream-Driven Journey${c.reset}  ${c.dim}v1.2.0${c.reset}`);
  writeln(`       ${c.dim}──────────────────────────────${c.reset}`);
  writeln(``);
  writeln(`  ${c.dim}▸${c.reset} Model    ${c.green}${currentModel.label || currentModel.id}${c.reset}`);
  writeln(`  ${c.dim}▸${c.reset} Think    ${c.yellow}${autoThink ? "auto" : thinkingLevel}${c.reset}`);
  writeln(`  ${c.dim}▸${c.reset} Workspace ${c.cyan}${workspaceRoot}${c.reset}`);
  writeln(`  ${c.dim}▸${c.reset} Skills   ${skills.length > 0 ? skills.map((s) => s.name).join(", ") : c.dim + "none" + c.reset}`);
  writeln(`  ${c.dim}▸${c.reset} Help     ${c.yellow}/help${c.reset}`);
  writeln(``);
  writeln(`  ${c.dim}✦${c.reset} Ask anything, I'll help you code.`);
  writeln(``);

  // Create readline interface
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Create the agent
  let agent = createAgent(currentModel, systemPrompt, thinkingLevel, workspaceRoot, rl, mcpState.tools);

  // Helper to submit a prompt
  async function submitPrompt(input: string): Promise<void> {
    // Smart thinking: auto-select level based on prompt complexity
    const effectiveLevel = autoThink ? analyzePromptComplexity(input) : thinkingLevel;

    agent = createAgent(currentModel, systemPrompt, effectiveLevel, workspaceRoot, rl, mcpState.tools);

    const unsubscribe = agent.subscribe((event) => {
      displayEvent(event);
    });

    try {
      await agent.prompt(input);
    } catch (err) {
      writeln(`\n${colors.red}Error:${colors.reset} ${(err as Error).message}`);
    } finally {
      unsubscribe();
      writeln(""); // newline after response

      // Auto-save session
      if (autoSave) {
        saveSession(sessionId, currentModel, agent.state.messages, systemPrompt);
      }
    }
  }

  // Main loop
  while (true) {
    const input = await rl.question(
      `${colors.cyan}┃${colors.reset} ${colors.bold}${colors.green}ddj${colors.reset}${colors.dim} ❯${colors.reset} `
    );

    if (!input.trim()) continue;

    // Command handling
    if (input.startsWith("/")) {
      const parts = input.slice(1).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      switch (cmd) {
        case "think":
        case "thinking": {
          const levels: Array<import("@ddj-ai/core").ThinkingLevel> = ["off", "minimal", "low", "medium", "high", "xhigh"];
          if (args.length > 0) {
            const idx = levels.indexOf(args[0] as import("@ddj-ai/core").ThinkingLevel);
            if (idx >= 0) {
              thinkingLevel = levels[idx];
              writeln(`${colors.green}✓${colors.reset} Thinking level set to ${thinkingLevel}`);
            } else {
              writeln(`${colors.red}Invalid level. Options: ${levels.join(", ")}${colors.reset}`);
            }
          } else {
            // Cycle to next level
            const idx = levels.indexOf(thinkingLevel);
            thinkingLevel = levels[(idx + 1) % levels.length];
            writeln(`${colors.green}✓${colors.reset} Thinking level: ${thinkingLevel}`);
          }
          break;
        }

        case "scan": {
          writeln(`${colors.yellow}  ⠋ Rescanning project…${colors.reset}`);
          try {
            // Re-run the scan
            const files: string[] = [];
            function reWalk(dir: string) {
              let entries;
              try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
              for (const e of entries) {
                if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) { reWalk(full); }
                else if (/\.(ts|js|json|md|html|css|py|rs|go|java|cpp|c|yaml|yml|toml|env)$/.test(e.name)) { files.push(full); }
              }
            }
            reWalk(workspaceRoot);

            if (files.length > 0) {
              const relFiles = files.map(f => path.relative(workspaceRoot, f).replace(/\\/g, "/"));
              const allDirs = new Set(relFiles.map(f => f.split("/").slice(0, -1).join("/")).filter(Boolean));
              const extInfo = [...new Map(relFiles.map(f => [f.split(".").pop() || "?"]).reduce((m, e) => m.set(e[0], (m.get(e[0]) || 0) + 1), new Map<string, number>())).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ext, n]) => `.${ext}:${n}`).join(" ");
              systemPrompt = buildSystemPrompt(skills, workspaceRoot, mcpState.tools);
              systemPrompt = systemPrompt.replace("RULES:", `## Project Map\n${projectMap}\n\nRULES:`);
              agent.state.systemPrompt = systemPrompt;
              writeln(`${colors.green}✓${colors.reset} Rescanned: ${files.length} files, ${allDirs.size} dirs`);
            } else {
              writeln(`${colors.yellow}  No files found${colors.reset}`);
            }
          } catch (e) {
            writeln(`${colors.red}✗ Scan failed: ${(e as Error).message}${colors.reset}`);
          }
          writeln("");
          break;
        }

        case "auto-think":
        case "autothink": {
          if (args[0] === "off") {
            autoThink = false;
            writeln(`${colors.green}✓${colors.reset} Auto-think disabled. Manual: ${thinkingLevel}`);
          } else {
            autoThink = true;
            writeln(`${colors.green}✓${colors.reset} Auto-think enabled. Current: ${analyzePromptComplexity("test") === "off" ? "auto" : thinkingLevel}`);
          }
          writeln("");
          break;
        }

        case "key":
        case "apikey": {
          if (args.length < 2) {
            writeln(`${colors.yellow}Usage: /key <provider> <api-key>${colors.reset}`);
            writeln(`  Providers: deepseek, openai, anthropic, minimax, google, groq`);
            writeln(`  Example: /key deepseek sk-xxxxxxxxxxxx`);
            writeln(`  Example: /key anthropic sk-ant-xxxxxxxxxxxx`);
            break;
          }
          const provider = args[0].toLowerCase();
          const apiKey = args.slice(1).join(" ");
          const validProviders = ["deepseek", "openai", "anthropic", "minimax", "google", "groq"];
          if (!validProviders.includes(provider)) {
            writeln(`${colors.red}Unknown provider: ${provider}${colors.reset}`);
            writeln(`  Valid: ${validProviders.join(", ")}`);
            break;
          }
          if (!config.apiKeys) config.apiKeys = {};
          config.apiKeys[provider] = apiKey;
          saveConfig(config);
          // Apply immediately
          const envName = getProviderEnvName(provider);
          process.env[envName] = apiKey;
          writeln(`${colors.green}✓${colors.reset} API key saved for ${provider}`);
          break;
        }

        case "quit":
        case "exit":
        case "q":
          writeln(`${colors.dim}Goodbye.${colors.reset}`);
          rl.close();
          exit(0);

        case "help":
        case "h":
          writeln(`\n${colors.bold}Commands:${colors.reset}`);
          writeln(`  ${colors.yellow}/model${colors.reset}         Select a different AI model`);
          writeln(`  ${colors.yellow}/new${colors.reset}           Start a new session`);
          writeln(`  ${colors.yellow}/session${colors.reset}       Show current session info`);
          writeln(`  ${colors.yellow}/skills${colors.reset}        List loaded skills`);
          writeln(`  ${colors.yellow}/mcp${colors.reset}           List MCP servers and tools`);
          writeln(`  ${colors.yellow}/save${colors.reset}          Save current session`);
          writeln(`  ${colors.yellow}/load <id>${colors.reset}     Load a previous session`);
          writeln(`  ${colors.yellow}/list${colors.reset}          List saved sessions`);
          writeln(`  ${colors.yellow}/clear${colors.reset}         Clear the terminal`);
          writeln(`  ${colors.yellow}/compact${colors.reset}       Compact conversation context`);
          writeln(`  ${colors.yellow}/think${colors.reset}         Toggle thinking mode (off/minimal/low/medium/high/xhigh)`);
          writeln(`  ${colors.yellow}/auto-think${colors.reset}    Smart auto-select thinking level`);
          writeln(`  ${colors.yellow}/scan${colors.reset}          Scan project structure into context`);
          writeln(`  ${colors.yellow}/key <provider> <key>${colors.reset}  Set API key for a provider (saved to config)`);
          writeln(`  ${colors.yellow}/help${colors.reset}          Show this help`);
          writeln(`  ${colors.yellow}/quit${colors.reset}          Exit the agent`);
          writeln(``);
          break;

        case "model":
        case "m": {
          const newModel = await selectModel(rl);
          if (newModel) {
            currentModel = newModel;
            config.defaultProvider = newModel.provider;
            config.defaultModel = newModel.id;
            saveConfig(config);
            writeln(`${colors.green}✓${colors.reset} Switched to ${newModel.label || newModel.id}`);
          }
          break;
        }

        case "new":
        case "n": {
          sessionId = `session_${Date.now()}`;
          agent = createAgent(currentModel, systemPrompt, thinkingLevel, workspaceRoot, rl, mcpState.tools);
          writeln(`${colors.green}✓${colors.reset} New session started`);
          break;
        }

        case "session":
        case "s":
          writeln(`\n${colors.bold}Session Info:${colors.reset}`);
          writeln(`  ID: ${colors.cyan}${sessionId}${colors.reset}`);
          writeln(`  Model: ${colors.green}${currentModel.label || currentModel.id}${colors.reset}`);
          writeln(`  Messages: ${agent.state.messages.length}`);
          writeln(`  Thinking: ${autoThink ? "auto" : thinkingLevel}`);
          writeln(`  Skills: ${skills.length > 0 ? skills.map((s) => s.name).join(", ") : "none"}`);
          writeln(``);
          break;

        case "mcp": {
          if (mcpState.clients.size === 0 && mcpState.failures.length === 0) {
            writeln(`${colors.yellow}No MCP servers configured.${colors.reset}`);
            writeln(`  Configure in ${colors.cyan}~/.ddj/mcp.json${colors.reset}`);
          } else {
            writeln(`\n${colors.bold}MCP Servers:${colors.reset}`);
            for (const [name, client] of mcpState.clients) {
              writeln(`  ${colors.green}✓${colors.reset} ${name} — ${client.tools.length} tools`);
            }
            for (const f of mcpState.failures) {
              writeln(`  ${colors.red}✗${colors.reset} ${f}`);
            }
            writeln(`  Total MCP tools: ${mcpState.tools.length}`);
          }
          writeln(``);
          break;
        }

        case "skills":
          if (skills.length === 0) {
            writeln(`${colors.yellow}No skills loaded.${colors.reset}`);
            writeln(`  Place SKILL.md files in ${colors.cyan}~/.ddj/skills/<name>/SKILL.md${colors.reset}`);
          } else {
            writeln(`\n${colors.bold}Loaded Skills:${colors.reset}`);
            for (const skill of skills) {
              writeln(`  ${colors.cyan}${skill.name}${colors.reset}`);
              if (skill.description) writeln(`    ${colors.dim}${skill.description}${colors.reset}`);
            }
            writeln(``);
          }
          break;

        case "save":
          saveSession(sessionId, currentModel, agent.state.messages, systemPrompt);
          writeln(`${colors.green}✓${colors.reset} Session saved: ${sessionId}`);
          break;

        case "load":
          if (args.length === 0) {
            writeln(`${colors.yellow}Usage: /load <session-id>${colors.reset}`);
          } else {
            const sessionData = loadSession(args[0]);
            if (sessionData) {
              try {
                currentModel = getModel(sessionData.provider, sessionData.modelId);
              } catch {
                writeln(`${colors.yellow}Model ${sessionData.modelId} not available, using current${colors.reset}`);
              }
              agent = createAgent(currentModel, systemPrompt, thinkingLevel, workspaceRoot, rl, mcpState.tools);
              agent.state.messages = sessionData.messages;
              sessionId = sessionData.id;
              writeln(`${colors.green}✓${colors.reset} Loaded session ${sessionId} (${sessionData.messages.length} messages)`);
            } else {
              writeln(`${colors.red}Session not found: ${args[0]}${colors.reset}`);
            }
          }
          break;

        case "list": {
          const sessions = listSessions();
          if (sessions.length === 0) {
            writeln(`${colors.yellow}No saved sessions.${colors.reset}`);
          } else {
            writeln(`\n${colors.bold}Saved Sessions:${colors.reset}`);
            for (const s of sessions.slice(0, 10)) {
              const date = s.startedAt ? new Date(s.startedAt).toLocaleString() : "unknown";
              writeln(`  ${colors.cyan}${s.id}${colors.reset}`);
              writeln(`    Model: ${s.provider}/${s.modelId} | Messages: ${s.messages.length} | ${date}`);
            }
          }
          break;
        }

        case "clear":
          write("\x1b[2J\x1b[H");
          break;

        case "compact": {
          writeln(`${colors.yellow}Compacting conversation...${colors.reset}`);
          const msgs = agent.state.messages;
          if (msgs.length > 10) {
            // Keep system message, first user message, and last 8 messages
            const kept = [
              ...msgs.slice(0, 2),
              ...msgs.slice(-8),
            ];
            agent.state.messages = kept;
            writeln(`${colors.green}✓${colors.reset} Compacted from ${msgs.length} to ${kept.length} messages`);
          } else {
            writeln(`${colors.yellow}Not enough messages to compact (need > 10)${colors.reset}`);
          }
          break;
        }

        default:
          writeln(`${colors.red}Unknown command: /${cmd}${colors.reset}`);
          writeln(`  Type ${colors.yellow}/help${colors.reset} for available commands`);
          break;
      }

      continue;
    }

    // Submit as prompt
    try {
      await submitPrompt(input);
    } catch (err) {
      writeln(`\n${colors.red}Error:${colors.reset} ${(err as Error).message}`);
    }
  }
}

/* ============================================================
 * Permission system
 * ============================================================ */

/** Check if a path is inside the workspace */
function isInsideWorkspace(targetPath: string, workspace: string): boolean {
  const resolved = path.resolve(targetPath);
  const normalizedWorkspace = path.resolve(workspace) + path.sep;
  return resolved.startsWith(normalizedWorkspace) || resolved === path.resolve(workspace);
}

/** Patterns that indicate dangerous shell commands */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /rm\s+-rf\s+\/(\*|\s|$)/, label: "rm -rf / (recursive delete root)" },
  { pattern: /rm\s+-rf\s+--no-preserve-root/, label: "rm -rf --no-preserve-root" },
  { pattern: /rm\s+-rf\s+\/dev\//, label: "rm -rf /dev/ (delete devices)" },
  { pattern: />\s*\/dev\/sd/, label: "write to raw disk device" },
  { pattern: />\s*\/dev\/nvme/, label: "write to raw NVMe device" },
  { pattern: /dd\s+if=.*of=\/dev\//, label: "dd to disk device" },
  { pattern: /mkfs\./, label: "mkfs (format filesystem)" },
  { pattern: /chmod\s+.*777\s+\//, label: "chmod 777 on root" },
  { pattern: /chown\s+-R\s+\//, label: "chown -R on root" },
  { pattern: /:\s*\(\)\s*\{\s*:\s*\|:\s*&\s*\}\s*;:/, label: "fork bomb" },
  { pattern: /curl\s+.*\|\s*(ba)?sh/, label: "curl pipe to shell" },
  { pattern: /wget\s+.*\|\s*(ba)?sh/, label: "wget pipe to shell" },
  { pattern: /git\s+push\s+--force.*(main|master)/, label: "git push --force to main/master" },
  { pattern: /sudo\s+rm\s+-rf/, label: "sudo rm -rf" },
  { pattern: /rm\s+-rf\s+.*\.git/, label: "rm -rf .git (delete git repo)" },
  { pattern: /rm\s+-rf\s+.*\.env/, label: "rm -rf .env files" },
];

function detectDangerousCommand(command: string): string | null {
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return label;
    }
  }
  return null;
}

/** Extract absolute paths from a command string (Windows + Unix) */
function extractAbsolutePaths(command: string): string[] {
  const paths: string[] = [];
  // Windows: D:\path, D:/path, D:path (any drive letter followed by colon)
  // Also handles quoted paths like "D:\path"
  const winRe = /([A-Za-z]:[\\\/][^\s"']*|[A-Za-z]:[^\s\\\/"']{2,})/g;
  // Unix absolute paths: /home/... /etc/... /d/... (but not flags like --xxx)
  const unixRe = /(?<!\w)\/(?:[^\s"']+\/)+[^\s"']*/g;
  let m;
  while ((m = winRe.exec(command)) !== null) {
    // Filter out things that look like URLs or flags
    const candidate = m[1];
    if (!/^[A-Za-z]:\/\//.test(candidate)) {
      paths.push(candidate);
    }
  }
  while ((m = unixRe.exec(command)) !== null) {
    const candidate = m[0];
    // Skip flags like --xxx/yyy
    if (!/^-[a-zA-Z]/.test(candidate)) {
      paths.push(candidate);
    }
  }
  return paths;
}

/** Check if a bash command is a write operation or navigates outside workspace */
function isWriteOrRiskyCommand(command: string): boolean {
  return /\b(mkdir|rm\b|rmdir|touch|mv |cp |copy |move |del |erase|dd|tee|chmod|chown|icacls|attrib|git\s+clone|git\s+init|npm\s+init|npm\s+install|pip\s+install|pip3\s+install|>\s*\S|>>\s*\S|cd\s+[A-Za-z]:|pushd\s+[A-Za-z]:|cd\s+\/|pushd\s+\/|New-Item|Set-Content|Out-File|npx\s+create)/i.test(command);
}

/** Split a bash command by && and ;, check each segment for paths */
async function checkAllCommandSegments(
  command: string,
  workspaceRoot: string
): Promise<string | null> {
  const segments = command.split(/&&|;/);
  for (const seg of segments) {
    if (isWriteOrRiskyCommand(seg)) {
      const absPaths = extractAbsolutePaths(seg);
      for (const p of absPaths) {
        if (!isInsideWorkspace(p, workspaceRoot)) {
          return p;
        }
      }
    }
    // Also check for cd to external location (the write might be in the next segment)
    const cdMatch = seg.match(/(?:cd|pushd)\s+(.+)/i);
    if (cdMatch) {
      const cdTarget = cdMatch[1].trim().replace(/^\/d\s+/, "");
      if (cdTarget && !isInsideWorkspace(cdTarget, workspaceRoot)) {
        return cdTarget;
      }
    }
    // Check for environment variables that expand to external paths
    if (/(?:%[A-Z]+:|%[A-Z]+%)/i.test(seg) && isWriteOrRiskyCommand(seg)) {
      return "(external env path)";
    }
  }
  return null;
}

/** Format confirmation prompt */
async function confirmAction(
  rl: ReturnType<typeof createInterface>,
  message: string
): Promise<boolean> {
  writeln(`\n${colors.yellow}  ⚠ ${message}${colors.reset}`);
  const answer = await rl.question(
    `  ${colors.dim}[Enter]${colors.reset} confirm  ${colors.dim}[n]${colors.reset} reject > `
  );
  writeln("");
  if (answer.toLowerCase() === "n") {
    writeln(`  ${colors.red}✗ Blocked${colors.reset}`);
    return false;
  }
  writeln(`  ${colors.green}✓ Confirmed${colors.reset}`);
  return true;
}

/* ============================================================
 * Agent factory
 * ============================================================ */

/** Rough token estimation: ~4 chars per token for mixed content */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: AgentMessage): number {
  return estimateTokens(JSON.stringify(msg));
}

function createAgent(
  model: Model,
  systemPrompt: string,
  thinkingLevel: import("@ddj-ai/core").ThinkingLevel = "low",
  workspaceRoot?: string,
  rl?: ReturnType<typeof createInterface>,
  mcpTools: AgentTool[] = []
): Agent {
  const MODEL_MAX_TOKENS = model.maxTokens || 128000;
  const COMPACT_THRESHOLD = Math.floor(MODEL_MAX_TOKENS * 0.6); // compact at 60%
  const KEEP_RECENT = 10;

  const allTools = [...(builtinTools as AgentTool[]), ...mcpTools];

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools: allTools,
      workspaceRoot,
    },
    beforeToolCall: !workspaceRoot ? undefined : async (params) => {
      const toolName = params.toolCall.name;
      const args = params.args;

      // --- Bash: dangerous command + path permission ---
      if (toolName === "bash") {
        const command = String(args.command || "");

        // 1. Check for dangerous patterns (always block unless confirmed)
        const dangerous = detectDangerousCommand(command);
        if (dangerous && rl) {
          const ok = await confirmAction(
            rl,
            `Dangerous command detected: ${dangerous}\n  Command: ${command.slice(0, 100)}`
          );
          if (!ok) {
            return { block: true, reason: `Blocked dangerous command: ${dangerous}` };
          }
        }

        // 2. Check cwd is inside workspace
        const cwd = args.cwd ? String(args.cwd) : undefined;
        if (cwd && !isInsideWorkspace(cwd, workspaceRoot) && rl) {
          const ok = await confirmAction(
            rl,
            `bash cwd outside workspace: ${cwd}`
          );
          if (!ok) {
            return { block: true, reason: "Blocked bash outside workspace" };
          }
        }

        // 3. Check for write/risky commands targeting paths outside workspace
        const externalPath = await checkAllCommandSegments(command, workspaceRoot);
        if (externalPath && rl) {
          const ok = await confirmAction(
            rl,
            `Write/risky command targets path outside workspace: ${externalPath}\n  Command: ${command.slice(0, 80)}`
          );
          if (!ok) {
            return {
              block: true,
              reason: `User rejected this operation. The user does NOT want you to create/modify files outside the workspace (${workspaceRoot}). Do NOT retry with different paths or approaches — respect the user's decision.`
            };
          }
        }

        return;
      }

      // --- Write/Edit: path permission check ---
      if (toolName === "write" || toolName === "edit") {
        const filePath = args.path ? String(args.path) : "";
        if (!filePath) return;

        if (!isInsideWorkspace(filePath, workspaceRoot) && rl) {
          const ok = await confirmAction(
            rl,
            `${toolName} target outside workspace: ${filePath}`
          );
          if (!ok) {
            return { block: true, reason: `Blocked ${toolName} outside workspace` };
          }
        }
        return;
      }
    },
    convertToLlm(messages: AgentMessage[]) {
      return messages
        .filter((m) =>
          m.role === "user" || m.role === "assistant" || m.role === "toolResult"
        )
        .map((m): import("@ddj-ai/core").Message => {
          if (m.role === "user") {
            const u = m as import("@ddj-ai/agent-core").AgentUserMessage;
            return {
              role: "user",
              content: u.content as string | ContentBlock[],
              timestamp: u.timestamp,
            };
          }
          if (m.role === "toolResult") {
            const r = m as import("@ddj-ai/agent-core").AgentToolResultMessage;
            return {
              role: "toolResult",
              toolCallId: r.toolCallId,
              toolName: r.toolName,
              content: r.content as ContentBlock[],
              isError: r.isError,
              timestamp: r.timestamp,
            };
          }
          const a = m as import("@ddj-ai/agent-core").AgentAssistantMessage;
          return {
            role: "assistant",
            content: a.content as ContentBlock[],
            stopReason: (a.stopReason || "stop") as import("@ddj-ai/core").StopReason,
            usage: a.usage as import("@ddj-ai/core").TokenUsage | undefined,
            timestamp: a.timestamp,
            reasoning_content: a.reasoning_content,
          } as import("@ddj-ai/core").Message;
        });
    },
    transformContext(messages: AgentMessage[]): AgentMessage[] {
      // Estimate total tokens
      let totalTokens = 0;
      for (const msg of messages) {
        totalTokens += estimateMessageTokens(msg);
      }
      totalTokens += estimateTokens(systemPrompt);

      if (totalTokens < COMPACT_THRESHOLD) return messages;

      // Compact: keep system prompt, first user message, and last KEEP_RECENT messages
      const firstUserIdx = messages.findIndex((m) => m.role === "user");
      const cutoff = messages.length - KEEP_RECENT;

      if (firstUserIdx < 0 || firstUserIdx >= cutoff) return messages;

      const kept: AgentMessage[] = [];
      kept.push(messages[firstUserIdx]); // original ask

      const removed = messages.length - KEEP_RECENT - 1;
      kept.push({
        role: "user",
        content: `[Context compacted: ${removed} messages removed to stay within token budget. Key work done so far is preserved in the remaining context.]`,
        timestamp: Date.now(),
      });

      kept.push(...messages.slice(-KEEP_RECENT));
      return kept;
    },
  });
}

/* ============================================================
 * Start
 * ============================================================ */

main().catch((err) => {
  console.error("Fatal error:", err);
  exit(1);
});
