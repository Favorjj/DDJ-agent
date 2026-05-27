#!/usr/bin/env node
/**
 * DDJ Agent CLI - Interactive coding agent
 *
 * A terminal-based coding agent with tool calling, skills, sessions,
 * and multi-provider LLM support.
 */
import { Agent, builtinTools } from "@ddj-ai/agent-core";
import { getModel, listProviders, listModels, getProviderApiKey, getProviderBaseUrl } from "@ddj-ai/core";
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
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
        }
    }
    catch { }
    return {};
}
function saveConfig(config) {
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    }
    catch { }
}
/**
 * Merge API keys from config file into process.env.
 * Config keys take priority over existing env vars.
 */
function applyConfigApiKeys(config) {
    const keyMap = {
        deepseek: "DEEPSEEK_API_KEY",
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        minimax: "MINIMAX_API_KEY",
        google: "GOOGLE_API_KEY",
        groq: "GROQ_API_KEY",
    };
    if (!config.apiKeys)
        return;
    for (const [provider, key] of Object.entries(config.apiKeys)) {
        const envName = keyMap[provider];
        if (envName && key) {
            process.env[envName] = key;
        }
    }
}
/** Environment variable name for a given provider */
function getProviderEnvName(providerId) {
    const map = {
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
function loadSkills() {
    const skills = [];
    try {
        if (!fs.existsSync(SKILLS_DIR))
            return skills;
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
    }
    catch { }
    return skills;
}
/* ============================================================
 * System prompt builder
 * ============================================================ */
function buildSystemPrompt(skills) {
    const parts = [
        "You are DDJ, an AI coding assistant with access to the following tools: read, write, edit, bash.",
        "",
        "You help the user with coding tasks by reading files, writing code, editing files, and running commands.",
        "When executing bash commands, prefer using built-in shell commands over external utilities.",
        "When writing files, create parent directories as needed.",
        "",
        "When editing files, use search/replace with exact, unique text matches.",
        "",
        "Available commands:",
        "- /model: Switch AI model",
        "- /new: Start a new session",
        "- /help: Show this help",
        "- /quit: Exit the agent",
        "- /session: Show session info",
        "- /compact: Compact the conversation context",
        "- /skills: List loaded skills",
    ];
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
function write(text) {
    process.stdout.write(text);
}
function writeln(text = "") {
    process.stdout.write(text + "\n");
}
function renderContent(content) {
    if (typeof content === "string")
        return content;
    return content
        .map((b) => {
        if (b.type === "text")
            return b.text;
        if (b.type === "toolCall") {
            return `\n${colors.dim}[Tool: ${b.name}]${colors.reset}\n${JSON.stringify(b.arguments, null, 2)}`;
        }
        return "";
    })
        .join("");
}
function renderToolResult(toolName, content) {
    const text = renderContent(content);
    const preview = text.length > 200 ? text.slice(0, 200) + "..." : text;
    return `${colors.dim}[Tool Result: ${toolName}]${colors.reset}\n${preview}`;
}
function listSessions() {
    try {
        if (!fs.existsSync(SESSIONS_DIR))
            return [];
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
            }
            catch {
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
    }
    catch {
        return [];
    }
}
function saveSession(id, model, messages, systemPrompt) {
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
        fs.writeFileSync(path.join(SESSIONS_DIR, `${id}.json`), JSON.stringify(data, null, 2));
    }
    catch { }
}
function loadSession(id) {
    try {
        const filePath = path.join(SESSIONS_DIR, `${id}.json`);
        if (!fs.existsSync(filePath))
            return null;
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    catch {
        return null;
    }
}
/* ============================================================
 * Model selection UI
 * ============================================================ */
async function selectModel(rl) {
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
        writeln(`  ${colors.cyan}${i + 1}${colors.reset}. ${models[i].label} ${models[i].supportsTools ? colors.green + "(tools)" + colors.reset : ""}`);
    }
    const modelAnswer = await rl.question(`\nSelect model (1-${models.length}): `);
    const modelIdx = parseInt(modelAnswer, 10) - 1;
    if (isNaN(modelIdx) || modelIdx < 0 || modelIdx >= models.length) {
        writeln(`${colors.red}Invalid selection${colors.reset}`);
        return null;
    }
    try {
        return getModel(providerId, models[modelIdx].id);
    }
    catch (err) {
        writeln(`${colors.red}${err.message}${colors.reset}`);
        return null;
    }
}
/* ============================================================
 * Display agent events (streaming)
 * ============================================================ */
function displayEvent(event) {
    switch (event.type) {
        case "message_update": {
            const ev = event.assistantMessageEvent;
            if (ev.type === "thinking_start") {
                writeln(`\n${colors.dim}  ╭─ Thinking…${colors.reset}`);
            }
            if (ev.type === "thinking_delta") {
                write(`${colors.dim}${ev.delta}${colors.reset}`);
            }
            if (ev.type === "thinking_end") {
                writeln(`\n${colors.dim}  ╰─ (thinking done)${colors.reset}\n`);
            }
            if (ev.type === "text_delta") {
                write(ev.delta);
            }
            break;
        }
        case "tool_execution_start": {
            writeln(`${colors.dim}  ╭─${colors.reset}${colors.yellow} ${event.toolName}${colors.reset}`);
            break;
        }
        case "tool_execution_end": {
            writeln(`${colors.dim}  ╰─${colors.reset}${colors.green} done${colors.reset}${event.toolCallId ? '' : ''}`);
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
        fs.writeFileSync(path.join(exampleSkillDir, "SKILL.md"), `# Example Skill\n\nThis is an example skill. Create skills by placing SKILL.md files in ~/.ddj/skills/<skill-name>/.\n`);
    }
    // Load skills
    const skills = loadSkills();
    // Build system prompt
    const systemPrompt = buildSystemPrompt(skills);
    // Initial model selection
    let currentModel;
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
        }
        catch {
            currentModel = getModel("deepseek", "deepseek-chat");
        }
    }
    else {
        try {
            currentModel = getModel("deepseek", "deepseek-chat");
        }
        catch {
            // Fallback - try first available model
            const providers = listProviders();
            if (providers.length > 0) {
                const models = listModels(providers[0].id);
                if (models.length > 0) {
                    currentModel = getModel(providers[0].id, models[0].id);
                }
                else {
                    throw new Error("No models available");
                }
            }
            else {
                throw new Error("No providers configured");
            }
        }
    }
    // Session tracking
    let sessionId = `session_${Date.now()}`;
    let autoSave = true;
    let thinkingLevel = "low";
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
    writeln(`       ${c.bold}${c.magenta}Dream-Driven Journey${c.reset}  ${c.dim}v0.1.0${c.reset}`);
    writeln(`       ${c.dim}──────────────────────────────${c.reset}`);
    writeln(``);
    writeln(`  ${c.dim}▸${c.reset} Model    ${c.green}${currentModel.label || currentModel.id}${c.reset}`);
    writeln(`  ${c.dim}▸${c.reset} Think    ${c.yellow}${thinkingLevel}${c.reset}`);
    writeln(`  ${c.dim}▸${c.reset} Skills   ${skills.length > 0 ? skills.map((s) => s.name).join(", ") : c.dim + "none" + c.reset}`);
    writeln(`  ${c.dim}▸${c.reset} Help     ${c.yellow}/help${c.reset}`);
    writeln(``);
    writeln(`  ${c.dim}✦${c.reset} Ask anything, I'll help you code.`);
    writeln(``);
    // Create the agent
    let agent = createAgent(currentModel, systemPrompt, thinkingLevel);
    // Create readline interface
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    // Helper to submit a prompt
    async function submitPrompt(input) {
        agent = createAgent(currentModel, systemPrompt, thinkingLevel);
        const unsubscribe = agent.subscribe((event) => {
            displayEvent(event);
        });
        try {
            await agent.prompt(input);
        }
        catch (err) {
            writeln(`\n${colors.red}Error:${colors.reset} ${err.message}`);
        }
        finally {
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
        const input = await rl.question(`${colors.cyan}┃${colors.reset} ${colors.bold}${colors.green}ddj${colors.reset}${colors.dim} ❯${colors.reset} `);
        if (!input.trim())
            continue;
        // Command handling
        if (input.startsWith("/")) {
            const parts = input.slice(1).trim().split(/\s+/);
            const cmd = parts[0].toLowerCase();
            const args = parts.slice(1);
            switch (cmd) {
                case "think":
                case "thinking": {
                    const levels = ["off", "minimal", "low", "medium", "high"];
                    if (args.length > 0) {
                        const idx = levels.indexOf(args[0]);
                        if (idx >= 0) {
                            thinkingLevel = levels[idx];
                            writeln(`${colors.green}✓${colors.reset} Thinking level set to ${thinkingLevel}`);
                        }
                        else {
                            writeln(`${colors.red}Invalid level. Options: ${levels.join(", ")}${colors.reset}`);
                        }
                    }
                    else {
                        // Cycle to next level
                        const idx = levels.indexOf(thinkingLevel);
                        thinkingLevel = levels[(idx + 1) % levels.length];
                        writeln(`${colors.green}✓${colors.reset} Thinking level: ${thinkingLevel}`);
                    }
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
                    if (!config.apiKeys)
                        config.apiKeys = {};
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
                    writeln(`  ${colors.yellow}/save${colors.reset}          Save current session`);
                    writeln(`  ${colors.yellow}/load <id>${colors.reset}     Load a previous session`);
                    writeln(`  ${colors.yellow}/list${colors.reset}          List saved sessions`);
                    writeln(`  ${colors.yellow}/clear${colors.reset}         Clear the terminal`);
                    writeln(`  ${colors.yellow}/compact${colors.reset}       Compact conversation context`);
                    writeln(`  ${colors.yellow}/think${colors.reset}         Toggle thinking mode (off/minimal/low/medium/high)`);
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
                    agent = createAgent(currentModel, systemPrompt, thinkingLevel);
                    writeln(`${colors.green}✓${colors.reset} New session started`);
                    break;
                }
                case "session":
                case "s":
                    writeln(`\n${colors.bold}Session Info:${colors.reset}`);
                    writeln(`  ID: ${colors.cyan}${sessionId}${colors.reset}`);
                    writeln(`  Model: ${colors.green}${currentModel.label || currentModel.id}${colors.reset}`);
                    writeln(`  Messages: ${agent.state.messages.length}`);
                    writeln(`  Thinking: ${thinkingLevel}`);
                    writeln(`  Skills: ${skills.length > 0 ? skills.map((s) => s.name).join(", ") : "none"}`);
                    writeln(``);
                    break;
                case "skills":
                    if (skills.length === 0) {
                        writeln(`${colors.yellow}No skills loaded.${colors.reset}`);
                        writeln(`  Place SKILL.md files in ${colors.cyan}~/.ddj/skills/<name>/SKILL.md${colors.reset}`);
                    }
                    else {
                        writeln(`\n${colors.bold}Loaded Skills:${colors.reset}`);
                        for (const skill of skills) {
                            writeln(`  ${colors.cyan}${skill.name}${colors.reset}`);
                            if (skill.description)
                                writeln(`    ${colors.dim}${skill.description}${colors.reset}`);
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
                    }
                    else {
                        const sessionData = loadSession(args[0]);
                        if (sessionData) {
                            try {
                                currentModel = getModel(sessionData.provider, sessionData.modelId);
                            }
                            catch {
                                writeln(`${colors.yellow}Model ${sessionData.modelId} not available, using current${colors.reset}`);
                            }
                            agent = createAgent(currentModel, systemPrompt, thinkingLevel);
                            agent.state.messages = sessionData.messages;
                            sessionId = sessionData.id;
                            writeln(`${colors.green}✓${colors.reset} Loaded session ${sessionId} (${sessionData.messages.length} messages)`);
                        }
                        else {
                            writeln(`${colors.red}Session not found: ${args[0]}${colors.reset}`);
                        }
                    }
                    break;
                case "list": {
                    const sessions = listSessions();
                    if (sessions.length === 0) {
                        writeln(`${colors.yellow}No saved sessions.${colors.reset}`);
                    }
                    else {
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
                    }
                    else {
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
        }
        catch (err) {
            writeln(`\n${colors.red}Error:${colors.reset} ${err.message}`);
        }
    }
}
/* ============================================================
 * Agent factory
 * ============================================================ */
function createAgent(model, systemPrompt, thinkingLevel = "low") {
    return new Agent({
        initialState: {
            systemPrompt,
            model,
            thinkingLevel,
            tools: builtinTools,
        },
        convertToLlm(messages) {
            return messages
                .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
                .map((m) => {
                if (m.role === "user") {
                    const u = m;
                    return {
                        role: "user",
                        content: u.content,
                        timestamp: u.timestamp,
                    };
                }
                if (m.role === "toolResult") {
                    const r = m;
                    return {
                        role: "toolResult",
                        toolCallId: r.toolCallId,
                        toolName: r.toolName,
                        content: r.content,
                        isError: r.isError,
                        timestamp: r.timestamp,
                    };
                }
                const a = m;
                return {
                    role: "assistant",
                    content: a.content,
                    stopReason: (a.stopReason || "stop"),
                    usage: a.usage,
                    timestamp: a.timestamp,
                    reasoning_content: a.reasoning_content,
                };
            });
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
//# sourceMappingURL=main.js.map